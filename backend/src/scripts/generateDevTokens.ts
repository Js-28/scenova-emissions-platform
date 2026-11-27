import jwt from "jsonwebtoken";
import { env } from "../config/env";

if (env.NODE_ENV !== "development") {
  throw new Error("Development tokens can only be generated in development.");
}

function generateToken(tenantId: string): string {
  return jwt.sign({ tenant_id: tenantId }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
}

const alphaToken = generateToken("t_alpha");
const betaToken = generateToken("t_beta");

console.log("\n========== SCENOVA DEVELOPMENT TOKENS ==========\n");

console.log("TENANT ALPHA (t_alpha):");
console.log(alphaToken);

console.log("\nTENANT BETA (t_beta):");
console.log(betaToken);

console.log("\nTokens expire in 1 hour.");
console.log("================================================\n");
