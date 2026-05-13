/**
 * OpenAPI 3 importer.
 * Reads a YAML/JSON file, dereferences it, and creates a mokkapi Service with
 * stub endpoints for every (path, method) operation in the spec.
 */

import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type {
  Service,
  Endpoint,
  ResponseVariant,
  ImportResult,
  HttpMethod,
  BodyKind,
} from '../../shared/models';
import { nanoid } from '../workspace/nanoid';

type V3Doc = OpenAPIV3.Document | OpenAPIV3_1.Document;

export async function importOpenApi3(
  filePath: string,
  workspace: WorkspaceManager,
  targetServiceId?: string,
): Promise<ImportResult> {
  const api = (await SwaggerParser.dereference(filePath)) as OpenAPI.Document;

  if (!('openapi' in api) || !api.openapi?.startsWith('3')) {
    throw new Error('Only OpenAPI 3.x documents are supported');
  }

  const doc = api as V3Doc;
  const warnings: string[] = [];
  const endpoints: Endpoint[] = [];

  const paths = doc.paths ?? {};

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;

    const moksPath = rawPath.replace(/\{(\w+)\}/g, ':$1');

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) continue;

      const variants = buildVariants(method, rawPath, operation, warnings);

      const endpoint: Endpoint = {
        id: nanoid(8),
        method: method.toUpperCase() as HttpMethod,
        path: moksPath,
        description: operation.summary ?? operation.description ?? '',
        variants,
        forcedVariantId: null,
      };

      endpoints.push(endpoint);
    }
  }

  // Derive port from servers[0], or default
  let port = 4001;
  const servers = doc.servers ?? [];
  if (servers.length > 0) {
    try {
      const url = new URL(servers[0].url ?? '');
      if (url.port) port = Number(url.port);
    } catch { /* relative URL or unparseable — keep default */ }
  }

  // Service name from info.title
  const serviceName = (doc.info?.title ?? 'Imported API').slice(0, 64);

  let service: Service;

  if (targetServiceId) {
    // Merge into existing service — append non-duplicate endpoints
    const existing = workspace.getService(targetServiceId);
    if (!existing) throw new Error(`Target service '${targetServiceId}' not found`);

    const existingPaths = new Set(existing.endpoints.map((e) => `${e.method}:${e.path}`));
    const newEndpoints = endpoints.filter(
      (e) => !existingPaths.has(`${e.method}:${e.path}`),
    );
    const skipped = endpoints.length - newEndpoints.length;
    if (skipped > 0) warnings.push(`${skipped} endpoint(s) skipped (already exist in service)`);

    service = await workspace.updateService(targetServiceId, {
      endpoints: [...existing.endpoints, ...newEndpoints],
    });
  } else {
    service = await workspace.createService({
      name: serviceName,
      port,
      protocol: 'http',
      tls: { mode: 'auto', certPath: null, keyPath: null, additionalHosts: [] },
      cors: { allowedOrigins: ['*'] },
      scenarios: ['Default'],
      activeScenario: 'Default',
      enabled: false, // Let the user start it explicitly after reviewing
      endpoints,
    });
  }

  if (warnings.length === 0 && endpoints.length === 0) {
    warnings.push('No endpoints found in the spec — is the paths section populated?');
  }

  return {
    serviceId: service.id,
    serviceName: service.name,
    endpointsCreated: endpoints.length,
    warnings,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function buildVariants(
  method: string,
  path: string,
  operation: OpenAPIV3.OperationObject,
  warnings: string[],
): ResponseVariant[] {
  const variants: ResponseVariant[] = [];

  const responses = operation.responses ?? {};
  const codes = Object.keys(responses).sort(statusOrder);

  for (const code of codes) {
    const resp = responses[code] as OpenAPIV3.ResponseObject | undefined;
    if (!resp) continue;

    const status = code === 'default' ? 200 : Number(code);
    const { body, bodyKind } = extractExampleBody(resp, method, path, warnings);

    const variant: ResponseVariant = {
      id: nanoid(8),
      name: `${code} ${httpStatusText(status)}`,
      scenarios: [],
      match: { headers: {}, query: {}, bodyJsonPath: [] },
      delayMs: 0,
      status,
      headers: contentTypeHeader(resp),
      body,
      bodyKind,
      synthesized: body === '' || body.includes('"<synthesized>"'),
    };

    variants.push(variant);
  }

  // If no variants at all, create a default 200
  if (variants.length === 0) {
    variants.push({
      id: nanoid(8),
      name: '200 OK',
      scenarios: [],
      match: { headers: {}, query: {}, bodyJsonPath: [] },
      delayMs: 0,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{}',
      bodyKind: 'json',
      synthesized: true,
    });
  }

  return variants;
}

function extractExampleBody(
  resp: OpenAPIV3.ResponseObject,
  method: string,
  path: string,
  warnings: string[],
): { body: string; bodyKind: BodyKind } {
  // Try content types in order of preference
  const content = resp.content ?? {};

  // JSON first
  const jsonContent = content['application/json'] as OpenAPIV3.MediaTypeObject | undefined;
  if (jsonContent) {
    const body = pickExample(jsonContent);
    if (body !== null) return { body: JSON.stringify(body, null, 2), bodyKind: 'json' };

    // Synthesise from schema
    const schema = jsonContent.schema as OpenAPIV3.SchemaObject | undefined;
    if (schema) {
      const synthesised = synthesiseFromSchema(schema, 0);
      warnings.push(`Synthesised body for ${method.toUpperCase()} ${path} — review the '${Object.keys(content)[0]}' variant`);
      return { body: JSON.stringify(synthesised, null, 2), bodyKind: 'json' };
    }
  }

  // XML
  const xmlContent = content['application/xml'] as OpenAPIV3.MediaTypeObject | undefined;
  if (xmlContent) return { body: '<!-- XML response -->', bodyKind: 'xml' };

  // Plain text
  const textContent = content['text/plain'] as OpenAPIV3.MediaTypeObject | undefined;
  if (textContent) {
    const body = pickExample(textContent);
    return { body: typeof body === 'string' ? body : 'response', bodyKind: 'text' };
  }

  // No content (e.g. 204 No Content)
  if (Object.keys(content).length === 0) return { body: '', bodyKind: 'text' };

  warnings.push(`Cannot extract example body for ${method.toUpperCase()} ${path}`);
  return { body: '', bodyKind: 'text' };
}

function pickExample(media: OpenAPIV3.MediaTypeObject): unknown | null {
  // Direct example property
  if (media.example !== undefined) return media.example;

  // Named examples map
  const examples = media.examples ?? {};
  const first = Object.values(examples)[0] as OpenAPIV3.ExampleObject | undefined;
  if (first?.value !== undefined) return first.value;

  return null;
}

function synthesiseFromSchema(schema: OpenAPIV3.SchemaObject, depth: number): unknown {
  if (depth > 4) return '<synthesised>';
  switch (schema.type) {
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        obj[k] = synthesiseFromSchema(v as OpenAPIV3.SchemaObject, depth + 1);
      }
      return obj;
    }
    case 'array':
      return [synthesiseFromSchema((schema.items as OpenAPIV3.SchemaObject) ?? {}, depth + 1)];
    case 'string':
      return schema.enum ? schema.enum[0] : (schema.example ?? '{{faker.word}}');
    case 'number':
    case 'integer':
      return schema.example ?? 0;
    case 'boolean':
      return schema.example ?? true;
    default:
      return null;
  }
}

function contentTypeHeader(resp: OpenAPIV3.ResponseObject): Record<string, string> {
  const content = resp.content ?? {};
  if ('application/json' in content) return { 'content-type': 'application/json' };
  if ('application/xml'  in content) return { 'content-type': 'application/xml' };
  if ('text/plain'       in content) return { 'content-type': 'text/plain' };
  return {};
}

/** Sort HTTP status codes: 2xx first, then 3xx, 4xx, 5xx, default last */
function statusOrder(a: string, b: string): number {
  if (a === 'default') return 1;
  if (b === 'default') return -1;
  return Number(a) - Number(b);
}

function httpStatusText(code: number): string {
  const texts: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  };
  return texts[code] ?? '';
}
