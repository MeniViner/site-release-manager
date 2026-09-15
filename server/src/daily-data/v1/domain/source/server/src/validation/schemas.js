import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

export const siteIdSchema = z.string().trim().min(1).max(160);
export const siteSlugSchema = z.string().trim().min(1).max(160).optional();
export const scopeSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const entityIdSchema = z.string().trim().min(1).max(512).refine((value) => !value.includes('\0'), {
  message: 'entityId cannot contain null bytes',
});

export const jsonDataSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const createSiteSchema = z.object({
  siteId: siteIdSchema,
  siteSlug: siteSlugSchema,
  displayName: z.string().trim().max(240).optional(),
  status: z.enum(['active', 'disabled', 'archived']).optional(),
  publicRead: z.boolean().optional(),
});

export const provisionSiteSchema = createSiteSchema.omit({ siteId: true });

export const putDataSchema = z.object({
  data: jsonDataSchema,
  expectedVersion: z.number().int().min(0).optional(),
  allowEmptyOverwrite: z.boolean().optional(),
});

export const patchDataSchema = z.object({
  patch: jsonDataSchema.optional(),
  data: jsonDataSchema.optional(),
  expectedVersion: z.number().int().min(0).optional(),
  allowEmptyOverwrite: z.boolean().optional(),
}).refine((value) => value.patch !== undefined || value.data !== undefined, {
  message: 'PATCH requires patch or data',
});

export const batchReadSchema = z.object({
  items: z.array(z.object({
    scope: scopeSchema,
    entityId: entityIdSchema,
  })).min(1).max(200),
});

export const batchWriteSchema = z.object({
  operations: z.array(z.object({
    op: z.enum(['put', 'patch', 'delete']),
    scope: scopeSchema,
    entityId: entityIdSchema,
    data: jsonDataSchema.optional(),
    patch: jsonDataSchema.optional(),
    expectedVersion: z.number().int().min(0).optional(),
    allowEmptyOverwrite: z.boolean().optional(),
  })).min(1).max(200),
});

export const legacyWriteSchema = z.object({
  key: z.string().trim().min(1).max(1024),
  data: jsonDataSchema,
  expectedVersion: z.number().int().min(0).optional(),
  allowEmptyOverwrite: z.boolean().optional(),
});

export const legacyBatchReadSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(1024)).min(1).max(100),
});

export const legacyBatchWriteSchema = z.object({
  items: z.array(legacyWriteSchema).min(1).max(100),
});

export const backupCreateSchema = z.object({
  backupPackage: z.unknown(),
  name: z.string().trim().max(240).optional(),
  description: z.string().trim().max(2000).optional(),
});

export const backupDeleteSchema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
}).optional();

const restoreUnitIdSchema = z.string().trim().min(1).max(220);
const backupIdSchema = z.string().trim().min(1).max(160);

export const backupRestoreSchema = z.object({
  allowSiteIdMismatch: z.boolean().optional(),
  expectedBackupVersion: z.number().int().min(0).optional(),
  preRestoreBackupId: backupIdSchema.optional(),
  selectedRestoreUnitIds: z.array(restoreUnitIdSchema).min(1).optional(),
}).optional();

export function parseOrBadRequest(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest('Invalid request payload', parsed.error.flatten());
  }
  return parsed.data;
}
