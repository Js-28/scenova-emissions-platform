import { Router, type Request, type Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { withTenantTransaction } from "../utils/tenantTransaction";

const router = Router();

// GET /api/tenant
// Returns the authenticated tenant identity.
router.get("/", authenticateToken, (req: Request, res: Response): void => {
  if (!req.tenantId) {
    res.status(401).json({
      error: "Authenticated tenant information is missing.",
    });
    return;
  }

  res.status(200).json({
    tenant_id: req.tenantId,
    message: "Authenticated successfully",
  });
});

// GET /api/tenant/data
// Demonstrates PostgreSQL Row-Level Security.
router.get(
  "/data",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.tenantId;

    if (!tenantId) {
      res.status(401).json({
        error: "Authenticated tenant information is missing.",
      });
      return;
    }

    try {
      const visibleTenants = await withTenantTransaction(
        tenantId,
        async (client) => {
          const result = await client.query(
            `SELECT tenant_id, tenant_name
             FROM tenants
             ORDER BY tenant_id`,
          );

          return result.rows;
        },
      );

      res.status(200).json({
        authenticated_tenant: tenantId,
        visible_tenants: visibleTenants,
        visible_tenant_count: visibleTenants.length,
      });
    } catch (error) {
      console.error(
        "Tenant data query failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(500).json({
        error: "Unable to retrieve tenant data.",
      });
    }
  },
);

export default router;
