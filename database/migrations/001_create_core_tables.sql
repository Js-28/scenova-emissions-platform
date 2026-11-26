CREATE TABLE tenants (
    tenant_id TEXT PRIMARY KEY,
    tenant_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE emission_factors (
    factor_key TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    unit TEXT NOT NULL,
    tco2e_per_unit NUMERIC(20, 10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, factor_key),

    CHECK (tco2e_per_unit >= 0)
);

CREATE TABLE activities (
    activity_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    occurred_at TIMESTAMPTZ NOT NULL,
    category TEXT NOT NULL,
    scope SMALLINT NOT NULL,
    quantity NUMERIC(20, 6) NOT NULL,
    unit TEXT NOT NULL,
    factor_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, activity_id),

    CHECK (scope IN (1, 2, 3)),
    CHECK (quantity >= 0),

    FOREIGN KEY (tenant_id, factor_key)
        REFERENCES emission_factors(tenant_id, factor_key)
);

CREATE TABLE factor_history (
    history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    factor_key TEXT NOT NULL,
    old_value NUMERIC(20, 10) NOT NULL,
    new_value NUMERIC(20, 10) NOT NULL,
    reason TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (tenant_id, factor_key)
        REFERENCES emission_factors(tenant_id, factor_key),

    CHECK (old_value >= 0),
    CHECK (new_value >= 0),
    CHECK (LENGTH(TRIM(reason)) > 0)
);

CREATE TABLE upload_records (
    upload_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
    filename TEXT,
    total_rows INTEGER NOT NULL DEFAULT 0,
    accepted_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (total_rows >= 0),
    CHECK (accepted_rows >= 0),
    CHECK (rejected_rows >= 0),
    CHECK (duplicate_rows >= 0)
);