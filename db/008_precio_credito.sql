-- Las filas antiguas se revisan por separado.
ALTER TABLE packages DROP CONSTRAINT packages_cash_price_check;
ALTER TABLE packages ADD CONSTRAINT packages_cash_price_check CHECK (cash_price > 0 AND cash_price < amount) NOT VALID;
INSERT INTO schema_migrations(version) VALUES(8);
