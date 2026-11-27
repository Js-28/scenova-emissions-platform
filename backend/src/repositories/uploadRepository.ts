import type { PoolClient } from "pg";

export interface NewUploadRecord {
  tenant_id: string;
  filename: string | null;
  total_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  duplicate_rows: number;
}

export interface UploadRecord extends NewUploadRecord {
  upload_id: string;
  uploaded_at: Date;
}

export async function insertUploadRecord(
  client: PoolClient,
  upload: NewUploadRecord,
): Promise<UploadRecord> {
  const result = await client.query<UploadRecord>(
    `INSERT INTO upload_records (
      tenant_id,
      filename,
      total_rows,
      accepted_rows,
      rejected_rows,
      duplicate_rows
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      upload_id,
      tenant_id,
      filename,
      total_rows,
      accepted_rows,
      rejected_rows,
      duplicate_rows,
      uploaded_at`,
    [
      upload.tenant_id,
      upload.filename,
      upload.total_rows,
      upload.accepted_rows,
      upload.rejected_rows,
      upload.duplicate_rows,
    ],
  );

  return result.rows[0];
}
