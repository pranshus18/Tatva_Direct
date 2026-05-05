import express from 'express';
import multer from 'multer';
import fs from 'fs-extra';
import csv from 'csv-parser';
import xlsx from 'xlsx';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { deleteBoqById } from '../repositories/boqsRepository.js';
import { insertNotifications } from '../repositories/notificationsRepository.js';
import { findAdmins, findUserBasicById } from '../repositories/usersRepository.js';
import {
  parseOptionalGeo,
  geocodeAddressNominatim,
  haversineKm
} from '../utils/geoUtils.js';
import {
  loadAdminBrandTerminalRoleMap,
  normalizeBrandChainKey,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import { normalizeText } from '../services/supplierCatalogHelpersService.js';
import { calculateMatchConfidenceBoq, extractTokens } from '../services/textMatchingService.js';
import { inferUnitAndCategory } from '../services/materialClassificationService.js';
import { boqDeleteSchema, boqNormalizeBodySchema, boqRequestProductSchema } from '../contracts/boqContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load pdf-parse - handle different versions
let pdfParseFunction = null;
try {
  const pdfModule = require('pdf-parse');
  if (typeof pdfModule === 'function') {
    pdfParseFunction = pdfModule;
  } else if (pdfModule.PDFParse && typeof pdfModule.PDFParse === 'function') {
    pdfParseFunction = pdfModule.PDFParse;
  } else if (pdfModule.default && typeof pdfModule.default === 'function') {
    pdfParseFunction = pdfModule.default;
  }
} catch (error) {
  console.warn('pdf-parse module not available:', error.message);
}

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Helper function to parse CSV file
const parseCSV = async (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    let hasData = false;
    
    fs.createReadStream(filePath)
      .pipe(csv({
        skipEmptyLines: true,
        skipLinesWithError: false
      }))
      .on('data', (data) => {
        hasData = true;
        results.push(data);
      })
      .on('end', () => {
        if (!hasData || results.length === 0) {
          reject(new Error('CSV file appears to be empty or contains no valid data'));
        } else {
          resolve(results);
        }
      })
      .on('error', (error) => {
        reject(new Error(`Failed to parse CSV file: ${error.message}. Please ensure the file is a valid CSV format.`));
      });
  });
};

// Helper function to parse Excel file
const parseExcel = async (filePath) => {
  try {
    const workbook = xlsx.readFile(filePath);
    
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Excel file contains no sheets');
    }
    
    const keywordRegex = /(description|item|material|product|qty|quantity|unit|uom|rate|price)/i;
    const sheetCandidates = workbook.SheetNames.map((name) => {
      const worksheet = workbook.Sheets[name];
      if (!worksheet) return { name, rows: [], score: -1 };

      const rows = xlsx.utils.sheet_to_json(worksheet, {
        defval: '',
        blankrows: false
      });

      const firstRowKeys = rows[0] ? Object.keys(rows[0]) : [];
      const keywordMatches = firstRowKeys.filter((k) => keywordRegex.test(String(k))).length;
      // Prefer sheets with more row data and with BOQ-like headers.
      const score = rows.length * 10 + keywordMatches * 100;
      return { name, rows, score };
    });

    const bestSheet = sheetCandidates
      .filter((s) => Array.isArray(s.rows) && s.rows.length > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!bestSheet || !bestSheet.rows || bestSheet.rows.length === 0) {
      throw new Error('Excel file appears to be empty or contains no data');
    }

    console.log(`[BOQ Parse] Selected Excel sheet: ${bestSheet.name} (rows: ${bestSheet.rows.length})`);
    return bestSheet.rows;
  } catch (error) {
    console.error('Excel parsing error:', error);
    throw new Error(`Failed to parse Excel file: ${error.message}. Please ensure the file is a valid Excel format (.xlsx or .xls) and contains data.`);
  }
};

// Helper function to parse PDF file
const parsePDF = async (filePath) => {
  if (!pdfParseFunction) {
    throw new Error('PDF parsing is not available. Please convert your BOQ file to CSV or Excel format (.csv, .xlsx, .xls).');
  }

  const dataBuffer = fs.readFileSync(filePath);
  
  let data;
  try {
    if (typeof pdfParseFunction === 'function') {
      try {
        data = await pdfParseFunction(dataBuffer);
      } catch (e) {
        if (e.message.includes('without \'new\'')) {
          const PDFParse = require('pdf-parse').PDFParse;
          const parser = new PDFParse(dataBuffer);
          if (typeof parser.parse === 'function') {
            data = await parser.parse();
          } else if (typeof parser.then === 'function') {
            data = await parser;
          } else {
            data = parser;
          }
        } else {
          throw e;
        }
      }
    } else {
      throw new Error('PDF parser function not available');
    }
  } catch (parseError) {
    console.error('PDF parsing error:', parseError);
    throw new Error(`Unable to parse PDF file: ${parseError.message}. Please convert your BOQ to CSV or Excel format (.csv, .xlsx) for better compatibility.`);
  }
  
  if (!data || !data.text || data.text.trim().length === 0) {
    throw new Error('Could not extract text from PDF. The PDF may be image-based or encrypted. Please convert your BOQ to CSV or Excel format (.csv, .xlsx) for better compatibility.');
  }
  
  const lines = data.text.split('\n').filter(line => line.trim());
  const results = [];
  
  // Basic PDF parsing - extract text and try to parse table-like data
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      // Try to extract columns (space-separated or tab-separated)
      const parts = trimmed.split(/\s{2,}|\t/).filter(p => p.trim());
      if (parts.length >= 2) {
        results.push({
          description: parts[0] || '',
          quantity: parts[1] || '',
          unit: parts[2] || '',
          rate: parts[3] || ''
        });
      }
    }
  }
  
  return results;
};

// Supply-chain role depth (copied from supplier + admin supply-chain routes)
const SUPPLY_CHAIN_ROLE_DEPTH = {
  manufacturer: 0,
  stockist: 1,
  regional_distributor: 2,
  local_distributor: 3,
  dealer: 4,
  retailer: 5
};

const SUPPLY_CHAIN_ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional Distributor',
  local_distributor: 'Local Distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

function deepestSupplyChainRoleFromProfile(profile) {
  if (!profile) return null;
  let bestRole = null;
  let bestDepth = -1;

  const considerRole = (role) => {
    if (!role || SUPPLY_CHAIN_ROLE_DEPTH[role] == null) return;
    const depth = SUPPLY_CHAIN_ROLE_DEPTH[role];
    if (depth > bestDepth) {
      bestDepth = depth;
      bestRole = role;
    }
  };

  if (profile.supplierRole) {
    considerRole(profile.supplierRole);
  }
  if (Array.isArray(profile.companyInfoEntries)) {
    for (const entry of profile.companyInfoEntries) {
      if (entry && entry.role) {
        considerRole(entry.role);
      }
    }
  }

  return bestRole;
}

function parseBrandTokensForChain(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(/[,;\n/|]+/)
    .map((token) => normalizeBrandChainKey(token))
    .filter(Boolean);
}

function profileHasRoleForBrand(profile, role, brandName) {
  if (!profile || !role) return false;
  const brandKey = normalizeBrandChainKey(brandName);
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];

  const matchingEntries = entries.filter((entry) => entry && entry.role === role);
  if (matchingEntries.length > 0) {
    if (!brandKey) return true;
    return matchingEntries.some((entry) => {
      const tokenSet = new Set(parseBrandTokensForChain(entry?.brands));
      return tokenSet.has(brandKey);
    });
  }

  if (profile.supplierRole !== role) return false;
  if (!brandKey) return true;
  const legacyTokenSet = new Set(parseBrandTokensForChain(profile?.brands));
  return legacyTokenSet.has(brandKey);
}

function resolveRoleForSupplierAndBrand(profile, brandName, terminalRoleByBrandMap) {
  const brandKey = normalizeBrandChainKey(brandName);
  const requiredRole = brandKey ? terminalRoleByBrandMap.get(brandKey) || null : null;
  if (requiredRole) {
    // If admin chain exists for this brand, keep role label aligned to that chain.
    return profileHasRoleForBrand(profile, requiredRole, brandName) ? requiredRole : null;
  }

  // If brand is known but admin chain is missing, pick role from brand-matching entries only
  // so we do not leak a role from some other brand (e.g., showing Retailer for Asian Paints).
  if (brandKey) {
    const entries = Array.isArray(profile?.companyInfoEntries)
      ? profile.companyInfoEntries
      : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
        ? [profile.companyInfoEntries]
        : [];
    let brandBestRole = null;
    let brandBestDepth = -1;
    for (const entry of entries) {
      if (!entry || !entry.role) continue;
      const entryBrands = new Set(parseBrandTokensForChain(entry.brands));
      if (!entryBrands.has(brandKey)) continue;
      const depth = SUPPLY_CHAIN_ROLE_DEPTH[entry.role] ?? -1;
      if (depth > brandBestDepth) {
        brandBestDepth = depth;
        brandBestRole = entry.role;
      }
    }
    if (brandBestRole) return brandBestRole;

    // Legacy fallback where supplierRole + profile.brands are used.
    const legacyBrands = new Set(parseBrandTokensForChain(profile?.brands));
    if (profile?.supplierRole && legacyBrands.has(brandKey)) {
      return profile.supplierRole;
    }

    // Brand provided but no matching role declaration for it.
    return null;
  }

  // No brand context available at all; retain generic fallback.
  return deepestSupplyChainRoleFromProfile(profile);
}

function resolveProductBrandFromRow(productRow) {
  if (!productRow) return null;
  return (
    productRow?.brand ||
    productRow?.specifications?.brandModel ||
    productRow?.specifications?.brand ||
    null
  );
}

function resolveSupplierLocationText(rowLocation, supplier = {}) {
  const directLocation = String(rowLocation || '').trim();
  if (directLocation) return directLocation;

  const address = supplier.address || {};
  const addressLocation = [address.city, address.state].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
  if (addressLocation) return addressLocation;

  const profile = supplier.profile || {};
  const branches = Array.isArray(profile.branches) ? profile.branches : [];
  const firstBranchWithLocation = branches.find((branch) => {
    if (!branch) return false;
    const explicit = String(branch.location || branch.address || '').trim();
    if (explicit) return true;
    const composed = [branch.city, branch.state].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
    return !!composed;
  });
  if (firstBranchWithLocation) {
    const explicit = String(firstBranchWithLocation.location || firstBranchWithLocation.address || '').trim();
    if (explicit) return explicit;
    const composed = [firstBranchWithLocation.city, firstBranchWithLocation.state]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(', ');
    if (composed) return composed;
  }

  return 'Location not specified';
}


// Helper to compute, per product, the last person in the supply chain
// (deepest downstream role) and the nearest active outlet to the BOQ site.
async function buildSupplyChainInfoForProducts(productIds, siteGeo) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const result = {};
  if (uniqueIds.length === 0) return result;

  // Fetch supplier_products + supplier profile for all products in one go
  const { data: spRows, error: spError } = await supabase
    .from('supplier_products')
    .select(`
      id,
      product_id,
      supplier_id,
      price,
      stock,
      status,
      is_active,
      attributes,
      location,
      supplier:users!supplier_products_supplier_id_fkey (id, name, company, email, phone, address, profile)
    `)
    .in('product_id', uniqueIds);

  if (spError) {
    console.error('BOQ SupplyChain: supplier_products fetch error:', spError);
    return result;
  }

  const byProduct = new Map();
  for (const row of spRows || []) {
    if (!row || !row.product_id) continue;
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
    byProduct.get(row.product_id).push(row);
  }

  const { data: productRows, error: productError } = await supabase
    .from('products')
    .select('id, brand, specifications')
    .in('id', uniqueIds);
  if (productError) {
    console.error('BOQ SupplyChain: products fetch error:', productError);
  }
  const productBrandById = new Map(
    (productRows || []).map((row) => [row.id, resolveProductBrandFromRow(row)])
  );
  const brandsToResolve = [...new Set(
    (productRows || [])
      .map((row) => resolveProductBrandFromRow(row))
      .filter(Boolean)
  )];
  const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, brandsToResolve);

  // Optionally fetch outlet geo for proximity
  let outletBySupplier = {};
  if (siteGeo && typeof siteGeo.lat === 'number' && typeof siteGeo.lng === 'number') {
    const supplierIds = Array.from(
      new Set(
        (spRows || [])
          .map((r) => r && r.supplier_id)
          .filter(Boolean)
      )
    );
    if (supplierIds.length > 0) {
      const { data: outletRows, error: outletError } = await supabase
        .from('outlets')
        .select('supplier_id, geo_location')
        .in('supplier_id', supplierIds)
        .eq('is_active', true);

      if (outletError) {
        console.error('BOQ SupplyChain: outlets fetch error:', outletError);
      } else {
        outletBySupplier = {};
        for (const row of outletRows || []) {
          const sid = row.supplier_id;
          const g = row.geo_location;
          if (!sid || !g || typeof g.lat !== 'number' || typeof g.lng !== 'number') continue;
          const km = haversineKm(siteGeo.lat, siteGeo.lng, g.lat, g.lng);
          if (outletBySupplier[sid] == null || km < outletBySupplier[sid].distanceKm) {
            outletBySupplier[sid] = { distanceKm: km, geo: g };
          }
        }
      }
    }
  }

  for (const productId of uniqueIds) {
    const rows = byProduct.get(productId) || [];
    if (!rows.length) {
      result[productId] = { lastChainSupplier: null, nearestSupplier: null };
      continue;
    }

    let lastChainSupplier = null;
    let lastChainDepth = -1;
    let nearestSupplier = null;
    let nearestDistance = null;
    const productBrand =
      productBrandById.get(productId) ||
      rows.find((r) => r?.attributes?.brand || r?.attributes?.brandModel)?.attributes?.brand ||
      rows.find((r) => r?.attributes?.brand || r?.attributes?.brandModel)?.attributes?.brandModel ||
      null;

    for (const row of rows) {
      const supplier = row.supplier;
      if (!supplier) continue;
      if (row.is_active === false || row.status === 'rejected') continue;
      const profile = supplier.profile || {};
      const role = resolveRoleForSupplierAndBrand(profile, productBrand, terminalRoleByBrandMap);
      if (!role) continue;

      const stock = parseInt(row.stock, 10);
      if (Number.isNaN(stock) || stock <= 0) continue;
      const depth = role != null ? SUPPLY_CHAIN_ROLE_DEPTH[role] ?? -1 : -1;

      const supplierLocation = resolveSupplierLocationText(row.location, supplier);

      const baseInfo = {
        supplierId: supplier.id,
        supplierName: supplier.name || supplier.company || 'Unknown',
        supplierCompany: supplier.company || '',
        supplierLocation,
        role,
        roleLabel: role ? SUPPLY_CHAIN_ROLE_LABELS[role] || role : null
      };

      if (depth > lastChainDepth) {
        lastChainDepth = depth;
        lastChainSupplier = baseInfo;
      }

      // Proximity based on nearest active outlet, if any
      const outletInfo = outletBySupplier[supplier.id];
      if (outletInfo && typeof outletInfo.distanceKm === 'number') {
        if (nearestDistance == null || outletInfo.distanceKm < nearestDistance) {
          nearestDistance = outletInfo.distanceKm;
          nearestSupplier = {
            ...baseInfo,
            distanceKm: Math.round(outletInfo.distanceKm * 10) / 10
          };
        }
      }
    }

    result[productId] = {
      lastChainSupplier: lastChainSupplier || null,
      nearestSupplier: nearestSupplier || lastChainSupplier || null
    };
  }

  return result;
}

// Helper function to normalize product name by matching with database products
const normalizeProductName = async (rawName) => {
  const normalizedInput = normalizeText(String(rawName || ''));
  if (!normalizedInput) {
    return {
      normalizedName: 'Unknown item',
      productId: null,
      confidence: 0,
      availableSuppliers: 0,
      supplierInfo: null,
      isAvailable: false,
      price: null,
      stock: 0
    };
  }
  const itemNameLower = normalizedInput;
  
  // Determine category from item name (expanded matching)
  let itemCategory = 'other';
  const categoryKeywords = {
    'steel': ['steel', 'bar', 'rod', 'rebar', 'tmt', 'ms', 'iron', 'metal'],
    'cement': ['cement', 'concrete', 'plaster', 'mortar', 'opc', 'ppc'],
    'aggregates': ['sand', 'aggregate', 'gravel', 'stone', 'crush', 'ballast', 'grit'],
    'masonry': ['brick', 'block', 'tile', 'marble', 'granite', 'stone'],
    'electrical': ['wire', 'cable', 'switch', 'socket', 'bulb', 'light', 'fan'],
    'plumbing': ['pipe', 'fitting', 'tap', 'faucet', 'valve', 'pvc', 'cpvc'],
    'hardware': ['screw', 'nail', 'bolt', 'nut', 'washer', 'hinge', 'lock']
  };
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => itemNameLower.includes(keyword))) {
      itemCategory = category;
      break;
    }
  }
  
  // Build expanded search query - search in multiple ways for better matching
  // 1. Search in product names and descriptions
  // 2. Use multiple search patterns (exact, contains, word-based)
  const searchTerms = extractTokens(normalizedInput).filter(term => term.length > 2);
  const searchPatterns = [
    `%${itemNameLower}%`,  // Full text contains
    ...searchTerms.map(term => `%${term}%`)  // Individual words
  ];
  const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, []);
  
  // Build query - first try with supplier_products join, fallback to products only
  let query = supabase
    .from('products')
    .select(`
      *,
      supplier_products(
        id,
        price,
        stock,
        location,
        attributes,
        status,
        is_active,
        supplier_id,
        supplier:users!supplier_products_supplier_id_fkey (id, name, company, email, phone, address, profile)
      )
    `);
  
  // Add category filter if detected (but don't restrict too much)
  if (itemCategory !== 'other') {
    query = query.eq('category', itemCategory);
  }
  
  // Use OR condition for flexible matching
  const orConditions = searchPatterns.map(pattern => 
    `name.ilike.${pattern},description.ilike.${pattern}`
  ).join(',');
  
  query = query.or(orConditions);
  
  // Get more results to score them all
  query = query.limit(100);
  
  const { data: products, error } = await query;
  
  if (error) {
    console.error('Product search error:', error);
  }
  
  const productsList = products || [];
  console.log(`BOQ Normalize - Searching for "${normalizedInput}" (category: ${itemCategory}): Found ${productsList.length} products`);

  if (productsList.length > 0) {
    // Score all products and find the best match
    const scoredProducts = productsList.map(product => {
      const productDescription = product.description || '';
      const confidence = calculateMatchConfidenceBoq(normalizedInput, product.name, productDescription);
      
      // Get supplier_products data (may have multiple suppliers or none for backward compatibility)
      let supplierProducts = [];
      if (product.supplier_products) {
        supplierProducts = Array.isArray(product.supplier_products) 
          ? product.supplier_products 
          : [product.supplier_products];
      }
      
      // Service-provider flow should expose suppliers in the brand's terminal chain role.
      const terminalRoleSupplierProducts = supplierProducts.filter(
        (sp) => {
          if (!sp || !sp.supplier) return false;
          const itemBrand =
            sp?.attributes?.brand ||
            sp?.attributes?.brandModel ||
            product?.brand ||
            product?.specifications?.brandModel ||
            product?.specifications?.brand ||
            null;
          return supplierMatchesBrandTerminalRole(sp.supplier.profile || {}, itemBrand, terminalRoleByBrandMap);
        }
      );
      // Prefer approved+active offers; fallback to pending offers.
      const approvedActiveSupplierProducts = terminalRoleSupplierProducts.filter(
        (sp) => sp.status === 'approved' && sp.is_active === true
      );
      const candidateSupplierProducts = approvedActiveSupplierProducts.length > 0
        ? approvedActiveSupplierProducts
        : terminalRoleSupplierProducts.filter((sp) => sp && sp.is_active !== false && sp.status !== 'rejected');
      
      // Find best supplier (highest stock or lowest price)
      let bestSupplierProduct = null;
      if (candidateSupplierProducts.length > 0) {
        bestSupplierProduct = candidateSupplierProducts
          .filter(sp => (parseInt(sp.stock, 10) || 0) > 0)
          .sort((a, b) => {
            // Prefer higher stock, then lower price
            const stockA = parseInt(a.stock, 10) || 0;
            const stockB = parseInt(b.stock, 10) || 0;
            const priceA = parseFloat(a.price) || 0;
            const priceB = parseFloat(b.price) || 0;

            if (stockB !== stockA) return stockB - stockA;
            return priceA - priceB;
          })[0] || supplierProducts[0];
      } else {
        // Fallback to product-level data for backward compatibility
        bestSupplierProduct = {
          price: product.price,
          stock: product.stock,
          location: product.location,
          supplier: product.supplier,
          status: product.status,
          is_active: product.is_active
        };
      }
      
      return {
        product,
        confidence,
        supplierProduct: bestSupplierProduct,
        supplierCount: candidateSupplierProducts.length
      };
    });
    
    // Sort by confidence score (highest first)
    scoredProducts.sort((a, b) => b.confidence - a.confidence);
    
    const bestMatch = scoredProducts[0];
    const bestProduct = bestMatch.product;
    const bestSupplierProduct = bestMatch.supplierProduct;
    
    // Count unique suppliers eligible for the brand's terminal chain role
    const uniqueSupplierIds = new Set();
    productsList.forEach(prod => {
      const supplierProducts = Array.isArray(prod.supplier_products) 
        ? prod.supplier_products 
        : [prod.supplier_products].filter(Boolean);
      supplierProducts.forEach(sp => {
        const stock = parseInt(sp?.stock, 10) || 0;
        if (
          sp?.supplier &&
          sp.supplier.id &&
          supplierMatchesBrandTerminalRole(
            sp.supplier.profile || {},
            sp?.attributes?.brand ||
              sp?.attributes?.brandModel ||
              prod?.brand ||
              prod?.specifications?.brandModel ||
              prod?.specifications?.brand ||
              null,
            terminalRoleByBrandMap
          ) &&
          sp.is_active !== false &&
          sp.status !== 'rejected' &&
          stock > 0
        ) {
          uniqueSupplierIds.add(sp.supplier.id);
        }
      });
    });
    
    const availableSuppliers = uniqueSupplierIds.size;
    console.log(`BOQ Normalize - Product "${normalizedInput}": Found ${availableSuppliers} unique suppliers, best match confidence: ${bestMatch.confidence.toFixed(2)}`);
    
    // Get supplier info from best supplier product
    const supplier = bestSupplierProduct?.supplier;
    
    // Get location
    const supplierLocation = resolveSupplierLocationText(bestSupplierProduct?.location, supplier);
    
    const supplierInfo = supplier ? {
      supplierName: supplier.name || supplier.company || 'Unknown',
      supplierLocation: supplierLocation,
      supplierCompany: supplier.company || ''
    } : null;

    const roundedConfidence = Math.round(bestMatch.confidence * 100) / 100;

    return {
      normalizedName: bestProduct.name,
      productId: bestProduct.id,
      confidence: roundedConfidence,
      availableSuppliers: availableSuppliers,
      supplierInfo: supplierInfo,
      isAvailable: (parseInt(bestSupplierProduct?.stock, 10) || 0) > 0,
      price: bestSupplierProduct?.price,
      stock: bestSupplierProduct?.stock
    };
  }

  // If no match found, clean and normalize the raw name
  const cleanedName = normalizedInput
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
  
  return {
    normalizedName: cleanedName,
    productId: null,
    // No matching product in catalog, so confidence is 0 and no suppliers
    confidence: 0,
    availableSuppliers: 0,
    supplierInfo: null,
    isAvailable: false
  };
};

router.post('/normalize', authenticateToken, isServiceProvider, upload.single('file'), async (req, res) => {
  try {
    const body = parseWithSchema(boqNormalizeBodySchema, req.body || {});
    const timestamp = req.query._t || 'N/A';
    const random = req.query._r || 'N/A';
    console.log(`BOQ Normalize request received at ${new Date().toISOString()}, timestamp: ${timestamp}, random: ${random}`);
    
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file uploaded'
      });
    }

    const siteLocation = String(body.siteLocation || body.site_location || '').trim();
    const requiredDate = String(body.requiredDate || body.required_date || '').trim();
    const providedGeo = parseOptionalGeo(body.siteLatitude ?? body.site_lat, body.siteLongitude ?? body.site_lng);
    if ((!siteLocation && !providedGeo) || !requiredDate) {
      try {
        await fs.remove(req.file.path);
      } catch (cleanupErr) {
        console.error('BOQ normalize cleanup (missing site/date):', cleanupErr);
      }
      return res.status(400).json({
        status: 'error',
        message: 'Provide either project site location or site coordinates, and a required date, with the BOQ upload.'
      });
    }

    let siteGeo =
      providedGeo ||
      (siteLocation ? await geocodeAddressNominatim(siteLocation) : null);
    const projectLocationLabel =
      siteLocation ||
      (siteGeo && typeof siteGeo.lat === 'number' && typeof siteGeo.lng === 'number'
        ? `Current location (${siteGeo.lat.toFixed(5)}, ${siteGeo.lng.toFixed(5)})`
        : 'Current location');

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let rawItems = [];

    // Parse file based on extension
    try {
      if (fileExtension === '.csv') {
        rawItems = await parseCSV(filePath);
      } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        rawItems = await parseExcel(filePath);
      } else if (fileExtension === '.pdf') {
        rawItems = await parsePDF(filePath);
      } else {
        const mimeType = req.file.mimetype;
        if (mimeType && (mimeType.includes('spreadsheet') || mimeType.includes('excel'))) {
          rawItems = await parseExcel(filePath);
        } else if (mimeType && mimeType.includes('csv')) {
          rawItems = await parseCSV(filePath);
        } else {
          try {
            rawItems = await parseExcel(filePath);
          } catch (excelError) {
            try {
              rawItems = await parseCSV(filePath);
            } catch (csvError) {
              throw new Error(`Unsupported file format. Please upload CSV (.csv), Excel (.xlsx, .xls), or PDF (.pdf) format.`);
            }
          }
        }
      }
    } catch (parseError) {
      console.error('File parsing error:', parseError);
      try {
        await fs.remove(filePath);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
      
      let errorMessage = 'Failed to parse file. ';
      if (parseError.message.includes('PDF')) {
        errorMessage += 'PDF files are not fully supported. Please convert your BOQ to CSV or Excel format (.csv, .xlsx) for better compatibility.';
      } else if (parseError.message.includes('CSV') || parseError.message.includes('Excel')) {
        errorMessage += 'Please ensure the file format is correct and contains valid data.';
      } else {
        errorMessage += parseError.message || 'Please ensure the file format is correct.';
      }
      
      return res.status(400).json({
        status: 'error',
        message: errorMessage,
        error: parseError.message
      });
    }

    // Clean up uploaded file after parsing
    await fs.remove(filePath);

    if (!rawItems || rawItems.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No items found in the uploaded file'
      });
    }

    console.log('Raw items sample (first 3 rows):', JSON.stringify(rawItems.slice(0, 3), null, 2));
    console.log('Total raw items:', rawItems.length);

    // Normalize items - map raw data to structured format
    const normalizedItems = [];
    for (let i = 0; i < rawItems.length; i++) {
      const rawItem = rawItems[i];
      
      const keys = Object.keys(rawItem);
      const lowerKeys = keys.map(k => k.toLowerCase());
      
      let description = '';
      let quantity = 0;
      let unit = 'nos';
      let rate = 0;
      
      // Find description
      const descKeys = ['description', 'item', 'name', 'product', 'item description', 'item name', 'material', 'product name'];
      for (const key of descKeys) {
        const foundKey = keys.find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey && rawItem[foundKey] && String(rawItem[foundKey]).trim()) {
          description = String(rawItem[foundKey]).trim();
          break;
        }
      }
      
      // If no description found, use first non-empty TEXT column
      if (!description) {
        for (const key of keys) {
          const value = rawItem[key];
          const str = String(value ?? '').trim();
          
          if (!str) continue;
          
          const isPureNumber = /^[0-9.,]+$/.test(str);
          const isNumberWithUnit = /^[0-9.,]+\s*[a-zA-Z]+$/.test(str) && !/[a-zA-Z]/.test(str.replace(/^[0-9.,\s]+/, ''));
          
          if (isPureNumber || isNumberWithUnit) {
            continue;
          }

          if (/[a-zA-Z]/.test(str)) {
            description = str;
            break;
          }
        }
      }
      
      if (!description || description.length === 0) {
        description = `Item ${i + 1}`;
        console.log(`Row ${i + 1}: Using fallback description`, rawItem);
      }
      
      // Find quantity
      const qtyKeys = ['quantity', 'qty', 'qty.', 'amount', 'nos', 'number', 'count'];
      for (const key of qtyKeys) {
        const foundKey = keys.find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey) {
          const qtyValue = parseFloat(rawItem[foundKey]);
          if (!isNaN(qtyValue) && qtyValue > 0) {
            quantity = qtyValue;
            break;
          }
        }
      }
      
      if (quantity <= 0) {
        for (const key of keys) {
          const value = parseFloat(rawItem[key]);
          if (!isNaN(value) && value > 0 && value < 1000000) {
            quantity = value;
            break;
          }
        }
      }
      
      // Find unit
      const unitKeys = ['unit', 'uom', 'unit of measure', 'uom.'];
      for (const key of unitKeys) {
        const foundKey = keys.find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey && rawItem[foundKey]) {
          unit = String(rawItem[foundKey]).trim().toLowerCase();
          break;
        }
      }
      
      // Find rate/price
      const rateKeys = ['rate', 'price', 'unit price', 'rate per unit', 'unit rate'];
      for (const key of rateKeys) {
        const foundKey = keys.find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey) {
          const rateValue = parseFloat(rawItem[foundKey]);
          if (!isNaN(rateValue)) {
            rate = rateValue;
            break;
          }
        }
      }

      console.log(`Row ${i + 1}: description="${description}", quantity=${quantity}, keys=${keys.join(', ')}`);
      
      if (quantity <= 0) {
        quantity = 1;
        console.log(`Row ${i + 1}: No quantity found, defaulting to 1`, rawItem);
      }

      // Normalize product name by matching with database
      const normalized = await normalizeProductName(description);
      const { unit: inferredUnit, category } = inferUnitAndCategory(normalized.normalizedName);

      normalizedItems.push({
        id: i + 1,
        rawName: description,
        normalizedName: normalized.normalizedName,
        quantity: quantity,
        unit: unit || inferredUnit,
        confidence: normalized.confidence,
        productId: normalized.productId,
        supplierInfo: normalized.supplierInfo,
        availableSuppliers: normalized.availableSuppliers || 0,
        isAvailable: normalized.isAvailable || false,
        category: category
      });
    }

    console.log(`Total normalized items: ${normalizedItems.length} out of ${rawItems.length} raw items`);
    
    if (normalizedItems.length === 0) {
      const sampleKeys = rawItems.length > 0 ? Object.keys(rawItems[0]) : [];
      return res.status(400).json({
        status: 'error',
        message: `No valid items found in the uploaded file. Found ${rawItems.length} rows. Detected columns: ${sampleKeys.join(', ')}. Please ensure your file has columns for item description/name and quantity.`,
        debug: {
          totalRows: rawItems.length,
          columns: sampleKeys,
          sampleRow: rawItems[0] || null
        }
      });
    }

    // Enrich with supply chain info: last person in chain and nearest supplier per product
    const productIds = normalizedItems.map((item) => item.productId).filter(Boolean);
    const supplyChainInfoByProduct = await buildSupplyChainInfoForProducts(productIds, siteGeo);

    // Map normalized items to BOQ items format (DB row shape only)
    // Note: supply-chain info is returned to frontend but not stored in `boq_items`
    // to avoid schema changes.
    const boqItems = normalizedItems.map((item) => {
      const { unit: inferredUnit, category } = inferUnitAndCategory(item.normalizedName);

      return {
        description: item.normalizedName,
        quantity: item.quantity,
        unit: item.unit || inferredUnit,
        category: category,
        normalized_product_id: item.productId,
        specifications: `Confidence: ${Math.round(item.confidence * 100)}%`
      };
    });

    // Calculate total value
    const totalValue = boqItems.reduce((sum, item) => {
      return sum + (item.amount || (item.quantity * (item.rate || 0)));
    }, 0);

    // Create BOQ
    console.log(`[BOQ Create] Creating BOQ for user ID: ${req.userId} (type: ${typeof req.userId})`);
    const { data: boq, error: boqError } = await supabase
      .from('boqs')
      .insert({
        name: req.file.originalname.replace(/\.[^/.]+$/, '') || `BOQ-${Date.now()}`,
        description: 'BOQ created from uploaded file',
        service_provider_id: req.userId,
        project: {
          location: projectLocationLabel,
          requiredDate,
          siteGeo: siteGeo || null
        },
        status: 'normalized',
        normalized_at: new Date().toISOString(),
        total_value: totalValue,
        uploaded_file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: req.file.path,
          size: req.file.size,
          mimetype: req.file.mimetype
        },
        processing_log: [{
          action: 'normalized',
          details: `BOQ normalized successfully with ${normalizedItems.length} items (site: ${projectLocationLabel}, required: ${requiredDate})`,
          user: req.userId,
          timestamp: new Date().toISOString()
        }]
      })
      .select()
      .single();

    if (boqError || !boq) {
      console.error('BOQ creation error:', boqError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to create BOQ',
        error: boqError?.message
      });
    }
    
    console.log(`[BOQ Create] BOQ created successfully with ID: ${boq.id}, service_provider_id: ${boq.service_provider_id}`);

    // Create BOQ items
    const boqItemsWithBoqId = boqItems.map(item => ({
      ...item,
      boq_id: boq.id
    }));

    const { error: itemsError } = await supabase
      .from('boq_items')
      .insert(boqItemsWithBoqId);

    if (itemsError) {
      console.error('BOQ items creation error:', itemsError);
      // Delete the BOQ if items creation fails
      await deleteBoqById(boq.id, supabase);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to create BOQ items',
        error: itemsError.message
      });
    }

    // Format items for frontend
    const formattedItems = normalizedItems.map((item) => {
      const scInfo = item.productId ? supplyChainInfoByProduct[item.productId] || {} : {};
      return {
        ...item,
        boqId: boq.id,
        supplyChainLastSupplier: scInfo.lastChainSupplier || null,
        nearestSupplier: scInfo.nearestSupplier || null
      };
    });

    res.json({
      items: formattedItems,
      boqId: boq.id,
      project: boq.project || {
        location: projectLocationLabel,
        requiredDate,
        siteGeo: siteGeo || null
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('BOQ normalization error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to normalize BOQ',
      error: error.message 
    });
  }
});

// Service provider requests creation of a new catalog product
// This is used when a BOQ item has no available suppliers and the
// service provider wants this product to be added to the marketplace.
router.post('/request-product', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(boqRequestProductSchema, req.body || {});
    const { name, category, unit, description, boqId } = payload;

    // Optionally validate that BOQ (if provided) belongs to this service provider
    if (boqId) {
      const { data: boq, error: boqError } = await supabase
        .from('boqs')
        .select('id, service_provider_id')
        .eq('id', boqId)
        .single();

      if (boqError || !boq || boq.service_provider_id !== req.userId) {
        return res.status(403).json({
          status: 'error',
          message: 'You do not have permission to request products for this BOQ'
        });
      }
    }

    // Create a lightweight catalog product entry that will be reviewed by admin.
    // Price/stock/location are set to safe defaults; suppliers will provide their
    // own values later via supplier portal.
    const { data: newProduct, error: productError } = await supabase
      .from('products')
      .insert({
        name: name.trim(),
        description: description || '',
        category: String(category).trim().toLowerCase(),
        unit: String(unit).trim().toLowerCase(),
        price: 0,
        stock: 0,
        min_order_quantity: 1,
        location: 'Not specified',
        status: 'pending',
        is_active: false,
        requested_by_service_provider_id: req.userId,
        specifications: {},
        tags: ['requested_via_boq']
      })
      .select()
      .single();

    if (productError || !newProduct) {
      console.error('[BOQ Product Request] Product creation error:', productError);
      return res.status(500).json({
        status: 'error',
        message: productError?.message || 'Failed to create requested product'
      });
    }

    console.log(`[BOQ Product Request] New product requested by service provider ${req.userId}:`, {
      id: newProduct.id,
      name: newProduct.name,
      category: newProduct.category
    });

    // Notify all admins that a new product is pending approval
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
    const { data: admins } = await findAdmins(adminEmail, supabase);

    if (admins && admins.length > 0) {
      // Fetch service provider details for richer notification content
      const { data: serviceProvider } = await findUserBasicById(req.userId, supabase);

      const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type: 'product_approval',
        title: `New Product Requested by Service Provider: ${newProduct.name}`,
        message: `${serviceProvider?.name || 'A service provider'} (${serviceProvider?.company || serviceProvider?.email || ''}) has requested a new product "${newProduct.name}" in category "${newProduct.category}". Please review and approve it so suppliers can add their offers.`,
        related_product_id: newProduct.id,
        related_supplier_id: null,
        metadata: {
          productId: newProduct.id,
          productName: newProduct.name,
          productCategory: newProduct.category,
          productUnit: newProduct.unit,
          requestedByServiceProviderId: req.userId,
          requestedByServiceProviderName: serviceProvider?.name,
          requestedByServiceProviderCompany: serviceProvider?.company,
          requestedByServiceProviderEmail: serviceProvider?.email,
          source: 'service_provider_boq_request',
          boqId: boqId || null
        },
        is_read: false
      }));

      try {
        await insertNotifications(notifications, supabase);
        console.log(
          `[BOQ Product Request] Created ${notifications.length} admin notification(s) for requested product ${newProduct.id}`
        );
      } catch (notifError) {
        console.error('[BOQ Product Request] Failed to create admin notifications:', notifError);
      }
    }

    return res.status(201).json({
      status: 'success',
      message: 'Product request submitted and is pending admin approval',
      product: newProduct
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[BOQ Product Request] Unexpected error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit product request'
    });
  }
});

// Fetch saved BOQ items (so service provider can revisit supplier selection without re-upload)
router.get('/:id/items', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: boq, error: boqError } = await supabase
      .from('boqs')
      .select('id, service_provider_id, status, project')
      .eq('id', id)
      .eq('service_provider_id', req.userId)
      .single();

    if (boqError || !boq) {
      return res.status(404).json({
        status: 'error',
        message: 'BOQ not found or you do not have permission to view it'
      });
    }

    const { data: boqItems, error: itemsError } = await supabase
      .from('boq_items')
      .select('id, description, quantity, unit, normalized_product_id')
      .eq('boq_id', id)
      .order('created_at', { ascending: true });

    if (itemsError) {
      throw itemsError;
    }

    const items = (boqItems || []).map((it) => ({
      id: it.id,
      rawName: it.description,
      normalizedName: it.description,
      quantity: it.quantity,
      unit: it.unit,
      productId: it.normalized_product_id,
      // These are not critical for ranking; they are kept for compatibility
      confidence: it.normalized_product_id ? 1 : 0,
      availableSuppliers: 0,
      boqId: id
    }));

    return res.json({
      status: 'success',
      boqId: id,
      project: boq.project || {},
      items
    });
  } catch (error) {
    console.error('Get BOQ items error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch BOQ items'
    });
  }
});

// Delete BOQ
router.delete('/:id', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    parseWithSchema(boqDeleteSchema, req.body || {});
    const { id } = req.params;
    
    // Find the BOQ and verify ownership
    const { data: boq, error: fetchError } = await supabase
      .from('boqs')
      .select('*')
      .eq('id', id)
      .eq('service_provider_id', req.userId)
      .single();
    
    if (fetchError || !boq) {
      return res.status(404).json({ 
        status: 'error',
        message: 'BOQ not found or you do not have permission to delete it' 
      });
    }
    
    // Delete uploaded file if it exists (local filesystem - will migrate to Supabase Storage later)
    if (boq.uploaded_file && boq.uploaded_file.path) {
      try {
        const filePath = path.join(__dirname, '..', boq.uploaded_file.path);
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
        }
      } catch (fileError) {
        console.error('Error deleting uploaded file:', fileError);
      }
    }
    
    // Delete BOQ items first (cascade should handle this, but being explicit)
    await supabase
      .from('boq_items')
      .delete()
      .eq('boq_id', id);
    
    // Delete the BOQ
    const { error: deleteError } = await supabase
      .from('boqs')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      throw deleteError;
    }
    
    res.json({ 
      status: 'success',
      message: 'BOQ deleted successfully' 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Delete BOQ error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to delete BOQ',
      error: error.message 
    });
  }
});

export { router as boqRouter };
