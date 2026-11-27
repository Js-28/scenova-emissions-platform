import type { PoolClient } from "pg";

export interface EmissionFactor {
  factor_key: string;
  unit: string;
  tco2e_per_unit: string;
}

export interface NewActivity {
  activity_id: string;
  tenant_id: string;
  occurred_at: string;
  category: string;
  scope: number;
  quantity: string;
  unit: string;
  factor_key: string;
  factor_value: string;
  emissions_tco2e: string;
}

/**
 * Retrieves an emission factor belonging to the current tenant.
 * PostgreSQL RLS restricts the visible records.
 */
export async function findEmissionFactor(
  client: PoolClient,
  factorKey: string,
): Promise<EmissionFactor | null> {
  const result = await client.query<EmissionFactor>(
    `SELECT factor_key, unit, tco2e_per_unit
     FROM emission_factors
     WHERE factor_key = $1`,
    [factorKey],
  );

  return result.rows[0] ?? null;
}

/**
 * Inserts an activity.
 * Returns null when the tenant already has this activity_id.
 */

export async function insertActivity(
  client: PoolClient,
  activity: NewActivity,
): Promise<boolean> {
  const result = await client.query(
    `
      INSERT INTO activities (
        activity_id,
        tenant_id,
        occurred_at,
        category,
        scope,
        quantity,
        unit,
        factor_key,
        factor_value,
        emissions_tco2e
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, activity_id) DO NOTHING
      RETURNING activity_id
    `,
    [
      activity.activity_id,
      activity.tenant_id,
      activity.occurred_at,
      activity.category,
      activity.scope,
      activity.quantity,
      activity.unit,
      activity.factor_key,
      activity.factor_value,
      activity.emissions_tco2e,
    ],
  );

  return result.rowCount === 1;
}
