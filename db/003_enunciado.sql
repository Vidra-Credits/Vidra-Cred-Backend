-- 003: brechas del enunciado. Solo cambios aditivos; los créditos, pagos y cuentas existentes no se modifican.
-- Tasa por tramos y compra a pago único (créditos y solicitudes).
ALTER TABLE credits ADD COLUMN rate_steps jsonb NOT NULL DEFAULT '[]';
ALTER TABLE credits ADD COLUMN mode varchar(6) NOT NULL DEFAULT 'CUOTAS' CHECK (mode IN ('CUOTAS','UNICO'));
ALTER TABLE credits DROP CONSTRAINT credits_months_check;
ALTER TABLE credits ADD CONSTRAINT credits_months_check CHECK ((mode='UNICO' AND months=0) OR (mode='CUOTAS' AND months BETWEEN 1 AND 5));
ALTER TABLE installments ADD COLUMN tea numeric(20,12);
UPDATE installments i SET tea=c.tea FROM credits c WHERE c.id=i.credit_id;
ALTER TABLE installments ALTER COLUMN tea SET NOT NULL;
ALTER TABLE purchase_requests ADD COLUMN mode varchar(6) NOT NULL DEFAULT 'CUOTAS' CHECK (mode IN ('CUOTAS','UNICO'));
ALTER TABLE purchase_requests DROP CONSTRAINT purchase_requests_months_check;
ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_months_check CHECK ((mode='UNICO' AND months=0) OR (mode='CUOTAS' AND months BETWEEN 1 AND 5));

-- Producto completo: marca, proveedor, unidad de medida, precio contado, precio de lista (amount) y modalidad de venta.
ALTER TABLE packages ADD COLUMN brand varchar(80) NOT NULL DEFAULT '';
ALTER TABLE packages ADD COLUMN supplier varchar(120) NOT NULL DEFAULT '';
ALTER TABLE packages ADD COLUMN unit varchar(30) NOT NULL DEFAULT 'Paquete';
ALTER TABLE packages ADD COLUMN cash_price numeric(14,2);
UPDATE packages SET cash_price=amount;
ALTER TABLE packages ALTER COLUMN cash_price SET NOT NULL;
ALTER TABLE packages ADD CONSTRAINT packages_cash_price_check CHECK (cash_price>0 AND cash_price<=amount);
ALTER TABLE packages ADD COLUMN sale_mode varchar(6) NOT NULL DEFAULT 'AMBOS' CHECK (sale_mode IN ('UNICO','CUOTAS','AMBOS'));
-- Paquetes de demostración de Vidra Plastic: marca propia; el proveedor queda vacío porque no hay dato real.
UPDATE packages SET brand='Vidra Plastic' WHERE id IN ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005');

-- Corte y pago por cliente (NULL = hereda de la tienda) y tasa pactada tal como se acordó (nominal o efectiva).
ALTER TABLE clients ADD COLUMN cut_day smallint CHECK (cut_day BETWEEN 1 AND 31);
ALTER TABLE clients ADD COLUMN pay_day smallint CHECK (pay_day BETWEEN 1 AND 30);
ALTER TABLE clients ADD COLUMN rate_kind char(3) NOT NULL DEFAULT 'TEA' CHECK (rate_kind IN ('TEA','TNA'));
ALTER TABLE clients ADD COLUMN rate_input numeric(20,12) CHECK (rate_input IS NULL OR rate_input>=0);
ALTER TABLE clients ADD COLUMN compounding varchar(10) CHECK (compounding IS NULL OR compounding IN ('DIARIA','QUINCENAL','MENSUAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL'));
ALTER TABLE clients ADD CONSTRAINT clients_rate_nominal_check CHECK (rate_kind='TEA' OR (rate_input IS NOT NULL AND compounding IS NOT NULL));
INSERT INTO schema_migrations(version) VALUES(3);
