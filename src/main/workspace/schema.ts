/**
 * Zod schemas for validating JSON files read from the workspace folder.
 * These mirror the TypeScript types in shared/models.ts but enforce shapes at runtime.
 */

import { z } from 'zod';

const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const BodyKindSchema = z.enum(['json', 'xml', 'text', 'binary-base64']);
const MatchOpSchema = z.enum(['eq', 'exists', 'regex', 'gt', 'lt']);

const MatchRuleValueSchema = z.union([
  z.string(),
  z.object({ regex: z.string() }),
]);

const JsonPathRuleSchema = z.object({
  path: z.string(),
  op: MatchOpSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const MatchRuleSchema = z.object({
  headers: z.record(z.string(), MatchRuleValueSchema).default({}),
  query: z.record(z.string(), MatchRuleValueSchema).default({}),
  bodyJsonPath: z.array(JsonPathRuleSchema).default([]),
});

export const ResponseVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  scenarios: z.array(z.string()).default([]),
  match: MatchRuleSchema.default({ headers: {}, query: {}, bodyJsonPath: [] }),
  delayMs: z.number().int().min(0).default(0),
  status: z.number().int().min(100).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().default(''),
  bodyKind: BodyKindSchema.default('json'),
  synthesized: z.boolean().optional(),
});

export const EndpointSchema = z.object({
  id: z.string(),
  method: HttpMethodSchema,
  path: z.string().startsWith('/'),
  description: z.string().default(''),
  variants: z.array(ResponseVariantSchema).default([]),
  forcedVariantId: z.string().nullable().default(null),
});

const TlsConfigSchema = z.object({
  mode: z.enum(['auto', 'byo']).default('auto'),
  certPath: z.string().nullable().default(null),
  keyPath: z.string().nullable().default(null),
  additionalHosts: z.array(z.string()).default([]),
});

export const ServiceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Service id must be kebab-case'),
  name: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
  protocol: z.enum(['http', 'https']).default('http'),
  tls: TlsConfigSchema.default({ mode: 'auto', certPath: null, keyPath: null, additionalHosts: [] }),
  cors: z.object({ allowedOrigins: z.array(z.string()).default(['*']) }).default({ allowedOrigins: ['*'] }),
  scenarios: z.array(z.string()).default(['Default']),
  activeScenario: z.string().default('Default'),
  enabled: z.boolean().default(true),
  endpoints: z.array(EndpointSchema).default([]),
});

export const AppSettingsSchema = z.object({
  workspacePath: z.string(),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  defaultPortBase: z.number().int().min(1024).max(60000).default(4000),
  historyRetentionDays: z.number().int().min(1).max(365).default(30),
  historyRetentionRows: z.number().int().min(1000).max(1_000_000).default(100_000),
});

export type ServiceInput = z.infer<typeof ServiceSchema>;
export type EndpointInput = z.infer<typeof EndpointSchema>;
export type ResponseVariantInput = z.infer<typeof ResponseVariantSchema>;
export type AppSettingsInput = z.infer<typeof AppSettingsSchema>;
