import type { PoolClient } from "pg";
import Decimal from "decimal.js";

import {
  getEmissionFactors,
  findEmissionFactorForUpdate,
  updateEmissionFactor,
  insertFactorHistory,
  type EmissionFactor,
  type FactorHistoryRecord,
} from "../repositories/assumptionsRepository";

// export interface UpdateFactorInput {
//   factor_key: string;
//   new_value: string;
//   reason: string;
// }

export interface UpdateFactorInput {
  factor_key: string;
  new_value: string;
  expected_value: string;
  reason: string;
}

export interface UpdateFactorResult {
  factor: EmissionFactor;
  history: FactorHistoryRecord;
}

export async function listAssumptions(
  client: PoolClient,
): Promise<EmissionFactor[]> {
  return getEmissionFactors(client);
}

export async function changeEmissionFactor(
  client: PoolClient,
  input: UpdateFactorInput,
): Promise<UpdateFactorResult> {
  const newValue = new Decimal(input.new_value);

  if (!newValue.isFinite() || newValue.isNegative()) {
    throw new Error("Emission factor must be a valid non-negative decimal.");
  }

  if (newValue.decimalPlaces() > 10) {
    throw new Error("Emission factor cannot have more than 10 decimal places.");
  }

  const currentFactor = await findEmissionFactorForUpdate(
    client,
    input.factor_key,
  );

  if (!currentFactor) {
    throw new Error("Emission factor not found.");
  }

  //   const oldValue = new Decimal(currentFactor.tco2e_per_unit);

  //   if (oldValue.equals(newValue)) {
  //     throw new Error('The new emission factor is the same as the current value.');
  //   }

  const oldValue = new Decimal(currentFactor.tco2e_per_unit);
  const expectedValue = new Decimal(input.expected_value);

  if (!expectedValue.isFinite() || expectedValue.isNegative()) {
    throw new Error(
      "Expected emission factor must be a valid non-negative decimal.",
    );
  }

  if (!oldValue.equals(expectedValue)) {
    throw new Error(
      "Emission factor has changed since it was loaded. Refresh and try again.",
    );
  }

  if (oldValue.equals(newValue)) {
    throw new Error(
      "The new emission factor is the same as the current value.",
    );
  }

  const updatedFactor = await updateEmissionFactor(
    client,
    input.factor_key,
    newValue.toFixed(10),
  );

  if (!updatedFactor) {
    throw new Error("Emission factor could not be updated.");
  }

  const history = await insertFactorHistory(client, {
    factor_key: input.factor_key,
    old_value: oldValue.toFixed(10),
    new_value: newValue.toFixed(10),
    reason: input.reason,
  });

  return {
    factor: updatedFactor,
    history,
  };
}
