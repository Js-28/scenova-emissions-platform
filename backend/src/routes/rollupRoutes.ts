
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { authenticateToken } from '../middleware/auth';
import { withTenantTransaction } from '../utils/tenantTransaction';
import { calculateRollup } from '../services/rollupService';

const router = Router();

const financialYearSchema = z.coerce
  .number()
  .int()
  .min(1900)
  .max(9999);

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Authenticated tenant not found.',
    });
  }

  const parsedYear = financialYearSchema.safeParse(req.query.fy);

  if (!parsedYear.success) {
    return res.status(400).json({
      error: 'A valid financial year is required.',
      example: '/api/rollup?fy=2026',
    });
  }

  try {
    const result = await withTenantTransaction(
      tenantId,
      async (client) => {
        return calculateRollup(client, parsedYear.data);
      },
    );

    return res.status(200).json({
      tenant_id: tenantId,
      ...result,
    });
  } catch (error) {
    console.error(
      'Rollup calculation failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );

    return res.status(500).json({
      error: 'Emissions rollup could not be calculated.',
    });
  }
});

export default router;
