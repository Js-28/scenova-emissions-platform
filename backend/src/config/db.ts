import { Pool } from "pg";
import { env } from "./env";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log unexpected errors from idle connections.
// Never log database credentials.
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});
