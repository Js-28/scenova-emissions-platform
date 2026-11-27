import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import Decimal from "decimal.js";

import app from "../src/app";
import { env } from "../src/config/env";

describe("Rollup API", () => {
  const alphaToken = jwt.sign({ tenant_id: "t_alpha" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

  const betaToken = jwt.sign({ tenant_id: "t_beta" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  let testSequence = 0;

  function createUniqueId(): string {
    testSequence += 1;
    return `rollup-boundary-${Date.now()}-${testSequence}`;
  }

  async function uploadActivity(
    activityId: string,
    category: string,
    occurredAt: string,
    quantity = "1",
  ) {
    return request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [
          {
            activity_id: activityId,
            occurred_at: occurredAt,
            category,
            scope: 1,
            quantity,
            unit: "L",
            factor_key: "diesel",
          },
        ],
      });
  }

  it("should reject requests without authentication", async () => {
    const response = await request(app).get("/api/rollup?fy=2026");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
  });

  it("should reject requests without a financial year", async () => {
    const response = await request(app)
      .get("/api/rollup")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("A valid financial year is required.");
  });

  it("should reject an invalid financial year", async () => {
    const response = await request(app)
      .get("/api/rollup?fy=invalid")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("A valid financial year is required.");
  });

  it("should reject a financial year outside the allowed range", async () => {
    const response = await request(app)
      .get("/api/rollup?fy=1899")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("A valid financial year is required.");
  });

  it("should return the correct rollup response structure and consistent totals", async () => {
    const response = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_alpha");

    expect(response.body.financial_year).toBe(2026);

    expect(response.body.period).toEqual({
      start: "2025-07-01",
      end: "2026-06-30",
    });

    expect(response.body.scope_totals).toHaveProperty("scope_1");
    expect(response.body.scope_totals).toHaveProperty("scope_2");
    expect(response.body.scope_totals).toHaveProperty("scope_3");

    expect(response.body.category_totals).toBeInstanceOf(Array);

    const scopeTotals = response.body.scope_totals;

    const calculatedTotal = new Decimal(scopeTotals.scope_1)
      .plus(scopeTotals.scope_2)
      .plus(scopeTotals.scope_3);

    expect(calculatedTotal.eq(response.body.total_emissions_tco2e)).toBe(true);

    const categoryTotal = response.body.category_totals.reduce(
      (
        total: Decimal,
        category: {
          emissions_tco2e: string;
        },
      ) => total.plus(category.emissions_tco2e),
      new Decimal(0),
    );

    expect(categoryTotal.eq(response.body.total_emissions_tco2e)).toBe(true);
  });

  it("should prevent Beta from seeing Alpha activities in the rollup", async () => {
    const uniqueId = Date.now();

    const activityId = `rollup-isolation-${uniqueId}`;
    const uniqueCategory = `Rollup isolation ${uniqueId}`;

    // First, create an activity belonging to Alpha.
    const uploadResponse = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [
          {
            activity_id: activityId,
            occurred_at: "2026-04-15T00:00:00.000Z",
            category: uniqueCategory,
            scope: 1,
            quantity: "1000",
            unit: "L",
            factor_key: "diesel",
          },
        ],
      });

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.summary.accepted_rows).toBe(1);

    // Check that Alpha can see its own activity.
    const alphaRollup = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(alphaRollup.status).toBe(200);

    expect(
      alphaRollup.body.category_totals.some(
        (category: { category: string }) =>
          category.category === uniqueCategory,
      ),
    ).toBe(true);

    // Check that Beta cannot see Alpha's activity.
    const betaRollup = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${betaToken}`);

    expect(betaRollup.status).toBe(200);
    expect(betaRollup.body.tenant_id).toBe("t_beta");

    expect(
      betaRollup.body.category_totals.some(
        (category: { category: string }) =>
          category.category === uniqueCategory,
      ),
    ).toBe(false);
  });
  it("should include an activity occurring exactly at midnight on 1 July in the new financial year", async () => {
    const uniqueId = createUniqueId();
    const category = `FY boundary start ${uniqueId}`;

    const uploadResponse = await uploadActivity(
      uniqueId,
      category,
      "2025-07-01T00:00:00+10:00",
    );

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.summary.accepted_rows).toBe(1);

    const fy2026 = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    const fy2025 = await request(app)
      .get("/api/rollup?fy=2025")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(fy2026.status).toBe(200);
    expect(fy2025.status).toBe(200);

    expect(
      fy2026.body.category_totals.some(
        (item: { category: string }) => item.category === category,
      ),
    ).toBe(true);

    expect(
      fy2025.body.category_totals.some(
        (item: { category: string }) => item.category === category,
      ),
    ).toBe(false);
  });

  it("should assign an activity immediately before 1 July to the previous financial year", async () => {
    const uniqueId = createUniqueId();
    const category = `FY boundary before ${uniqueId}`;

    const uploadResponse = await uploadActivity(
      uniqueId,
      category,
      "2025-06-30T23:59:59.999+10:00",
    );

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.summary.accepted_rows).toBe(1);

    const fy2025 = await request(app)
      .get("/api/rollup?fy=2025")
      .set("Authorization", `Bearer ${alphaToken}`);

    const fy2026 = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(fy2025.status).toBe(200);
    expect(fy2026.status).toBe(200);

    expect(
      fy2025.body.category_totals.some(
        (item: { category: string }) => item.category === category,
      ),
    ).toBe(true);

    expect(
      fy2026.body.category_totals.some(
        (item: { category: string }) => item.category === category,
      ),
    ).toBe(false);
  });

  it("should include an activity occurring on 30 June in the financial year ending that day", async () => {
    const uniqueId = createUniqueId();
    const category = `FY final day ${uniqueId}`;

    const uploadResponse = await uploadActivity(
      uniqueId,
      category,
      "2026-06-30T23:59:59.999+10:00",
    );

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.summary.accepted_rows).toBe(1);

    const response = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);

    expect(
      response.body.category_totals.some(
        (item: { category: string }) => item.category === category,
      ),
    ).toBe(true);
  });

  it("should return zero totals when a financial year has no activities", async () => {
    // Use a distant financial year to avoid existing test and seed data.
    const response = await request(app)
      .get("/api/rollup?fy=9876")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);
    expect(response.body.financial_year).toBe(9876);

    expect(response.body.scope_totals.scope_1).toBe("0.0000000000000000");
    expect(response.body.scope_totals.scope_2).toBe("0.0000000000000000");
    expect(response.body.scope_totals.scope_3).toBe("0.0000000000000000");
    expect(response.body.total_emissions_tco2e).toBe("0.0000000000000000");

    expect(response.body.category_totals).toEqual([]);
  });

  it("should combine multiple activities belonging to the same category and scope", async () => {
    const uniqueId = createUniqueId();
    const category = `Grouped activities ${uniqueId}`;
    const baselineResponse = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(baselineResponse.status).toBe(200);

    const uploadResponse = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [
          {
            activity_id: `${uniqueId}-1`,
            occurred_at: "2026-04-10T10:00:00+10:00",
            category,
            scope: 1,
            quantity: "1",
            unit: "L",
            factor_key: "diesel",
          },
          {
            activity_id: `${uniqueId}-2`,
            occurred_at: "2026-04-11T10:00:00+10:00",
            category,
            scope: 1,
            quantity: "2",
            unit: "L",
            factor_key: "diesel",
          },
        ],
      });

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.summary.accepted_rows).toBe(2);

    const response = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);

    const matchingCategories = response.body.category_totals.filter(
      (item: { category: string }) => item.category === category,
    );

    // Both activities should appear as one grouped category row.
    expect(matchingCategories).toHaveLength(1);
    expect(matchingCategories[0].scope).toBe(1);

    const categoryEmissions = new Decimal(
      matchingCategories[0].emissions_tco2e,
    );

    expect(categoryEmissions.greaterThan(0)).toBe(true);

    // The grouped category amount must contribute to the Scope 1 total.
    // expect(
    //   categoryEmissions.eq(response.body.scope_totals.scope_1),
    // ).toBe(true);
    // The category emissions should equal the increase in Scope 1
    // emissions after these two activities were uploaded.
    const scopeOneIncrease = new Decimal(
      response.body.scope_totals.scope_1,
    ).minus(new Decimal(baselineResponse.body.scope_totals.scope_1));

    expect(categoryEmissions.eq(scopeOneIncrease)).toBe(true);
  });

  it("should preserve decimal precision when summing multiple activities", async () => {
    const uniqueId = createUniqueId();
    const category = `Decimal precision ${uniqueId}`;
    const baselineResponse = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(baselineResponse.status).toBe(200);

    const uploadResponse = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .send({
        activities: [
          {
            activity_id: `${uniqueId}-1`,
            occurred_at: "2026-04-12T10:00:00+10:00",
            category,
            scope: 1,
            quantity: "0.123456",
            unit: "L",
            factor_key: "diesel",
          },
          {
            activity_id: `${uniqueId}-2`,
            occurred_at: "2026-04-13T10:00:00+10:00",
            category,
            scope: 1,
            quantity: "0.234567",
            unit: "L",
            factor_key: "diesel",
          },
        ],
      });

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.summary.accepted_rows).toBe(2);

    const response = await request(app)
      .get("/api/rollup?fy=2026")
      .set("Authorization", `Bearer ${alphaToken}`);

    expect(response.status).toBe(200);

    const matchingCategories = response.body.category_totals.filter(
      (item: { category: string }) => item.category === category,
    );

    expect(matchingCategories).toHaveLength(1);

    const categoryEmissions = matchingCategories[0].emissions_tco2e;
    const scopeTotal = response.body.scope_totals.scope_1;

    // The API should return emissions with 16 decimal places.
    expect(categoryEmissions).toMatch(/^\d+\.\d{16}$/);
    expect(scopeTotal).toMatch(/^\d+\.\d{16}$/);

    // Decimal arithmetic should keep the category and scope totals consistent.
    // expect(
    //   new Decimal(categoryEmissions).eq(new Decimal(scopeTotal)),
    // ).toBe(true);
    const scopeOneIncrease = new Decimal(scopeTotal).minus(
      new Decimal(baselineResponse.body.scope_totals.scope_1),
    );

    expect(new Decimal(categoryEmissions).eq(scopeOneIncrease)).toBe(true);

    expect(
      new Decimal(response.body.total_emissions_tco2e).eq(
        new Decimal(response.body.scope_totals.scope_1)
          .plus(response.body.scope_totals.scope_2)
          .plus(response.body.scope_totals.scope_3),
      ),
    ).toBe(true);
  });
});
