import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticateToken } from "../middleware/auth";
import { withTenantTransaction } from "../utils/tenantTransaction";
import {
  listAssumptions,
  changeEmissionFactor,
} from "../services/assumptionsService";

const router = Router();

const factorKeySchema = z.string().trim().min(1).max(100);

// const updateFactorSchema = z.object({
//   tco2e_per_unit: z.string().regex(
//     /^(?:\d+(?:\.\d*)?|\.\d+)$/,
//     'Emission factor must be a valid non-negative decimal string.',
//   ),
//   reason: z.string().trim().min(5).max(500),
// });

const updateFactorSchema = z.object({
  tco2e_per_unit: z
    .string()
    .regex(
      /^(?:\d+(?:\.\d*)?|\.\d+)$/,
      "Emission factor must be a valid non-negative decimal string.",
    ),
  expected_tco2e_per_unit: z
    .string()
    .regex(
      /^(?:\d+(?:\.\d*)?|\.\d+)$/,
      "Expected emission factor must be a valid non-negative decimal string.",
    ),
  reason: z.string().trim().min(5).max(500),
});

router.get("/", authenticateToken, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: "Authenticated tenant not found.",
    });
  }

  try {
    const factors = await withTenantTransaction(tenantId, async (client) =>
      listAssumptions(client),
    );

    return res.status(200).json({
      tenant_id: tenantId,
      factors,
    });
  } catch (error) {
    console.error(
      "Assumptions retrieval failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return res.status(500).json({
      error: "Emission factors could not be retrieved.",
    });
  }
});

router.put(
  "/:factor_key",
  authenticateToken,
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        error: "Authenticated tenant not found.",
      });
    }

    const parsedFactorKey = factorKeySchema.safeParse(req.params.factor_key);

    if (!parsedFactorKey.success) {
      return res.status(400).json({
        error: "A valid factor key is required.",
      });
    }

    const parsedBody = updateFactorSchema.safeParse(req.body);

    if (!parsedBody.success) {
      return res.status(400).json({
        error: "Invalid factor update request.",
        details: parsedBody.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await withTenantTransaction(tenantId, async (client) => {
        //   return changeEmissionFactor(client, {
        //     factor_key: parsedFactorKey.data,
        //     new_value: parsedBody.data.tco2e_per_unit,
        //     reason: parsedBody.data.reason,
        //   });
        return changeEmissionFactor(client, {
          factor_key: parsedFactorKey.data,
          new_value: parsedBody.data.tco2e_per_unit,
          expected_value: parsedBody.data.expected_tco2e_per_unit,
          reason: parsedBody.data.reason,
        });
      });

      return res.status(200).json({
        message: "Emission factor updated successfully.",
        tenant_id: tenantId,
        factor: result.factor,
        history: result.history,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Emission factor not found.") {
          return res.status(404).json({
            error: error.message,
          });
        }

        if (
          error.message ===
          "Emission factor has changed since it was loaded. Refresh and try again."
        ) {
          return res.status(409).json({
            error: error.message,
          });
        }

        if (
          error.message ===
            "The new emission factor is the same as the current value." ||
          error.message ===
            "Emission factor cannot have more than 10 decimal places." ||
          error.message ===
            "Emission factor must be a valid non-negative decimal."
        ) {
          return res.status(400).json({
            error: error.message,
          });
        }
      }

      console.error(
        "Emission factor update failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      return res.status(500).json({
        error: "Emission factor could not be updated.",
      });
    }
  },
);

export default router;
