import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { env } from "../src/config/env";

describe("Tenant database isolation", () => {
  const alphaToken = jwt.sign({ tenant_id: "t_alpha" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  const betaToken = jwt.sign({ tenant_id: "t_beta" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  it("should allow Alpha to see only its own tenant record", async () => {
    const response = await request(app)
      .get("/api/tenant/data")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.authenticated_tenant).toBe("t_alpha");
    expect(response.body.visible_tenant_count).toBe(1);
    expect(response.body.visible_tenants).toEqual([
      {
        tenant_id: "t_alpha",
        tenant_name: "Tenant Alpha",
      },
    ]);
  });

  it("should allow Beta to see only its own tenant record", async () => {
    const response = await request(app)
      .get("/api/tenant/data")
      .set("Authorization", `Bearer ${betaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.authenticated_tenant).toBe("t_beta");
    expect(response.body.visible_tenant_count).toBe(1);
    expect(response.body.visible_tenants).toEqual([
      {
        tenant_id: "t_beta",
        tenant_name: "Tenant Beta",
      },
    ]);
  });
});
