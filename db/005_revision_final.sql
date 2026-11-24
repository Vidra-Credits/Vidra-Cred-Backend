-- Preserve historical schedules; new UI operations explicitly use monthly payments.
ALTER TABLE purchase_requests ADD COLUMN frequency varchar(10) NOT NULL DEFAULT 'QUINCENAL' CHECK (frequency IN ('MENSUAL','QUINCENAL'));
ALTER TABLE clients ADD COLUMN mora_tea numeric(20,12) NOT NULL DEFAULT 0.35 CHECK (mora_tea BETWEEN 0 AND 2);
ALTER TABLE clients ADD COLUMN mora_kind char(3) NOT NULL DEFAULT 'TEA' CHECK (mora_kind IN ('TEA','TNA'));
ALTER TABLE clients ADD COLUMN mora_input numeric(20,12);
ALTER TABLE clients ADD COLUMN mora_compounding varchar(10);
ALTER TABLE clients ADD CONSTRAINT clients_mora_nominal_check CHECK (mora_kind='TEA' OR (mora_input IS NOT NULL AND mora_compounding IN ('DIARIA','QUINCENAL','MENSUAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL')));
ALTER TABLE credits DROP CONSTRAINT credits_mora_check;
ALTER TABLE credits ADD CONSTRAINT credits_mora_check CHECK (mora BETWEEN 0 AND 2);
INSERT INTO schema_migrations(version) VALUES(5);
