import { z } from "zod";
import Decimal from "decimal.js";
import type { PoolClient } from "pg";

import {
  findEmissionFactor,
  insertActivity,
  type NewActivity,
} from "../repositories/activityRepository";

const activitySchema = z.object({
  activity_id: z.string().trim().min(1).max(100),
  occurred_at: z.string().datetime({ offset: true }),
  category: z.string().trim().min(1).max(150),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  quantity: z
    .string()
    .regex(
      /^-?(?:\d+(?:\.\d*)?|\.\d+)$/,
      "Quantity must be a valid decimal number.",
    ),
  unit: z.string().trim().min(1).max(20),
  factor_key: z.string().trim().min(1).max(100),
});

const MAX_QUANTITY = new Decimal("1000000000");

interface ActivityInput {
  activity_id: string;
  occurred_at: string;
  category: string;
  scope: 1 | 2 | 3;
  quantity: string;
  unit: string;
  factor_key: string;
}

interface ActivityResult {
  activity_id?: string;
  status: "accepted" | "rejected" | "duplicate";
  emissions_tco2e?: string;
  reason?: string;
}

interface NormalisedQuantity {
  quantity: Decimal;
  unit: string;
}

function normaliseQuantity(
  quantity: Decimal,
  unit: string,
): NormalisedQuantity | null {
  const normalisedUnit = unit.trim().toUpperCase();

  // Convert kilolitres to litres.
  if (normalisedUnit === "KL") {
    return {
      quantity: quantity.mul(1000),
      unit: "L",
    };
  }

  // Standardise common unit representations.
  const unitMap: Record<string, string> = {
    L: "L",
    KWH: "kWh",
    GJ: "GJ",
    TKM: "tkm",
    KM: "km",
  };

  const canonicalUnit = unitMap[normalisedUnit];

  if (!canonicalUnit) {
    return null;
  }

  return {
    quantity,
    unit: canonicalUnit,
  };
}

async function processOneActivity(
  client: PoolClient,
  tenantId: string,
  input: unknown,
): Promise<ActivityResult> {
  const parsed = activitySchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "rejected",
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }

  const activity = parsed.data as ActivityInput;

  const quantity = new Decimal(activity.quantity);

  if (!quantity.isFinite()) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: "Quantity must be a valid finite number.",
    };
  }

  if (quantity.isNegative() || quantity.isZero()) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: "Quantity must be greater than zero.",
    };
  }

  if (quantity.decimalPlaces() > 6) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: "Quantity cannot have more than 6 decimal places.",
    };
  }

  const normalised = normaliseQuantity(quantity, activity.unit);

  if (!normalised) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: `Unsupported unit: ${activity.unit}.`,
    };
  }

  if (normalised.quantity.greaterThan(MAX_QUANTITY)) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: "Quantity exceeds the permitted limit of 1 billion units.",
    };
  }

  const factor = await findEmissionFactor(client, activity.factor_key);

  if (!factor) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: `Emission factor '${activity.factor_key}' was not found for this tenant.`,
    };
  }

  if (normalised.unit !== factor.unit) {
    return {
      activity_id: activity.activity_id,
      status: "rejected",
      reason: `Unit mismatch: activity uses ${normalised.unit}, but factor requires ${factor.unit}.`,
    };
  }

  // Exact decimal multiplication. No JavaScript floating-point maths.
  const emissions = normalised.quantity.mul(new Decimal(factor.tco2e_per_unit));

  const newActivity: NewActivity = {
    activity_id: activity.activity_id,
    tenant_id: tenantId,
    occurred_at: activity.occurred_at,
    category: activity.category,
    scope: activity.scope,
    quantity: normalised.quantity.toFixed(6),
    unit: normalised.unit,
    factor_key: activity.factor_key,
    factor_value: factor.tco2e_per_unit,
    emissions_tco2e: emissions.toFixed(16),
  };
  const inserted = await insertActivity(client, newActivity);

  if (!inserted) {
    return {
      activity_id: activity.activity_id,
      status: "duplicate",
      reason: "This activity ID already exists for this tenant.",
    };
  }

  return {
    activity_id: activity.activity_id,
    status: "accepted",
    emissions_tco2e: emissions.toString(),
  };
}

export async function ingestActivities(
  client: PoolClient,
  tenantId: string,
  inputs: unknown[],
): Promise<ActivityResult[]> {
  const results: ActivityResult[] = [];

  for (const input of inputs) {
    const result = await processOneActivity(client, tenantId, input);

    results.push(result);
  }

  return results;
}
