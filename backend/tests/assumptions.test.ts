import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import Decimal from "decimal.js";

import app from "../src/app";
import { env } from "../src/config/env";
import { withTenantTransaction } from "../src/utils/tenantTransaction";
import { changeEmissionFactor } from "../src/services/assumptionsService";

describe("Assumptions API", () => {
  const alphaToken = jwt.sign({ tenant_id: "t_alpha" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  const betaToken = jwt.sign({ tenant_id: "t_beta" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  // Retrieve the current diesel factor for a tenant.
  const getDieselFactor = async (token: string) => {
    const response = await request(app)
      .get("/api/assumptions")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const factor = response.body.factors.find(
      (item: { factor_key: string }) => item.factor_key === "diesel",
    );

    expect(factor).toBeDefined();

    return factor;
  };

  it("should reject requests without authentication", async () => {
    const response = await request(app).get("/api/assumptions");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
  });

  it("should return Alpha emission factors", async () => {
    const response = await request(app)
      .get("/api/assumptions")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_alpha");

    expect(response.body.factors).toBeInstanceOf(Array);
    expect(response.body.factors.length).toBeGreaterThan(0);

    for (const factor of response.body.factors) {
      expect(factor).toHaveProperty("factor_key");
      expect(factor).toHaveProperty("unit");
      expect(factor).toHaveProperty("tco2e_per_unit");
    }
  });

  it("should return Beta emission factors", async () => {
    const response = await request(app)
      .get("/api/assumptions")
      .set("Authorization", `Bearer ${betaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_beta");

    expect(response.body.factors).toBeInstanceOf(Array);
    expect(response.body.factors.length).toBeGreaterThan(0);
  });

  it("should reject factor updates without authentication", async () => {
    const response = await request(app).put("/api/assumptions/diesel").send({
      tco2e_per_unit: "0.0030",
      reason: "Testing factor update",
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
  });

  it("should return 404 when updating an unknown factor", async () => {
    const currentFactor = await getDieselFactor(alphaToken);
    const response = await request(app)
      .put("/api/assumptions/unknown-factor")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "0.0030",
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
        reason: "Testing unknown factor",
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Emission factor not found.");
  });

  it("should reject factor updates without an expected current value", async () => {
    const response = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "0.0030",
        reason: "Testing missing expected value",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid factor update request.");
  });

  it("should reject a negative emission factor", async () => {
    const currentFactor = await getDieselFactor(alphaToken);
    const response = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "-0.0030",
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
        reason: "Testing negative factor",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid factor update request.");
  });

  it("should reject an invalid decimal format", async () => {
    const currentFactor = await getDieselFactor(alphaToken);
    const response = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "abc",
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
        reason: "Testing invalid decimal",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid factor update request.");
  });

  it("should reject emission factors with more than 10 decimal places", async () => {
    const currentFactor = await getDieselFactor(alphaToken);
    const response = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "0.12345678901",
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
        reason: "Testing excessive precision",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Emission factor cannot have more than 10 decimal places.",
    );
  });

  it("should reject a missing or too-short update reason", async () => {
    const currentFactor = await getDieselFactor(alphaToken);
    // const missingReasonResponse = await request(app)
    //   .put('/api/assumptions/diesel')
    //   .set('Authorization', `Bearer ${alphaToken}`)
    //   .send({
    //     tco2e_per_unit: '0.0031',
    //   });
    const missingReasonResponse = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "0.0031",
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
      });
    expect(missingReasonResponse.status).toBe(400);
    expect(missingReasonResponse.body.error).toBe(
      "Invalid factor update request.",
    );

    // const shortReasonResponse = await request(app)
    //   .put('/api/assumptions/diesel')
    //   .set('Authorization', `Bearer ${alphaToken}`)
    //   .send({
    //     tco2e_per_unit: '0.0031',
    //     reason: 'Bad',
    //   });
    const shortReasonResponse = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: "0.0031",
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
        reason: "Bad",
      });

    expect(shortReasonResponse.status).toBe(400);
    expect(shortReasonResponse.body.error).toBe(
      "Invalid factor update request.",
    );
  });

  it("should reject an update when the new factor equals the current factor", async () => {
    const currentFactor = await getDieselFactor(alphaToken);

    const response = await request(app)
      .put("/api/assumptions/diesel")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        tco2e_per_unit: currentFactor.tco2e_per_unit,
        expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
        reason: "Testing unchanged factor",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "The new emission factor is the same as the current value.",
    );
  });

  it("should update an emission factor and create audit history", async () => {
    const originalFactor = await getDieselFactor(alphaToken);

    const originalValue = originalFactor.tco2e_per_unit;

    const newValue = new Decimal(originalValue)
      .plus("0.0000000001")
      .toFixed(10);

    try {
      const response = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          tco2e_per_unit: newValue,
          expected_tco2e_per_unit: originalValue,
          reason: "Automated integration test",
        });

      expect(response.status).toBe(200);

      expect(response.body.tenant_id).toBe("t_alpha");

      expect(response.body.message).toBe(
        "Emission factor updated successfully.",
      );

      expect(response.body.factor.factor_key).toBe("diesel");

      expect(response.body.factor.tco2e_per_unit).toBe(newValue);

      expect(response.body.history.factor_key).toBe("diesel");

      expect(response.body.history.old_value).toBe(
        new Decimal(originalValue).toFixed(10),
      );

      expect(response.body.history.new_value).toBe(newValue);

      expect(response.body.history.reason).toBe("Automated integration test");

      expect(response.body.history.history_id).toBeDefined();
      expect(response.body.history.changed_at).toBeDefined();

      // Confirm the database contains the updated value.
      const updatedFactor = await getDieselFactor(alphaToken);

      expect(updatedFactor.tco2e_per_unit).toBe(newValue);
    } finally {
      // Restore the original value to keep the test database clean.
      const restoreResponse = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          tco2e_per_unit: originalValue,
          expected_tco2e_per_unit: newValue,
          reason: "Restore original value after automated test",
        });

      expect(restoreResponse.status).toBe(200);
    }
  });

  it("should prevent Beta factor updates from changing Alpha factors", async () => {
    const alphaOriginalFactor = await getDieselFactor(alphaToken);
    const betaOriginalFactor = await getDieselFactor(betaToken);

    const alphaOriginalValue = alphaOriginalFactor.tco2e_per_unit;

    const betaOriginalValue = betaOriginalFactor.tco2e_per_unit;

    const betaNewValue = new Decimal(betaOriginalValue)
      .plus("0.0000000001")
      .toFixed(10);

    try {
      const updateResponse = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${betaToken}`)
        .send({
          tco2e_per_unit: betaNewValue,
          expected_tco2e_per_unit: betaOriginalValue,
          reason: "Testing tenant factor isolation",
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.tenant_id).toBe("t_beta");

      const alphaAfterUpdate = await getDieselFactor(alphaToken);
      const betaAfterUpdate = await getDieselFactor(betaToken);

      expect(alphaAfterUpdate.tco2e_per_unit).toBe(alphaOriginalValue);

      expect(betaAfterUpdate.tco2e_per_unit).toBe(betaNewValue);
    } finally {
      // Restore Beta's original factor.
      const restoreResponse = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${betaToken}`)
        .send({
          tco2e_per_unit: betaOriginalValue,
          expected_tco2e_per_unit: betaNewValue,
          reason: "Restore original value after isolation test",
        });

      expect(restoreResponse.status).toBe(200);
    }
  });

  it("should reject an update when the emission factor has changed since it was loaded", async () => {
    const originalFactor = await getDieselFactor(alphaToken);
    const originalValue = originalFactor.tco2e_per_unit;

    const firstNewValue = new Decimal(originalValue)
      .plus("0.0000000001")
      .toFixed(10);

    const staleNewValue = new Decimal(originalValue)
      .plus("0.0000000002")
      .toFixed(10);

    try {
      const firstResponse = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          tco2e_per_unit: firstNewValue,
          expected_tco2e_per_unit: originalValue,
          reason: "First user updates diesel factor",
        });

      expect(firstResponse.status).toBe(200);

      const staleResponse = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          tco2e_per_unit: staleNewValue,
          expected_tco2e_per_unit: originalValue,
          reason: "Second user submits stale factor",
        });

      expect(staleResponse.status).toBe(409);

      expect(staleResponse.body.error).toBe(
        "Emission factor has changed since it was loaded. Refresh and try again.",
      );

      const finalFactor = await getDieselFactor(alphaToken);

      expect(finalFactor.tco2e_per_unit).toBe(firstNewValue);
    } finally {
      const currentFactor = await getDieselFactor(alphaToken);

      if (currentFactor.tco2e_per_unit !== originalValue) {
        const restoreResponse = await request(app)
          .put("/api/assumptions/diesel")
          .set("Authorization", `Bearer ${alphaToken}`)
          .send({
            tco2e_per_unit: originalValue,
            expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
            reason: "Restore original factor after stale update test",
          });

        expect(restoreResponse.status).toBe(200);
      }
    }
  });

  it("should allow only one of two simultaneous updates using the same expected value", async () => {
    const originalFactor = await getDieselFactor(alphaToken);
    const originalValue = originalFactor.tco2e_per_unit;

    const firstNewValue = new Decimal(originalValue)
      .plus("0.0000000001")
      .toFixed(10);

    const secondNewValue = new Decimal(originalValue)
      .plus("0.0000000002")
      .toFixed(10);

    const reasons = ["First simultaneous update", "Second simultaneous update"];

    const getHistoryCount = async () =>
      withTenantTransaction("t_alpha", async (client) => {
        const result = await client.query<{ count: string }>(
          `
      SELECT COUNT(*)::text AS count
      FROM factor_history
      WHERE factor_key = $1
        AND reason = ANY($2::text[])
      `,
          ["diesel", reasons],
        );

        return Number(result.rows[0].count);
      });

    const historyCountBefore = await getHistoryCount();

    try {
      const makeUpdateRequest = (newValue: string, reason: string) =>
        request(app)
          .put("/api/assumptions/diesel")
          .set("Authorization", `Bearer ${alphaToken}`)
          .send({
            tco2e_per_unit: newValue,
            expected_tco2e_per_unit: originalValue,
            reason,
          });

      const [firstResponse, secondResponse] = await Promise.all([
        makeUpdateRequest(firstNewValue, "First simultaneous update"),
        makeUpdateRequest(secondNewValue, "Second simultaneous update"),
      ]);

      const responses = [firstResponse, secondResponse];

      expect(
        responses.filter((response) => response.status === 200),
      ).toHaveLength(1);

      expect(
        responses.filter((response) => response.status === 409),
      ).toHaveLength(1);

      const finalFactor = await getDieselFactor(alphaToken);

      expect([firstNewValue, secondNewValue]).toContain(
        finalFactor.tco2e_per_unit,
      );
      const historyCountAfter = await getHistoryCount();

      expect(historyCountAfter - historyCountBefore).toBe(1);
    } finally {
      const currentFactor = await getDieselFactor(alphaToken);

      if (currentFactor.tco2e_per_unit !== originalValue) {
        const restoreResponse = await request(app)
          .put("/api/assumptions/diesel")
          .set("Authorization", `Bearer ${alphaToken}`)
          .send({
            tco2e_per_unit: originalValue,
            expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
            reason: "Restore original factor after simultaneous update test",
          });

        expect(restoreResponse.status).toBe(200);
      }
    }
  });

  it("should roll back the factor update if audit history insertion fails", async () => {
    const originalFactor = await getDieselFactor(alphaToken);
    const originalValue = originalFactor.tco2e_per_unit;

    const newValue = new Decimal(originalValue)
      .plus("0.0000000001")
      .toFixed(10);

    await expect(
      withTenantTransaction("t_alpha", async (client) =>
        changeEmissionFactor(client, {
          factor_key: "diesel",
          new_value: newValue,
          expected_value: originalValue,
          reason: "",
        }),
      ),
    ).rejects.toThrow();

    const finalFactor = await getDieselFactor(alphaToken);

    expect(finalFactor.tco2e_per_unit).toBe(originalValue);
  });
});
