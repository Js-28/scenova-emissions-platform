
import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';

import {
  getRollupRows,
  type RollupRow,
} from '../repositories/rollupRepository';

export interface RollupResponse {
  financial_year: number;
  period: {
    start: string;
    end: string;
  };
  scope_totals: {
    scope_1: string;
    scope_2: string;
    scope_3: string;
  };
  total_emissions_tco2e: string;
  category_totals: {
    category: string;
    scope: number;
    emissions_tco2e: string;
  }[];
}

export async function calculateRollup(
  client: PoolClient,
  financialYear: number,
): Promise<RollupResponse> {
  const rows: RollupRow[] = await getRollupRows(
    client,
    financialYear,
  );

  const scopeTotals = {
    scope_1: new Decimal(0),
    scope_2: new Decimal(0),
    scope_3: new Decimal(0),
  };

  const categoryTotals = rows.map((row) => {
    const emissions = new Decimal(row.emissions_tco2e);

    if (row.scope === 1) {
      scopeTotals.scope_1 = scopeTotals.scope_1.plus(emissions);
    } else if (row.scope === 2) {
      scopeTotals.scope_2 = scopeTotals.scope_2.plus(emissions);
    } else if (row.scope === 3) {
      scopeTotals.scope_3 = scopeTotals.scope_3.plus(emissions);
    }

    return {
      category: row.category,
      scope: row.scope,
      emissions_tco2e: emissions.toFixed(16),
    };
  });

  const total = scopeTotals.scope_1
    .plus(scopeTotals.scope_2)
    .plus(scopeTotals.scope_3);

  return {
    financial_year: financialYear,
    period: {
      start: `${financialYear - 1}-07-01`,
      end: `${financialYear}-06-30`,
    },
    scope_totals: {
      scope_1: scopeTotals.scope_1.toFixed(16),
      scope_2: scopeTotals.scope_2.toFixed(16),
      scope_3: scopeTotals.scope_3.toFixed(16),
    },
    total_emissions_tco2e: total.toFixed(16),
    category_totals: categoryTotals,
  };
}
