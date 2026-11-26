
BEGIN;

-- Switch to the table owner for schema changes.
SET LOCAL ROLE scenova_owner;

-- Temporarily allow the table owner to access all existing rows.
-- RLS remains enabled; FORCE is restored before this transaction commits.
ALTER TABLE activities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE emission_factors NO FORCE ROW LEVEL SECURITY;

-- Preserve the emission factor used when each activity is accepted.
ALTER TABLE activities
ADD COLUMN factor_value NUMERIC(20, 10);

-- Store calculated emissions with sufficient decimal precision.
ALTER TABLE activities
ADD COLUMN emissions_tco2e NUMERIC(40, 16);

-- Backfill existing activities using their tenant-specific factor.
UPDATE activities AS a
SET
    factor_value = f.tco2e_per_unit,
    emissions_tco2e = a.quantity * f.tco2e_per_unit
FROM emission_factors AS f
WHERE
    a.tenant_id = f.tenant_id
    AND a.factor_key = f.factor_key;

-- Every existing activity must have a valid snapshot.
ALTER TABLE activities
ALTER COLUMN factor_value SET NOT NULL;

ALTER TABLE activities
ALTER COLUMN emissions_tco2e SET NOT NULL;

ALTER TABLE activities
ADD CONSTRAINT activities_factor_value_nonnegative
CHECK (factor_value >= 0);

ALTER TABLE activities
ADD CONSTRAINT activities_emissions_nonnegative
CHECK (emissions_tco2e >= 0);

-- Restore forced RLS before committing.
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
ALTER TABLE emission_factors FORCE ROW LEVEL SECURITY;

COMMIT;
