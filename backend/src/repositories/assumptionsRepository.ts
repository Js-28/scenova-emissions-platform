import type { PoolClient } from "pg";

export interface EmissionFactor {
  factor_key: string;
  unit: string;
  tco2e_per_unit: string;
}

export interface FactorHistoryRecord {
  history_id: string;
  factor_key: string;
  old_value: string;
  new_value: string;
  reason: string;
  changed_at: Date;
}

export async function getEmissionFactors(
  client: PoolClient,
): Promise<EmissionFactor[]> {
  const result = await client.query<EmissionFactor>(
    `
    SELECT
      factor_key,
      unit,
      tco2e_per_unit::text AS tco2e_per_unit
    FROM emission_factors
    ORDER BY factor_key
    `,
  );

  return result.rows;
}

export async function findEmissionFactorForUpdate(
  client: PoolClient,
  factorKey: string,
): Promise<EmissionFactor | null> {
  const result = await client.query<EmissionFactor>(
    `
    SELECT
      factor_key,
      unit,
      tco2e_per_unit::text AS tco2e_per_unit
    FROM emission_factors
    WHERE factor_key = $1
    FOR UPDATE
    `,
    [factorKey],
  );

  return result.rows[0] ?? null;
}

export async function updateEmissionFactor(
  client: PoolClient,
  factorKey: string,
  newValue: string,
): Promise<EmissionFactor | null> {
  const result = await client.query<EmissionFactor>(
    `
    UPDATE emission_factors
    SET tco2e_per_unit = $2
    WHERE factor_key = $1
    RETURNING
      factor_key,
      unit,
      tco2e_per_unit::text AS tco2e_per_unit
    `,
    [factorKey, newValue],
  );

  return result.rows[0] ?? null;
}

export async function insertFactorHistory(
  client: PoolClient,
  history: {
    factor_key: string;
    old_value: string;
    new_value: string;
    reason: string;
  },
): Promise<FactorHistoryRecord> {
  const result = await client.query<FactorHistoryRecord>(
    `
    INSERT INTO factor_history (
      tenant_id,
      factor_key,
      old_value,
      new_value,
      reason
    )
    VALUES (
      current_setting('app.tenant_id'),
      $1,
      $2,
      $3,
      $4
    )
    RETURNING
      history_id::text AS history_id,
      factor_key,
      old_value::text AS old_value,
      new_value::text AS new_value,
      reason,
      changed_at
    `,
    [history.factor_key, history.old_value, history.new_value, history.reason],
  );

  return result.rows[0];
}
