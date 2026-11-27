import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { env } from "../src/config/env";
import Decimal from "decimal.js";

describe("Activity CSV Upload API", () => {
  const alphaToken = jwt.sign({ tenant_id: "t_alpha" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
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

  it("should accept a valid CSV upload", async () => {
    const activityId = `csv-valid-${Date.now()}`;
    const factor = await getDieselFactor();

    const expectedEmissions = new Decimal("500")
      .mul(factor.tco2e_per_unit)
      .toString();

    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key",
      `${activityId},2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel`,
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .set("X-Filename", "automated-test.csv")
      .send(csv);

    expect(response.status).toBe(200);
    expect(response.body.tenant_id).toBe("t_alpha");

    expect(response.body.summary).toEqual({
      total_rows: 1,
      accepted_rows: 1,
      rejected_rows: 0,
      duplicate_rows: 0,
    });

    expect(response.body.results[0].status).toBe("accepted");
    expect(response.body.results[0].emissions_tco2e).toBe(expectedEmissions);
    expect(response.body.upload.filename).toBe("automated-test.csv");
  });

  it("should reject CSV with incorrect headers", async () => {
    const csv = [
      "activity_id,date,category,scope,quantity,unit,factor_key",
      "csv-invalid-header,2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel",
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid CSV upload.");
    expect(response.body.details).toContain("CSV headers must contain exactly");
  });

  it("should reject CSV without data rows", async () => {
    const csv =
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key";

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid CSV upload.");
    expect(response.body.details).toContain(
      "CSV must contain a header and at least one data row.",
    );
  });

  it("should reject a CSV row with negative quantity", async () => {
    const activityId = `csv-negative-${Date.now()}`;

    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key",
      `${activityId},2026-04-15T00:00:00.000Z,Fleet diesel,1,-500,L,diesel`,
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

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

  it("should reject unsupported content types", async () => {
    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/plain")
      .send("This is not a supported upload format.");

    expect(response.status).toBe(415);
    expect(response.body.error).toBe(
      "Unsupported content type. Use application/json or text/csv.",
    );
  });

  it("should accept a CSV file containing a UTF-8 BOM", async () => {
    const activityId = `csv-bom-${Date.now()}`;

    const csv =
      "\uFEFFactivity_id,occurred_at,category,scope,quantity,unit,factor_key\n" +
      `${activityId},2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel`;

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(200);
    expect(response.body.summary.accepted_rows).toBe(1);
    expect(response.body.results[0].status).toBe("accepted");
  });

  it("should accept CSV headers in a different order", async () => {
    const activityId = `csv-reordered-${Date.now()}`;
    const factor = await getDieselFactor();

    const expectedEmissions = new Decimal("500")
      .mul(factor.tco2e_per_unit)
      .toString();

    const csv = [
      "quantity,factor_key,activity_id,unit,scope,category,occurred_at",
      `500,diesel,${activityId},L,1,Fleet diesel,2026-04-15T00:00:00.000Z`,
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(200);
    expect(response.body.summary.accepted_rows).toBe(1);
    expect(response.body.results[0].status).toBe("accepted");
    // expect(response.body.results[0].emissions_tco2e).toBe('1.4');
    expect(response.body.results[0].emissions_tco2e).toBe(expectedEmissions);
  });

  it("should correctly parse a quoted category containing a comma", async () => {
    const activityId = `csv-quoted-${Date.now()}`;

    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key",
      `${activityId},2026-04-15T00:00:00.000Z,"Fleet diesel, company vehicles",1,500,L,diesel`,
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(200);
    expect(response.body.summary.accepted_rows).toBe(1);
    expect(response.body.results[0].status).toBe("accepted");
  });

  it("should accept CSV files using Windows-style line endings", async () => {
    const activityId = `csv-windows-${Date.now()}`;

    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key",
      `${activityId},2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel`,
    ].join("\r\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(200);
    expect(response.body.summary.accepted_rows).toBe(1);
    expect(response.body.results[0].status).toBe("accepted");
  });

  it("should identify duplicate activity IDs within the same CSV upload", async () => {
    const activityId = `csv-batch-duplicate-${Date.now()}`;

    const row = `${activityId},2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel`;

    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key",
      row,
      row,
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(200);

    expect(response.body.summary).toEqual({
      total_rows: 2,
      accepted_rows: 1,
      rejected_rows: 0,
      duplicate_rows: 1,
    });

    expect(response.body.results[0].status).toBe("accepted");
    expect(response.body.results[1].status).toBe("duplicate");
  });

  it("should reject CSV containing duplicate headers", async () => {
    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key,factor_key",
      "csv-duplicate-header,2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel,diesel",
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid CSV upload.");
    expect(response.body.details).toContain("CSV headers must contain exactly");
  });

  it("should reject CSV containing an unexpected extra header", async () => {
    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key,extra_column",
      "csv-extra-header,2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel,extra",
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid CSV upload.");
    expect(response.body.details).toContain("CSV headers must contain exactly");
  });

  it("should reject CSV containing more than 500 activities", async () => {
    const header =
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key";

    const rows = Array.from({ length: 501 }, (_, index) => {
      return `csv-limit-${Date.now()}-${index},2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel`;
    });

    const csv = [header, ...rows].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid CSV upload.");
    expect(response.body.details).toBe(
      "CSV cannot contain more than 500 activities.",
    );
  });

  it("should reject filenames longer than 255 characters", async () => {
    const filename = `${"a".repeat(252)}.csv`;

    const csv = [
      "activity_id,occurred_at,category,scope,quantity,unit,factor_key",
      `csv-long-filename-${Date.now()},2026-04-15T00:00:00.000Z,Fleet diesel,1,500,L,diesel`,
    ].join("\n");

    const response = await request(app)
      .post("/api/activities")
      .set("Authorization", `Bearer ${alphaToken}`)
      .set("Content-Type", "text/csv")
      .set("X-Filename", filename)
      .send(csv);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Filename cannot exceed 255 characters.");
  });
});
