
// import { Router, type Request, type Response } from 'express';
// import { z } from 'zod';

// import { authenticateToken } from '../middleware/auth';
// import { withTenantTransaction } from '../utils/tenantTransaction';
// import { ingestActivities } from '../services/activityService';

// const router = Router();

// const uploadSchema = z.object({
//   activities: z.array(z.unknown()).min(1).max(500),
// });

// router.post(
//   '/',
//   authenticateToken,
//   async (req: Request, res: Response): Promise<void> => {
//     const tenantId = req.tenantId;

//     if (!tenantId) {
//       res.status(401).json({
//         error: 'Authenticated tenant information is missing.',
//       });
//       return;
//     }

//     const parsed = uploadSchema.safeParse(req.body);

//     if (!parsed.success) {
//       res.status(400).json({
//         error: 'Invalid upload request.',
//         details: parsed.error.issues,
//       });
//       return;
//     }

//     try {
//       const results = await withTenantTransaction(
//         tenantId,
//         async (client) => {
//           return ingestActivities(
//             client,
//             tenantId,
//             parsed.data.activities,
//           );
//         },
//       );

//       const summary = {
//         total_rows: results.length,
//         accepted_rows: results.filter(
//           (row) => row.status === 'accepted',
//         ).length,
//         rejected_rows: results.filter(
//           (row) => row.status === 'rejected',
//         ).length,
//         duplicate_rows: results.filter(
//           (row) => row.status === 'duplicate',
//         ).length,
//       };

//       res.status(200).json({
//         message: 'Activity upload processed.',
//         tenant_id: tenantId,
//         summary,
//         results,
//       });
//     } catch (error) {
//       console.error(
//         'Activity ingestion failed:',
//         error instanceof Error ? error.message : 'Unknown error',
//       );

//       res.status(500).json({
//         error: 'Activity upload could not be processed.',
//       });
//     }
//   },
// );

// export default router;


import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';

import { authenticateToken } from '../middleware/auth';
import { withTenantTransaction } from '../utils/tenantTransaction';
import { ingestActivities } from '../services/activityService';
import { insertUploadRecord } from '../repositories/uploadRepository';

const router = Router();

const uploadSchema = z.object({
    activities: z.array(z.unknown()).min(1).max(500),
});

const expectedHeaders = [
    'activity_id',
    'occurred_at',
    'category',
    'scope',
    'quantity',
    'unit',
    'factor_key',
];

function parseCsvActivities(csv: string): unknown[] {
    const rows = parse(csv, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
    }) as string[][];

    if (rows.length < 2) {
        throw new Error('CSV must contain a header and at least one data row.');
    }

    const headers = rows[0].map((header) => String(header).trim());

    if (
        headers.length !== expectedHeaders.length ||
        new Set(headers).size !== headers.length ||
        !expectedHeaders.every((header) => headers.includes(header))
    ) {
        throw new Error(
            `CSV headers must contain exactly: ${expectedHeaders.join(', ')}.`,
        );
    }

    const activities = rows.slice(1).map((row) => {
        const record: Record<string, unknown> = {};

        headers.forEach((header, index) => {
            record[header] = row[index];
        });

        record.scope = Number(record.scope);

        return record;
    });

    if (activities.length > 500) {
        throw new Error('CSV cannot contain more than 500 activities.');
    }

    return activities;
}

router.post(
    '/',
    authenticateToken,
    async (req: Request, res: Response): Promise<void> => {
        const tenantId = req.tenantId;
        const filenameHeader = req.get('X-Filename');
        const filename = filenameHeader?.trim() || null;

        if (filename && filename.length > 255) {
            res.status(400).json({
                error: 'Filename cannot exceed 255 characters.',
            });
            return;
        }

        if (!tenantId) {
            res.status(401).json({
                error: 'Authenticated tenant information is missing.',
            });
            return;
        }

        let activities: unknown[];

        if (req.is('text/csv')) {
            if (typeof req.body !== 'string') {
                res.status(400).json({
                    error: 'CSV request body must be plain text.',
                });
                return;
            }

            try {
                activities = parseCsvActivities(req.body);
            } catch (error) {
                res.status(400).json({
                    error: 'Invalid CSV upload.',
                    details: error instanceof Error
                        ? error.message
                        : 'Could not parse CSV.',
                });
                return;
            }
        } else if (req.is('application/json')) {
            const parsed = uploadSchema.safeParse(req.body);

            if (!parsed.success) {
                res.status(400).json({
                    error: 'Invalid upload request.',
                    details: parsed.error.issues,
                });
                return;
            }

            activities = parsed.data.activities;
        } else {
            res.status(415).json({
                error: 'Unsupported content type. Use application/json or text/csv.',
            });
            return;
        }

        try {
            const uploadResult = await withTenantTransaction(
                tenantId,
                async (client) => {
                    // Step 1: Process the submitted activities.
                    const results = await ingestActivities(
                        client,
                        tenantId,
                        activities,
                    );

                    // Step 2: Calculate the upload summary.
                    const summary = {
                        total_rows: results.length,
                        accepted_rows: results.filter(
                            (row) => row.status === 'accepted',
                        ).length,
                        rejected_rows: results.filter(
                            (row) => row.status === 'rejected',
                        ).length,
                        duplicate_rows: results.filter(
                            (row) => row.status === 'duplicate',
                        ).length,
                    };

                    // Step 3: Save the upload record.
                    const upload = await insertUploadRecord(client, {
                        tenant_id: tenantId,
                        filename,
                        total_rows: summary.total_rows,
                        accepted_rows: summary.accepted_rows,
                        rejected_rows: summary.rejected_rows,
                        duplicate_rows: summary.duplicate_rows,
                    });

                    // Step 4: Return the complete result.
                    return {
                        results,
                        summary,
                        upload,
                    };
                },
            );

            // Step 5: Send the API response.
            res.status(200).json({
                message: 'Activity upload processed.',
                tenant_id: tenantId,
                upload: uploadResult.upload,
                summary: uploadResult.summary,
                results: uploadResult.results,
            });
        } catch (error) {
            console.error(
                'Activity ingestion failed:',
                error instanceof Error ? error.message : 'Unknown error',
            );

            res.status(500).json({
                error: 'Activity upload could not be processed.',
            });
        }
    },
);

export default router;
