-- Mimmo Fratelli E-commerce Platform
-- Migration 023: Order inventory decrement
-- Decrementa lo stock alla conferma ordine in modo transazionale e idempotente.
-- Chiamata dalle edge functions (stripe-webhook, complete-order-purchase) con service role.

-- Flag di idempotenza: garantisce un solo decremento per ordine
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS inventory_decremented BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- FUNCTION: Decrementa inventario per un ordine confermato
-- Idempotente: il lock FOR UPDATE sull'ordine + flag previene doppi decrementi
-- Non fallisce mai per stock insufficiente (pagamento già avvenuto):
-- azzera lo stock e riporta le carenze nel risultato per intervento manuale.
-- ============================================
CREATE OR REPLACE FUNCTION process_order_inventory(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_already BOOLEAN;
  v_item RECORD;
  v_available INTEGER;
  v_shortages JSONB := '[]'::jsonb;
BEGIN
  -- Lock dell'ordine: serializza chiamate concorrenti (webhook + fallback)
  SELECT inventory_decremented INTO v_already
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_already IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;

  IF v_already THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  FOR v_item IN
    SELECT product_id, product_name, weight_grams, quantity
    FROM order_items
    WHERE order_id = p_order_id AND product_id IS NOT NULL
  LOOP
    IF v_item.weight_grams IS NOT NULL THEN
      -- Prodotto a peso: decrementa la variante in weight_inventory
      -- (il trigger update_product_availability aggiorna products.inventory/is_active)
      SELECT quantity INTO v_available
      FROM weight_inventory
      WHERE product_id = v_item.product_id AND weight_grams = v_item.weight_grams
      FOR UPDATE;

      IF v_available IS NULL THEN
        v_shortages := v_shortages || jsonb_build_object(
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'weight_grams', v_item.weight_grams,
          'requested', v_item.quantity,
          'available', 0,
          'reason', 'variante peso non trovata'
        );
      ELSE
        IF v_available < v_item.quantity THEN
          v_shortages := v_shortages || jsonb_build_object(
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'weight_grams', v_item.weight_grams,
            'requested', v_item.quantity,
            'available', v_available,
            'reason', 'stock insufficiente'
          );
        END IF;

        UPDATE weight_inventory
        SET quantity = GREATEST(quantity - v_item.quantity, 0)
        WHERE product_id = v_item.product_id AND weight_grams = v_item.weight_grams;
      END IF;
    ELSE
      -- Prodotto a pezzi: decrementa num_items solo se tracciato esplicitamente
      SELECT num_items INTO v_available
      FROM products
      WHERE id = v_item.product_id
      FOR UPDATE;

      IF v_available IS NOT NULL THEN
        IF v_available < v_item.quantity THEN
          v_shortages := v_shortages || jsonb_build_object(
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'requested', v_item.quantity,
            'available', v_available,
            'reason', 'stock insufficiente'
          );
        END IF;

        UPDATE products
        SET num_items = GREATEST(num_items - v_item.quantity, 0),
            is_active = CASE
              WHEN GREATEST(num_items - v_item.quantity, 0) = 0 THEN false
              ELSE is_active
            END
        WHERE id = v_item.product_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE orders
  SET inventory_decremented = true, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'shortages', v_shortages);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: Ripristina inventario (annullamento/rimborso ordine)
-- ============================================
CREATE OR REPLACE FUNCTION restore_order_inventory(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_decremented BOOLEAN;
  v_item RECORD;
BEGIN
  SELECT inventory_decremented INTO v_decremented
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_decremented IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;

  IF NOT v_decremented THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  FOR v_item IN
    SELECT product_id, weight_grams, quantity
    FROM order_items
    WHERE order_id = p_order_id AND product_id IS NOT NULL
  LOOP
    IF v_item.weight_grams IS NOT NULL THEN
      UPDATE weight_inventory
      SET quantity = quantity + v_item.quantity
      WHERE product_id = v_item.product_id AND weight_grams = v_item.weight_grams;

      IF NOT FOUND THEN
        INSERT INTO weight_inventory (product_id, weight_grams, quantity)
        VALUES (v_item.product_id, v_item.weight_grams, v_item.quantity);
      END IF;
    ELSE
      UPDATE products
      SET num_items = COALESCE(num_items, 0) + v_item.quantity
      WHERE id = v_item.product_id AND num_items IS NOT NULL;
    END IF;
  END LOOP;

  UPDATE orders
  SET inventory_decremented = false, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Solo service role (edge functions) e admin: nessuna esecuzione da client pubblici
REVOKE EXECUTE ON FUNCTION process_order_inventory(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION restore_order_inventory(UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION process_order_inventory(UUID) IS 'Decrementa stock per ordine confermato (idempotente, non fallisce post-pagamento; riporta shortages)';
COMMENT ON FUNCTION restore_order_inventory(UUID) IS 'Ripristina stock per ordine annullato/rimborsato (idempotente)';
COMMENT ON COLUMN orders.inventory_decremented IS 'True se lo stock è già stato decrementato per questo ordine';
