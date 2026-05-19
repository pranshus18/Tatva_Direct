/** BOQ routes: normalize */
import {
  buildSupplyChainInfoForProducts,
  parseCSV,
  parseExcel,
  parsePDF
} from './boqCore.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { boqDeleteSchema, boqNormalizeBodySchema, boqRequestProductSchema } from '../../contracts/boqContracts.js';
import { supabase } from '../../config/supabase.js';

export function registerBoqNormalizeRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase,
    upload
  } = ctx;

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
}
