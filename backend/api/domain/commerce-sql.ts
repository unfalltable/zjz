// D1 batch executes sequentially in one transaction. The audit insert immediately follows its UPDATE.
export const updateOrderStatusSql = `UPDATE orders
  SET status = ?, progress = ?, version = version + 1, updated_at = ?
  WHERE owner_id = ? AND order_number = ? AND status = ? AND payment_status = 'paid' AND version = ?`;

export const insertOrderStatusEventSql = `INSERT INTO order_events
  (id, owner_id, order_id, event_type, from_status, to_status, actor_id, order_version, created_at)
  SELECT ?, owner_id, id, 'status_changed', ?, status, ?, version, ? FROM orders
  WHERE owner_id = ? AND order_number = ? AND changes() > 0`;

export const restockProductSql = `UPDATE products
  SET stock = stock + ?, version = version + 1, updated_at = ?
  WHERE owner_id = ? AND sku = ? AND stock >= 0 AND reserved >= 0 AND stock >= reserved
    AND stock + ? <= 1000000`;

export const insertInventoryEventSql = `INSERT INTO inventory_events
  (id, owner_id, product_id, quantity, resulting_stock, actor_id, created_at, note)
  SELECT ?, owner_id, id, ?, stock, ?, ?, ? FROM products
  WHERE owner_id = ? AND sku = ? AND changes() > 0`;
