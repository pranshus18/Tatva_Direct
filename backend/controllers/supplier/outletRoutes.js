/** Supplier routes: outlet */
import {
  getContractErrorMessage,
  isValidGeoLocation,
  parseWithSchema,
  resolveGeoFromOutletAddress,
  supplierOutletCreateSchema,
  supplierOutletDeleteSchema,
  supplierOutletRepairGeoSchema,
  supplierOutletUpdateSchema
} from './supplierImports.js';

export function registerSupplierOutletRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.get('/outlets', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('outlets')
      .select('*')
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({
      status: 'success',
      outlets: data || []
    });
  } catch (error) {
    console.error('Get outlets error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Create a new outlet
router.post('/outlets', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierOutletCreateSchema, req.body || {});
    const { name, type, code, address, geo_location, phone, email, metadata } = payloadInput;

    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Outlet name is required'
      });
    }

    let finalGeo = isValidGeoLocation(geo_location) ? { lat: geo_location.lat, lng: geo_location.lng } : null;
    if (!finalGeo) {
      const resolved = await resolveGeoFromOutletAddress(null, address || {});
      if (resolved) finalGeo = resolved;
    }

    const { data, error } = await supabase
      .from('outlets')
      .insert({
        supplier_id: req.userId,
        name: name.trim(),
        type: type || 'store',
        code: code || null,
        address: address || {},
        geo_location: finalGeo,
        phone: phone || null,
        email: email || null,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      status: 'success',
      outlet: data
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Create outlet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update an outlet (only if it belongs to the logged-in supplier)
router.put('/outlets/:id', authenticateToken, async (req, res) => {
  try {
    const outletId = req.params.id;
    const payloadInput = parseWithSchema(supplierOutletUpdateSchema, req.body || {});
    const { name, type, code, address, geo_location, phone, email, metadata, is_active } = payloadInput;

    // Ensure outlet belongs to supplier
    const { data: existing, error: fetchError } = await supabase
      .from('outlets')
      .select('*')
      .eq('id', outletId)
      .eq('supplier_id', req.userId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        status: 'error',
        message: 'Outlet not found'
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (code !== undefined) updateData.code = code;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (is_active !== undefined) updateData.is_active = !!is_active;

    const mergedAddress = address !== undefined ? address : existing.address;
    let finalGeo;
    let geoExplicitlyCleared = false;
    if (geo_location !== undefined) {
      if (geo_location === null) {
        geoExplicitlyCleared = true;
        finalGeo = null;
      } else {
        finalGeo = isValidGeoLocation(geo_location) ? { lat: geo_location.lat, lng: geo_location.lng } : null;
      }
    } else {
      finalGeo = existing.geo_location;
    }
    if (!geoExplicitlyCleared && !isValidGeoLocation(finalGeo)) {
      const resolved = await resolveGeoFromOutletAddress(null, mergedAddress || {});
      if (resolved) finalGeo = resolved;
    }
    updateData.geo_location = finalGeo;

    const { data, error } = await supabase
      .from('outlets')
      .update(updateData)
      .eq('id', outletId)
      .eq('supplier_id', req.userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      status: 'success',
      outlet: data
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update outlet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

/**
 * Backfill geo_location for outlets that have address but missing/invalid coordinates.
 * Uses GOOGLE_GEOCODING_API_KEY (or Nominatim fallback) — run after setting the key or fixing addresses.
 */
router.post('/outlets/repair-geo', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierOutletRepairGeoSchema, req.body || {});
    const { data: outlets, error } = await supabase
      .from('outlets')
      .select('id, address, geo_location')
      .eq('supplier_id', req.userId)
      .eq('is_active', true);

    if (error) throw error;

    const results = { updated: 0, skipped: 0, failed: [] };

    for (const o of outlets || []) {
      if (isValidGeoLocation(o.geo_location)) {
        results.skipped += 1;
        continue;
      }
      const resolved = await resolveGeoFromOutletAddress(null, o.address || {});
      if (!resolved) {
        results.failed.push({ outletId: o.id, reason: 'no_geocode_result' });
        continue;
      }
      const { error: upErr } = await supabase
        .from('outlets')
        .update({ geo_location: resolved })
        .eq('id', o.id)
        .eq('supplier_id', req.userId);

      if (upErr) {
        results.failed.push({ outletId: o.id, reason: upErr.message });
      } else {
        results.updated += 1;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    return res.json({
      status: 'success',
      message:
        results.updated > 0
          ? `Updated coordinates for ${results.updated} outlet(s). Upstream distance ranking will use them on the next suggestions request.`
          : 'No outlets needed updates (or geocoding returned no results).',
      results
    });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('Repair outlet geo error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to repair outlet coordinates' });
  }
});

// Soft delete an outlet (mark inactive)
router.delete('/outlets/:id', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierOutletDeleteSchema, req.body || {});
    const outletId = req.params.id;

    const { data, error } = await supabase
      .from('outlets')
      .update({ is_active: false })
      .eq('id', outletId)
      .eq('supplier_id', req.userId)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        status: 'error',
        message: 'Outlet not found'
      });
    }

    res.json({
      status: 'success',
      outlet: data
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Delete outlet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get supplier locations (combined outlets + legacy profile branches)
router.get('/locations', authenticateToken, async (req, res) => {
  try {
    // City code generation: Amazon-style "Ban-123" identifiers.
    // This must be independent from supplier outlet/store codes.
    const inferCityCode = (cityName) => {
      const raw = (cityName || '').toString().trim();
      if (!raw) return '';

      // Use first 3 letters as prefix (e.g., Bangalore => Ban).
      const prefixRaw = raw.replace(/[^a-zA-Z]/g, '').slice(0, 3);
      const prefix =
        prefixRaw.length > 0
          ? prefixRaw.charAt(0).toUpperCase() + prefixRaw.slice(1).toLowerCase()
          : 'City';

      // Stable numeric suffix derived from city name.
      let h = 0;
      for (let i = 0; i < raw.length; i++) {
        h = (h * 31 + raw.charCodeAt(i)) % 1000000;
      }
      const suffix = 100 + (h % 900); // 100..999
      return `${prefix}-${suffix}`;
    };

    // 1) Fetch outlets for this supplier
    const { data: outlets, error: outletsError } = await supabase
      .from('outlets')
      .select('*')
      .eq('supplier_id', req.userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (outletsError) {
      console.error('Get locations - outlets error:', outletsError);
    }

    const outletLocations = (outlets || []).map(outlet => {
      const addr = outlet.address || {};
      const addressText = [
        addr.street,
        addr.city,
        addr.state,
        addr.zipCode,
        addr.country
      ].filter(Boolean).join(', ');

      const displayText = outlet.name || addressText || outlet.code || 'Outlet';

      return {
        id: outlet.id,
        type: 'outlet',
        name: outlet.name || '',
        code: '',
        address: addressText,
        displayText,
        fullText: addressText ? `${outlet.name || ''}${outlet.name ? ', ' : ''}${addressText}` : displayText
      };
    });

    // 2) Fetch legacy branches from user profile for backward compatibility
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('profile')
      .eq('id', req.userId)
      .single();
    
    if (userError) {
      console.error('Get locations - user branches error:', userError);
    }
    
    const branches = user?.profile?.branches || [];
    
    const branchLocations = branches.map(branch => {
      const parts = [
        branch.address && branch.address.trim(),
        branch.city && branch.city.trim(),
        branch.state && branch.state.trim(),
        branch.zipCode && branch.zipCode.trim(),
        branch.country && branch.country.trim()
      ].filter(Boolean);
      const locationText = parts.join(', ') || branch.name?.trim() || '';
      const displayText = locationText || `Branch ${branch.id}`;

      return {
        id: branch.id,
        type: 'branch',
        name: branch.name || '',
        code: '',
        address: branch.address || '',
        displayText,
        fullText: branch.name && branch.address 
          ? `${branch.name}, ${branch.address}` 
          : displayText
      };
    }).filter(loc => loc.displayText);
    
    const locations = [...outletLocations, ...branchLocations];
    
    res.json({ 
      status: 'success',
      locations
    });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Search for product name suggestions (Product Discovery)
}
