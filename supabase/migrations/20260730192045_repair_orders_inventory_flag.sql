-- The linked production history records migration 023 as applied, but its
-- inventory idempotency column is absent. Reintroduce the column without
-- reprocessing historical orders. Existing rows remain false; only the new
-- atomic finalizer marks orders whose stock it has actually decremented.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS inventory_decremented BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.inventory_decremented IS
  'True only after atomic paid-order fulfillment has decremented inventory';
