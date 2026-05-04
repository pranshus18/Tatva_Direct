-- ============================================
-- MIGRATION: Atomic order cancel + restock
-- ============================================
-- Purpose:
-- - Guarantee order cancellation and inventory restock happen in one DB transaction.
-- - Prevent partial failures where order is cancelled but stock is not restored (or vice versa).
-- ============================================

CREATE OR REPLACE FUNCTION cancel_order_with_restock_atomic(
  p_order_id UUID,
  p_actor_user_id UUID,
  p_cancel_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  order_number VARCHAR,
  status VARCHAR,
  payment_status VARCHAR,
  notes TEXT
)
AS $$
DECLARE
  v_order RECORD;
  v_existing_restock UUID;
  v_next_notes TEXT;
BEGIN
  SELECT *
  INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Keep operation idempotent for already-cancelled orders.
  IF LOWER(COALESCE(v_order.status, '')) <> 'cancelled' THEN
    v_next_notes :=
      CASE
        WHEN COALESCE(TRIM(p_cancel_reason), '') = '' THEN v_order.notes
        WHEN COALESCE(v_order.notes, '') = '' THEN CONCAT('Cancellation reason: ', TRIM(p_cancel_reason))
        ELSE CONCAT(v_order.notes, E'\n', 'Cancellation reason: ', TRIM(p_cancel_reason))
      END;

    UPDATE orders
    SET
      status = 'cancelled',
      notes = v_next_notes,
      status_history = COALESCE(status_history, ARRAY[]::jsonb[]) || jsonb_build_object(
        'status', 'cancelled',
        'timestamp', NOW(),
        'updatedBy', p_actor_user_id,
        'notes', COALESCE(NULLIF(TRIM(p_cancel_reason), ''), 'Cancelled by service provider')
      )
    WHERE id = p_order_id;
  END IF;

  SELECT im.id
  INTO v_existing_restock
  FROM inventory_movements im
  WHERE im.reference_order_id = p_order_id
    AND im.movement_type = 'adjustment'
    AND COALESCE(im.notes, '') ILIKE '%cancel_restock%'
  LIMIT 1;

  IF v_existing_restock IS NULL THEN
    INSERT INTO inventory_movements (
      supplier_product_id,
      supplier_id,
      product_id,
      quantity_change,
      movement_type,
      reference_order_id,
      reference_order_item_id,
      notes,
      created_by
    )
    SELECT
      oi.supplier_product_id,
      o.supplier_id,
      oi.product_id,
      ROUND(COALESCE(oi.quantity, 0))::INTEGER,
      'adjustment',
      o.id,
      oi.id,
      'cancel_restock: inventory added back due to order cancellation',
      p_actor_user_id
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = p_order_id
      AND oi.supplier_product_id IS NOT NULL
      AND COALESCE(oi.quantity, 0) > 0;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.status,
    o.payment_status,
    o.notes
  FROM orders o
  WHERE o.id = p_order_id;
END;
$$ LANGUAGE plpgsql;
