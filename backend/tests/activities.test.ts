import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { env } from "../src/config/env";
import * as uploadRepository from "../src/repositories/uploadRepository";
import Decimal from "decimal.js";
import { withTenantTransaction } from "../src/utils/tenantTransaction";

describe("Activity API", () => {
  const alphaToken = jwt.sign({ tenant_id: "t_alpha" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  const betaToken = jwt.sign({ tenant_id: "t_beta" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  const createActivity = (activityId: string) => ({
    activity_id: activityId,
    occurred_at: "2026-04-15T00:00:00.000Z",
    category: "Fleet diesel",
    scope: 1,
    quantity: "1000",
    unit: "L",
    factor_key: "diesel",
  });

  const getDieselFactor = async () => {
    const response = await request(app)
      .get("/api/assumptions")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);

    const factor = response.body.factors.find(
      (item: { factor_key: string }) => item.factor_key === "diesel",
    );

    expect(factor).toBeDefined();

    return factor;
  };

  it("should reject requests without authentication", async () => {
    const response = await request(app)
      .post("/api/activities")
      .send({
        activities: [createActivity("test-no-auth")],
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
  });

  it("should accept a valid activity upload", async () => {
    const activityId = `test-alpha-${Date.now()}`;
    const factor = await getDieselFactor();

    const expectedEmissions = new Decimal("1000")
      .mul(factor.tco2e_per_unit)
      .toString();

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("X-Filename", "automated-test.json")
      .send({
        activities: [createActivity(activityId)],
      });

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_alpha");

    expect(response.body.summary).toEqual({
      total_rows: 1,
      accepted_rows: 1,
      rejected_rows: 0,
      duplicate_rows: 0,
    });

    expect(response.body.results[0].status).toBe("accepted");
    // expect(response.body.results[0].emissions_tco2e).toBe('2.8');
    expect(response.body.results[0].emissions_tco2e).toBe(expectedEmissions);
    expect(response.body.upload.filename).toBe("automated-test.json");
  });

  it("should detect duplicate activities", async () => {
    const activityId = `test-duplicate-${Date.now()}`;

    const activity = createActivity(activityId);

    const firstResponse = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [activity],
      });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.summary.accepted_rows).toBe(1);

    const secondResponse = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [activity],
      });

    expect(secondResponse.status).toBe(200);

    expect(secondResponse.body.summary).toEqual({
      total_rows: 1,
      accepted_rows: 0,
      rejected_rows: 0,
      duplicate_rows: 1,
    });

    expect(secondResponse.body.results[0].status).toBe("duplicate");
  });

  it("should reject activities with a negative quantity", async () => {
    const activity = {
      ...createActivity(`test-invalid-${Date.now()}`),
      quantity: "-100",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [activity],
      });

    expect(response.status).toBe(200);

    expect(response.body.summary).toEqual({
      total_rows: 1,
      accepted_rows: 0,
      rejected_rows: 1,
      duplicate_rows: 0,
    });

    expect(response.body.results[0].status).toBe("rejected");

    expect(response.body.results[0].reason).toBe(
      "Quantity must be greater than zero.",
    );
  });

  it("should not allow Beta to access Alpha emission factors", async () => {
    const activity = {
      ...createActivity(`test-beta-factor-${Date.now()}`),
      factor_key: "nonexistent-alpha-factor",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${betaToken}`)
      .send({
        activities: [activity],
      });

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_beta");
    expect(response.body.summary.rejected_rows).toBe(1);

    expect(response.body.results[0].status).toBe("rejected");

    expect(response.body.results[0].reason).toContain(
      "was not found for this tenant.",
    );
  });

  it("should reject an activity with zero quantity", async () => {
    const activity = {
      ...createActivity(`test-zero-${Date.now()}`),
      quantity: "0",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].reason).toBe(
      "Quantity must be greater than zero.",
    );
  });

  it("should reject an unsupported unit", async () => {
    const activity = {
      ...createActivity(`test-unit-${Date.now()}`),
      unit: "XYZ",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].reason).toContain("Unsupported unit");
  });

  it("should reject an activity with a unit mismatch", async () => {
    const activity = {
      ...createActivity(`test-mismatch-${Date.now()}`),
      unit: "kWh",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].reason).toContain("Unit mismatch");
  });

  it("should reject quantities with more than 6 decimal places", async () => {
    const activity = {
      ...createActivity(`test-precision-${Date.now()}`),
      quantity: "100.1234567",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].reason).toBe(
      "Quantity cannot have more than 6 decimal places.",
    );
  });

  it("should reject an unknown emission factor", async () => {
    const activity = {
      ...createActivity(`test-factor-${Date.now()}`),
      factor_key: "unknown-factor",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].reason).toContain(
      "was not found for this tenant.",
    );
  });

  it("should reject an empty activities array", async () => {
    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid upload request.");
  });

  it("should reject uploads containing more than 500 activities", async () => {
    const activities = Array.from({ length: 501 }, (_, index) =>
      createActivity(`test-limit-${Date.now()}-${index}`),
    );

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid upload request.");
  });

  it("should reject an activity with an invalid date format", async () => {
    const activity = {
      ...createActivity(`test-invalid-date-${Date.now()}`),
      occurred_at: "2026-04-15",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].status).toBe("rejected");
  });

  it("should reject an activity with an invalid scope of zero", async () => {
    const activity = {
      ...createActivity(`test-scope-zero-${Date.now()}`),
      scope: 0,
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].status).toBe("rejected");
  });

  it("should reject an activity with an invalid scope of four", async () => {
    const activity = {
      ...createActivity(`test-scope-four-${Date.now()}`),
      scope: 4,
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].status).toBe("rejected");
  });

  it("should reject an activity with a non-numeric quantity", async () => {
    const activity = {
      ...createActivity(`test-invalid-quantity-${Date.now()}`),
      quantity: "one hundred" as string,
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].status).toBe("rejected");
  });

  it("should reject an activity with a quantity above the maximum limit", async () => {
    const activity = {
      ...createActivity(`test-max-quantity-${Date.now()}`),
      quantity: "1000000001",
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].status).toBe("rejected");
  });

  it("should reject an activity with a missing required field", async () => {
    const activity = {
      activity_id: `test-missing-field-${Date.now()}`,
      occurred_at: "2026-04-15T00:00:00.000Z",
      category: "Fleet diesel",
      scope: 1,
      quantity: "1000",
      unit: "L",
      // factor_key intentionally missing
    };

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.rejected_rows).toBe(1);
    expect(response.body.results[0].status).toBe("rejected");
  });

  it("should correctly convert kilolitres into litres", async () => {
    const activity = {
      ...createActivity(`test-kl-conversion-${Date.now()}`),
      quantity: "1",
      unit: "KL",
    };
    const factor = await getDieselFactor();

    const expectedEmissions = new Decimal("1000")
      .mul(factor.tco2e_per_unit)
      .toString();

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities: [activity] });

    expect(response.status).toBe(200);
    expect(response.body.summary.accepted_rows).toBe(1);
    expect(response.body.results[0].status).toBe("accepted");
    // expect(response.body.results[0].emissions_tco2e).toBe('2.8');
    expect(response.body.results[0].emissions_tco2e).toBe(expectedEmissions);
  });

  it("should process accepted and rejected rows in the same upload", async () => {
    const uniqueId = Date.now();

    const activities = [
      createActivity(`test-mixed-valid-${uniqueId}`),
      {
        ...createActivity(`test-mixed-invalid-${uniqueId}`),
        quantity: "-100",
      },
    ];

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({ activities });

    expect(response.status).toBe(200);

    expect(response.body.summary).toEqual({
      total_rows: 2,
      accepted_rows: 1,
      rejected_rows: 1,
      duplicate_rows: 0,
    });

    expect(response.body.results[0].status).toBe("accepted");
    expect(response.body.results[1].status).toBe("rejected");
  });

  // it("should prevent simultaneous duplicate uploads from creating duplicate activities", async () => {
  //   const activityId = `test-concurrent-duplicate-${Date.now()}`;
  //   const activity = createActivity(activityId);

  //   const makeUploadRequest = () =>
  //     request(app)
  //       .post("/api/activities")
  //       .set("Authorization", `Bearer ${alphaToken}`)
  //       .send({
  //         activities: [activity],
  //       });

  //   // Send both requests at the same time.
  //   const [firstResponse, secondResponse] = await Promise.all([
  //     makeUploadRequest(),
  //     makeUploadRequest(),
  //   ]);

  //   expect(firstResponse.status).toBe(200);
  //   expect(secondResponse.status).toBe(200);

  //   const responses = [firstResponse, secondResponse];

  //   const acceptedCount = responses.reduce(
  //     (total, response) => total + response.body.summary.accepted_rows,
  //     0,
  //   );

  //   const duplicateCount = responses.reduce(
  //     (total, response) => total + response.body.summary.duplicate_rows,
  //     0,
  //   );

  //   expect(acceptedCount).toBe(1);
  //   expect(duplicateCount).toBe(1);

  //   const statuses = responses.map(
  //     (response) => response.body.results[0].status,
  //   );

  //   expect(statuses.sort()).toEqual(["accepted", "duplicate"]);
  // });

  it("should prevent simultaneous duplicate uploads from creating duplicate activities", async () => {
    const activityId = `test-concurrent-duplicate-${Date.now()}`;
    const activity = createActivity(activityId);

    const makeUploadRequest = () =>
      request(app)
        .post("/api/activities")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          activities: [activity],
        });

    // Send both requests at the same time.
    const [firstResponse, secondResponse] = await Promise.all([
      makeUploadRequest(),
      makeUploadRequest(),
    ]);

    const responses = [firstResponse, secondResponse];

    // Both uploads should complete successfully at the API level.
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    // Each upload should contain exactly one processed row.
    for (const response of responses) {
      expect(response.body.summary.total_rows).toBe(1);
      expect(
        response.body.summary.accepted_rows +
          response.body.summary.duplicate_rows,
      ).toBe(1);
      expect(response.body.summary.rejected_rows).toBe(0);
      expect(response.body.upload.upload_id).toBeDefined();
    }

    // Across both requests, exactly one activity should be accepted.
    const acceptedCount = responses.reduce(
      (total, response) => total + response.body.summary.accepted_rows,
      0,
    );

    const duplicateCount = responses.reduce(
      (total, response) => total + response.body.summary.duplicate_rows,
      0,
    );

    expect(acceptedCount).toBe(1);
    expect(duplicateCount).toBe(1);

    const statuses = responses.map(
      (response) => response.body.results[0].status,
    );

    expect(statuses.sort()).toEqual(["accepted", "duplicate"]);

    // Independently verify that PostgreSQL contains exactly one activity row.
    const persistedActivityCount = await withTenantTransaction(
      "t_alpha",
      async (client) => {
        const result = await client.query<{ count: string }>(
          `
        SELECT COUNT(*)::text AS count
        FROM activities
        WHERE tenant_id = $1
          AND activity_id = $2
        `,
          ["t_alpha", activityId],
        );

        return Number(result.rows[0].count);
      },
    );

    expect(persistedActivityCount).toBe(1);
  });
  it("should roll back activity inserts when upload record creation fails", async () => {
    const activityId = `test-rollback-${Date.now()}`;
    const activity = createActivity(activityId);

    const insertUploadRecordSpy = vi
      .spyOn(uploadRepository, "insertUploadRecord")
      .mockRejectedValueOnce(
        new Error("Simulated upload record database failure"),
      );

    try {
      const failedResponse = await request(app)
        .post("/api/activities")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          activities: [activity],
        });

      expect(failedResponse.status).toBe(500);

      // Retry the same activity ID after the failed transaction.
      const retryResponse = await request(app)
        .post("/api/activities")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          activities: [activity],
        });

      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body.summary.accepted_rows).toBe(1);
      expect(retryResponse.body.summary.duplicate_rows).toBe(0);
      expect(retryResponse.body.results[0].status).toBe("accepted");
    } finally {
      insertUploadRecordSpy.mockRestore();
    }
  });

  it("should preserve historical emissions when an emission factor changes", async () => {
    const uniqueId = Date.now();

    const originalFactor = await getDieselFactor();
    const originalValue = originalFactor.tco2e_per_unit;

    // Increase the factor by 0.0001 for this test.
    const newValue = new Decimal(originalValue).plus("0.0001").toFixed(10);

    const historicalCategory = `Historical diesel ${uniqueId}`;
    const newCategory = `Updated diesel ${uniqueId}`;

    const getCategoryEmissions = async (category: string) => {
      const response = await request(app)
        .get("/api/rollup?fy=2026")
        .set("Authorization", `Bearer ${alphaToken}`);

      expect(response.status).toBe(200);

      const matchingCategory = response.body.category_totals.find(
        (item: { category: string; scope: number }) =>
          item.category === category && item.scope === 1,
      );

      return matchingCategory
        ? new Decimal(matchingCategory.emissions_tco2e)
        : new Decimal(0);
    };

    try {
      // 1. Upload an activity using the original emission factor.
      const firstUpload = await request(app)
        .post("/api/activities")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          activities: [
            {
              ...createActivity(`historical-${uniqueId}`),
              category: historicalCategory,
            },
          ],
        });

      expect(firstUpload.status).toBe(200);
      expect(firstUpload.body.summary.accepted_rows).toBe(1);

      const originalEmissions = new Decimal(originalValue).mul(1000);

      expect(
        new Decimal(firstUpload.body.results[0].emissions_tco2e).eq(
          originalEmissions,
        ),
      ).toBe(true);

      // 2. Confirm the historical activity appears in the rollup.
      const historicalEmissionsBefore =
        await getCategoryEmissions(historicalCategory);

      expect(historicalEmissionsBefore.eq(originalEmissions)).toBe(true);

      // 3. Change the diesel emission factor.
      const updateResponse = await request(app)
        .put("/api/assumptions/diesel")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          tco2e_per_unit: newValue,
          expected_tco2e_per_unit: originalValue,
          reason: "Testing historical emissions snapshot",
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.factor.tco2e_per_unit).toBe(newValue);

      // 4. The existing activity must retain its original emissions.
      const historicalEmissionsAfter =
        await getCategoryEmissions(historicalCategory);

      expect(historicalEmissionsAfter.eq(historicalEmissionsBefore)).toBe(true);

      // 5. Upload a new activity using the updated factor.
      const secondUpload = await request(app)
        .post("/api/activities")
        .set("Authorization", `Bearer ${alphaToken}`)
        .send({
          activities: [
            {
              ...createActivity(`updated-${uniqueId}`),
              category: newCategory,
            },
          ],
        });

      expect(secondUpload.status).toBe(200);
      expect(secondUpload.body.summary.accepted_rows).toBe(1);

      const expectedNewEmissions = new Decimal(newValue).mul(1000);

      expect(
        new Decimal(secondUpload.body.results[0].emissions_tco2e).eq(
          expectedNewEmissions,
        ),
      ).toBe(true);

      // 6. Confirm the new category uses the updated factor.
      const newCategoryEmissions = await getCategoryEmissions(newCategory);

      expect(newCategoryEmissions.eq(expectedNewEmissions)).toBe(true);

      // 7. Confirm the original activity still has its original emissions.
      const finalHistoricalEmissions =
        await getCategoryEmissions(historicalCategory);

      expect(finalHistoricalEmissions.eq(originalEmissions)).toBe(true);
    } finally {
      // Restore the original factor to avoid affecting other tests.
      const currentFactor = await getDieselFactor();

      if (!new Decimal(currentFactor.tco2e_per_unit).eq(originalValue)) {
        const restoreResponse = await request(app)
          .put("/api/assumptions/diesel")
          .set("Authorization", `Bearer ${alphaToken}`)
          .send({
            tco2e_per_unit: originalValue,
            expected_tco2e_per_unit: currentFactor.tco2e_per_unit,
            reason: "Restore original factor after historical snapshot test",
          });

        expect(restoreResponse.status).toBe(200);
      }
    }
  });
});
