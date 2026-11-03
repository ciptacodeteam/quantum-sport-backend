-- Admin-only payment channels. Customer checkout only exposes gateway channels.
-- Run at deployment, outside an admin/cashier request: the shared catalog is
-- protected against writes by non-super-admin sessions.
-- Repeatable; existing catalog settings and payment history are preserved.
INSERT INTO payment_methods
  (id, name, channel, fees, percentage, sequence, "isActive", "createdAt", "updatedAt")
VALUES
  ('admin-payment-edc', 'EDC', 'EDC', 0, 0, 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin-payment-qris-static', 'QRIS Statis', 'QRIS_STATIC', 0, 0, 101, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin-payment-transfer', 'Transfer', 'BANK_TRANSFER_MANUAL', 0, 0, 102, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
