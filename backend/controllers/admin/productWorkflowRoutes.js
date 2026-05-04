import {
  adminProductRequestReviewSchema,
  adminSpecTemplateCreateSchema
} from '../../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';

export function registerProductWorkflowRoutes({ router, authenticateToken, isAdmin, supabase }) {
  // ============================
  // Spec template management
  // ============================
  router.get('/spec-templates', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { category } = req.query;
      let query = supabase
        .from('spec_templates')
        .select('*, spec_template_fields(*)')
        .order('created_at', { ascending: false });
      if (category) query = query.eq('category', String(category).trim().toLowerCase());
      const { data, error } = await query;
      if (error) throw error;
      res.json({ status: 'success', templates: data || [] });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch templates' });
    }
  });

  router.post('/spec-templates', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { name, category, family_id = null, fields = [] } = parseWithSchema(
        adminSpecTemplateCreateSchema,
        req.body || {}
      );
      if (!name || !category || !Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'name, category and fields are required'
        });
      }

      const { data: template, error: templateError } = await supabase
        .from('spec_templates')
        .insert({
          name: String(name).trim(),
          category: String(category).trim().toLowerCase(),
          family_id,
          created_by: req.userId,
          is_active: true
        })
        .select('*')
        .single();
      if (templateError) throw templateError;

      const rows = fields.map((f, idx) => ({
        template_id: template.id,
        field_key: String(f.field_key || f.key || '').trim().toLowerCase().replace(/\s+/g, '_'),
        display_name: String(f.display_name || f.label || f.field_key || f.key || '').trim(),
        data_type: f.data_type || 'text',
        is_required: !!f.is_required,
        allowed_units: Array.isArray(f.allowed_units) ? f.allowed_units : [],
        enum_values: Array.isArray(f.enum_values) ? f.enum_values : [],
        min_value: f.min_value ?? null,
        max_value: f.max_value ?? null,
        sort_order: Number.isInteger(f.sort_order) ? f.sort_order : idx
      })).filter((f) => f.field_key);

      if (rows.length === 0) {
        return res.status(400).json({ status: 'error', message: 'At least one valid field is required' });
      }

      const { data: insertedFields, error: fieldError } = await supabase
        .from('spec_template_fields')
        .insert(rows)
        .select('*');
      if (fieldError) throw fieldError;

      res.status(201).json({
        status: 'success',
        message: 'Specification template created',
        template,
        fields: insertedFields || []
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      res.status(500).json({ status: 'error', message: error.message || 'Failed to create template' });
    }
  });

  // ============================
  // Product request review workflow
  // ============================
  router.get('/product-requests', authenticateToken, isAdmin, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
      let query = supabase.from('product_requests').select('*').order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      res.json({ status: 'success', requests: data || [] });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch product requests' });
    }
  });

  router.post('/product-requests/:id/review', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { decision, notes = '', resolved_product_id = null, resolved_variant_id = null } = parseWithSchema(
        adminProductRequestReviewSchema,
        req.body || {}
      );

      const { data: updated, error } = await supabase
        .from('product_requests')
        .update({
          status: decision,
          review_notes: notes || null,
          reviewer_id: req.userId,
          resolved_product_id,
          resolved_variant_id
        })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (error || !updated) {
        return res.status(404).json({ status: 'error', message: 'Product request not found' });
      }

      await supabase
        .from('product_ingestion_runs')
        .insert({
          request_id: updated.id,
          supplier_id: updated.supplier_id || null,
          provider: 'manual',
          model: 'admin_review',
          prompt_version: 'v1',
          input_payload: { decision, notes },
          extracted_payload: updated.ai_prefill || {},
          validated_payload: updated.normalized_input || {},
          confidence_score: updated.confidence_score || null,
          validation_errors: [],
          final_decision: decision === 'approved' ? 'approved' : (decision === 'rejected' ? 'rejected' : 'queued_review'),
          actor_id: req.userId
        });

      res.json({ status: 'success', message: `Request marked ${decision}`, request: updated });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      res.status(500).json({ status: 'error', message: error.message || 'Failed to review request' });
    }
  });
}
