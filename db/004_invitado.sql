-- 004: modo invitado. Una cuenta de solo lectura para que terceros exploren la demostración sin poder modificar datos.
-- Cambio aditivo: ninguna cuenta, crédito ni pago existente se modifica (todas quedan con read_only = false).
ALTER TABLE users ADD COLUMN read_only boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations(version) VALUES(4);
