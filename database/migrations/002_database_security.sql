
BEGIN;

-- 1. Create a dedicated owner role.
-- This role cannot log in and does not bypass RLS.
CREATE ROLE scenova_owner
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOBYPASSRLS;

-- 2. Create the restricted backend application role.
-- Its password will be configured separately using psql.
CREATE ROLE scenova_app
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOBYPASSRLS;

-- 3. Allow the owner role to own and manage objects in public.
GRANT USAGE, CREATE ON SCHEMA public TO scenova_owner;

-- 4. Allow the application to connect and use the schema.
GRANT CONNECT ON DATABASE scenova TO scenova_app;
GRANT USAGE ON SCHEMA public TO scenova_app;

-- 5. Transfer ownership of all five tables.
ALTER TABLE public.tenants OWNER TO scenova_owner;
ALTER TABLE public.emission_factors OWNER TO scenova_owner;
ALTER TABLE public.activities OWNER TO scenova_owner;
ALTER TABLE public.factor_history OWNER TO scenova_owner;
ALTER TABLE public.upload_records OWNER TO scenova_owner;

-- 6. Grant minimum required application permissions.
GRANT SELECT ON public.tenants TO scenova_app;

GRANT SELECT, INSERT
ON public.activities TO scenova_app;

GRANT SELECT, UPDATE
ON public.emission_factors TO scenova_app;

GRANT SELECT, INSERT
ON public.factor_history TO scenova_app;

GRANT SELECT, INSERT
ON public.upload_records TO scenova_app;

-- 7. Allow insertion into identity-backed tables.
GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO scenova_app;

-- 8. Enable and force RLS on every tenant-owned table.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emission_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factor_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.emission_factors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.factor_history FORCE ROW LEVEL SECURITY;
ALTER TABLE public.upload_records FORCE ROW LEVEL SECURITY;

-- 9. Create tenant isolation policies.
-- A missing tenant context results in no matching rows.

CREATE POLICY tenant_isolation
ON public.tenants
FOR ALL
TO scenova_app
USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
);

CREATE POLICY tenant_isolation
ON public.emission_factors
FOR ALL
TO scenova_app
USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
);

CREATE POLICY tenant_isolation
ON public.activities
FOR ALL
TO scenova_app
USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
);

CREATE POLICY tenant_isolation
ON public.factor_history
FOR ALL
TO scenova_app
USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
);

CREATE POLICY tenant_isolation
ON public.upload_records
FOR ALL
TO scenova_app
USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
);

COMMIT;
