-- Create the two assignment tenants
INSERT INTO tenants (tenant_id, tenant_name)
VALUES
    ('t_alpha', 'Tenant Alpha'),
    ('t_beta', 'Tenant Beta')
ON CONFLICT (tenant_id) DO NOTHING;


-- Seed emission factors for both tenants
INSERT INTO emission_factors (
    tenant_id,
    factor_key,
    unit,
    tco2e_per_unit
)
VALUES
    -- Tenant Alpha
    ('t_alpha', 'diesel', 'L', 0.0027),
    ('t_alpha', 'electricity', 'kWh', 0.00068),
    ('t_alpha', 'freight_road', 'tkm', 0.00011),
    ('t_alpha', 'natural_gas', 'GJ', 0.0514),

    -- Tenant Beta
    ('t_beta', 'diesel', 'L', 0.0027),
    ('t_beta', 'electricity', 'kWh', 0.00068),
    ('t_beta', 'freight_road', 'tkm', 0.00011),
    ('t_beta', 'natural_gas', 'GJ', 0.0514)
ON CONFLICT (tenant_id, factor_key) DO NOTHING;