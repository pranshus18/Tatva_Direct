import express from 'express';
import multer from 'multer';
import fs from 'fs-extra';
import csv from 'csv-parser';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { supabase } from '../../config/supabase.js';
import { deleteBoqById } from '../../repositories/boqsRepository.js';
import { insertNotifications } from '../../repositories/notificationsRepository.js';
import { findAdmins, findUserBasicById } from '../../repositories/usersRepository.js';
import { parseOptionalGeo, geocodeAddressNominatim, haversineKm } from '../../utils/geoUtils.js';
import { loadAdminBrandTerminalRoleMap, normalizeBrandChainKey, supplierMatchesBrandTerminalRole } from '../../utils/adminBrandSupplyChain.js';
import { normalizeText } from '../../services/supplierCatalogHelpersService.js';
import { calculateMatchConfidenceBoq, extractTokens } from '../../services/textMatchingService.js';
import { inferUnitAndCategory } from '../../services/materialClassificationService.js';
import { boqDeleteSchema, boqNormalizeBodySchema, boqRequestProductSchema } from '../../contracts/boqContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
let pdfParseFunction = null;
try {
  const pdfModule = require('pdf-parse');
  if (typeof pdfModule === 'function') pdfParseFunction = pdfModule;
  else if (pdfModule.PDFParse && typeof pdfModule.PDFParse === 'function') pdfParseFunction = pdfModule.PDFParse;
  else if (pdfModule.default && typeof pdfModule.default === 'function') pdfParseFunction = pdfModule.default;
} catch (error) {
  console.warn('pdf-parse module not available:', error.message);
}

// Helper function to parse CSV file
export const parseCSV = async (filePath) => {
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
export const parseExcel = async (filePath) => {
  try {
    const workbook = xlsx.readFile(filePath, { cellDates: true });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Excel file contains no sheets');
    }

    const keywordRegex = /(description|item|material|product|qty|quantity|unit|uom|rate|price)/i;

    const scoreSheet = (name) => {
      const worksheet = workbook.Sheets[name];
      if (!worksheet || !worksheet['!ref']) return { name, score: -1 };

      const range = xlsx.utils.decode_range(worksheet['!ref']);
      const rowCount = Math.max(0, range.e.r - range.s.r + 1);
      const headers = [];
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const cell = worksheet[xlsx.utils.encode_cell({ r: range.s.r, c: col })];
        if (cell != null && cell.v != null) headers.push(String(cell.v));
      }
      const keywordMatches = headers.filter((header) => keywordRegex.test(header)).length;
      return { name, score: rowCount * 10 + keywordMatches * 100 };
    };

    const bestSheetMeta = workbook.SheetNames.map(scoreSheet)
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)[0];

    if (!bestSheetMeta) {
      throw new Error('Excel file appears to be empty or contains no data');
    }

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[bestSheetMeta.name], {
      defval: '',
      blankrows: false
    });

    if (!rows.length) {
      throw new Error('Excel file appears to be empty or contains no data');
    }

    console.log(`[BOQ Parse] Selected Excel sheet: ${bestSheetMeta.name} (rows: ${rows.length})`);
    return rows;
  } catch (error) {
    console.error('Excel parsing error:', error);
    throw new Error(`Failed to parse Excel file: ${error.message}. Please ensure the file is a valid Excel format (.xlsx or .xls) and contains data.`);
  }
};

// Helper function to parse PDF file
export const parsePDF = async (filePath) => {
  if (!pdfParseFunction) {
    throw new Error('PDF parsing is not available. Please convert your BOQ file to CSV or Excel format (.csv, .xlsx, .xls).');
  }

  const dataBuffer = await fs.readFile(filePath);
  
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

export function deepestSupplyChainRoleFromProfile(profile) {
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

export function parseBrandTokensForChain(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(/[,;\n/|]+/)
    .map((token) => normalizeBrandChainKey(token))
    .filter(Boolean);
}

export function profileHasRoleForBrand(profile, role, brandName) {
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

export function resolveRoleForSupplierAndBrand(profile, brandName, terminalRoleByBrandMap) {
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

export function resolveProductBrandFromRow(productRow) {
  if (!productRow) return null;
  return (
    productRow?.brand ||
    productRow?.specifications?.brandModel ||
    productRow?.specifications?.brand ||
    null
  );
}

export function resolveSupplierLocationText(rowLocation, supplier = {}) {
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
export async function buildSupplyChainInfoForProducts(productIds, siteGeo) {
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
export const normalizeProductName = async (rawName, options = {}) => {
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
  // PostgREST `.or()` treats commas as delimiters; spaces in values are safer as `%`.
  const sanitizeOrIlikePattern = (value) =>
    `%${String(value || '')
      .replace(/[,()]/g, ' ')
      .replace(/[%_]/g, ' ')
      .replace(/\s+/g, '%')
      .replace(/%+/g, '%')
      .replace(/^%|%$/g, '')}%`;

  const searchTerms = extractTokens(normalizedInput).filter((term) => term.length > 2);
  const searchPatterns = [
    sanitizeOrIlikePattern(itemNameLower),
    ...searchTerms.map((term) => sanitizeOrIlikePattern(term))
  ].filter((pattern, index, all) => pattern.length > 2 && all.indexOf(pattern) === index);

  const terminalRoleByBrandMap =
    options.terminalRoleByBrandMap ||
    (await loadAdminBrandTerminalRoleMap(supabase, []));

  const PRODUCT_MATCH_SELECT = `
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
  `;

  const runProductQuery = async (withCategory) => {
    // Keep the same select shape as the original matcher — slim field lists can
    // break PostgREST embeds and silently return zero product matches.
    let query = supabase.from('products').select(PRODUCT_MATCH_SELECT);

    if (withCategory && itemCategory !== 'other') {
      query = query.eq('category', itemCategory);
    }

    if (searchPatterns.length === 0) {
      return query.ilike('name', `%${itemNameLower}%`).limit(100);
    }

    const orConditions = searchPatterns
      .map((pattern) => `name.ilike.${pattern},description.ilike.${pattern}`)
      .join(',');

    return query.or(orConditions).limit(100);
  };

  let { data: products, error } = await runProductQuery(true);

  if (error) {
    console.error('Product search error:', error);
  }

  // If category filter was too strict, retry without it once.
  if ((error || !products || products.length === 0) && itemCategory !== 'other') {
    const retry = await runProductQuery(false);
    if (retry.error) {
      console.error('Product search retry error:', retry.error);
    } else {
      products = retry.data;
      error = null;
    }
  }

  // Last resort: simple name contains search (handles spaced queries reliably).
  if (error || !products || products.length === 0) {
    const fallback = await supabase
      .from('products')
      .select(PRODUCT_MATCH_SELECT)
      .ilike('name', `%${itemNameLower}%`)
      .limit(100);
    if (fallback.error) {
      console.error('Product search fallback error:', fallback.error);
    } else {
      products = fallback.data;
    }
  }
  
  const productsList = products || [];

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
          })[0] || candidateSupplierProducts[0] || supplierProducts[0];
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
        supplierCount: candidateSupplierProducts.length,
        candidateSupplierProducts
      };
    });
    
    // Sort by confidence score (highest first)
    scoredProducts.sort((a, b) => b.confidence - a.confidence);
    
    const bestMatch = scoredProducts[0];
    const bestProduct = bestMatch.product;
    const bestSupplierProduct = bestMatch.supplierProduct;

    // Count suppliers for the matched product (not every fuzzy search hit).
    const uniqueSupplierIds = new Set();
    const bestSupplierProducts = Array.isArray(bestProduct.supplier_products)
      ? bestProduct.supplier_products
      : [bestProduct.supplier_products].filter(Boolean);
    bestSupplierProducts.forEach((sp) => {
      const stock = parseInt(sp?.stock, 10) || 0;
      if (
        sp?.supplier &&
        sp.supplier.id &&
        supplierMatchesBrandTerminalRole(
          sp.supplier.profile || {},
          sp?.attributes?.brand ||
            sp?.attributes?.brandModel ||
            bestProduct?.brand ||
            bestProduct?.specifications?.brandModel ||
            bestProduct?.specifications?.brand ||
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

    // If terminal-role filtering wiped everyone but offers exist, still surface stocked offers.
    if (uniqueSupplierIds.size === 0) {
      bestSupplierProducts.forEach((sp) => {
        const stock = parseInt(sp?.stock, 10) || 0;
        if (
          sp?.supplier?.id &&
          sp.is_active !== false &&
          sp.status !== 'rejected' &&
          stock > 0
        ) {
          uniqueSupplierIds.add(sp.supplier.id);
        }
      });
    }
    
    const availableSuppliers = uniqueSupplierIds.size || bestMatch.supplierCount || 0;
    
    // Get supplier info from best supplier product
    let supplier = bestSupplierProduct?.supplier;
    if (!supplier && bestMatch.candidateSupplierProducts?.length) {
      supplier = bestMatch.candidateSupplierProducts[0]?.supplier || null;
    }
    if (!supplier) {
      const stockedOffer = bestSupplierProducts.find(
        (sp) => sp?.supplier && (parseInt(sp.stock, 10) || 0) > 0 && sp.is_active !== false && sp.status !== 'rejected'
      );
      supplier = stockedOffer?.supplier || null;
    }
    
    // Get location
    const supplierLocation = resolveSupplierLocationText(bestSupplierProduct?.location, supplier);
    
    const supplierInfo = supplier ? {
      supplierName: supplier.name || supplier.company || 'Unknown',
      supplierLocation: supplierLocation,
      supplierCompany: supplier.company || ''
    } : null;

    const roundedConfidence = Math.round(bestMatch.confidence * 100) / 100;
    const stockValue = parseInt(bestSupplierProduct?.stock, 10) || 0;

    return {
      normalizedName: bestProduct.name,
      productId: bestProduct.id,
      confidence: roundedConfidence,
      availableSuppliers: availableSuppliers,
      supplierInfo: supplierInfo,
      isAvailable: availableSuppliers > 0 || stockValue > 0,
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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Normalize many BOQ line descriptions efficiently:
 * - loads brand terminal-role map once
 * - deduplicates identical descriptions
 * - matches unique lines with bounded concurrency
 */
export async function normalizeProductNamesBatch(rawNames = [], options = {}) {
  const list = Array.isArray(rawNames) ? rawNames : [];
  if (list.length === 0) return [];

  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 8, 12));
  const terminalRoleByBrandMap =
    options.terminalRoleByBrandMap ||
    (await loadAdminBrandTerminalRoleMap(supabase, []));

  const keyByIndex = list.map((name) => normalizeText(String(name || '')) || '__empty__');
  const uniqueRawByKey = new Map();
  keyByIndex.forEach((key, index) => {
    if (!uniqueRawByKey.has(key)) {
      uniqueRawByKey.set(key, list[index]);
    }
  });

  const uniqueEntries = Array.from(uniqueRawByKey.entries());
  const uniqueResults = new Map();

  await mapWithConcurrency(uniqueEntries, concurrency, async ([key, rawName]) => {
    const result = await normalizeProductName(rawName, { terminalRoleByBrandMap });
    uniqueResults.set(key, result);
    return result;
  });

  return keyByIndex.map((key) => uniqueResults.get(key));
}
