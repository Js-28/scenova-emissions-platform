import type { PoolClient } from "pg";
import { pool } from "../config/db";

export async function withTenantTransaction<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error("A valid tenant ID is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Set the tenant context locally for this transaction only.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Database rollback failed:",
        rollbackError instanceof Error
          ? rollbackError.message
          : "Unknown rollback error",
      );
    }

    throw error;
  } finally {
    client.release();
  }
}
