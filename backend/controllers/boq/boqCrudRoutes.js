/** BOQ routes: boqCrud */
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { boqDeleteSchema } from '../../contracts/boqContracts.js';
import { supabase } from '../../config/supabase.js';
import { deleteBoqById } from '../../repositories/boqsRepository.js';

export function registerBoqCrudRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase
  } = ctx;

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

    // Orders reference boq_id without ON DELETE CASCADE — unlink first when safe.
    const deletableOrderStatuses = new Set(['confirmed', 'cancelled']);
    const { data: linkedOrders, error: linkedOrdersError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('boq_id', id)
      .eq('service_provider_id', req.userId);

    if (linkedOrdersError) {
      throw linkedOrdersError;
    }

    const blockingOrders = (linkedOrders || []).filter((row) => {
      const s = String(row?.status || '').trim().toLowerCase();
      return s && !deletableOrderStatuses.has(s);
    });

    if (blockingOrders.length > 0) {
      return res.status(400).json({
        status: 'error',
        message:
          'This BOQ is still linked to purchase orders that are not confirmed or cancelled. Cancel or finish those orders first, then you can delete the BOQ.'
      });
    }

    if (linkedOrders?.length) {
      const { error: unlinkError } = await supabase
        .from('orders')
        .update({ boq_id: null })
        .eq('boq_id', id)
        .eq('service_provider_id', req.userId);
      if (unlinkError) {
        throw unlinkError;
      }
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
}
