
import type { PoolClient } from 'pg';

export interface RollupRow {
  scope: number;
  category: string;
  emissions_tco2e: string;
}

export async function getRollupRows(
  client: PoolClient,
  financialYear: number,
): Promise<RollupRow[]> {
  const result = await client.query<RollupRow>(
    `
    WITH financial_year_boundaries AS (
      SELECT
        make_timestamptz(
          $1 - 1, 7, 1, 0, 0, 0, 'Australia/Melbourne'
        ) AS start_at,
        make_timestamptz(
          $1, 7, 1, 0, 0, 0, 'Australia/Melbourne'
        ) AS end_at
    )
    SELECT
      a.scope,
      a.category,
      SUM(a.emissions_tco2e)::text AS emissions_tco2e
    FROM activities AS a
    CROSS JOIN financial_year_boundaries AS fy
    WHERE a.occurred_at >= fy.start_at
      AND a.occurred_at < fy.end_at
    GROUP BY
      a.scope,
      a.category
    ORDER BY
      a.scope,
      a.category
    `,
    [financialYear],
  );

  return result.rows;
}
