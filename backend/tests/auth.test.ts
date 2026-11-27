import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { env } from "../src/config/env";

describe("Authentication API", () => {
  const alphaToken = jwt.sign({ tenant_id: "t_alpha" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  const betaToken = jwt.sign({ tenant_id: "t_beta" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  it("should reject requests without an authentication token", async () => {
    const response = await request(app).get("/api/tenant");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
  });

  it("should identify the Alpha tenant using a valid JWT", async () => {
    const response = await request(app)
      .get("/api/tenant")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_alpha");
    expect(response.body.message).toBe("Authenticated successfully");
  });

  it("should identify the Beta tenant using a valid JWT", async () => {
    const response = await request(app)
      .get("/api/tenant")
      .set("Authorization", `Bearer ${betaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_beta");
    expect(response.body.message).toBe("Authenticated successfully");
  });
});
