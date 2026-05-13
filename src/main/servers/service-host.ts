/**
 * ServiceHost — one Fastify HTTP/HTTPS server per configured service.
 * Handles all incoming requests via a single catch-all route, delegates matching
 * to MockEngine, and streams history entries back through the callback.
 */

import Fastify from 'fastify';
import type { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { matchRequest } from './matcher';
import { renderBody, defaultContentType } from './renderer';
import type { Service, ServiceRuntimeStatus, HistoryEntry } from '../../shared/models';
import type { HistoryStore } from '../history/history-store';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export class ServiceHost {
  private app: FastifyInstance | null = null;
  private _service: Service;
  private status: ServiceRuntimeStatus;

  constructor(
    service: Service,
    private readonly history: HistoryStore,
    private readonly onEntry: (entry: HistoryEntry) => void,
  ) {
    this._service = service;
    this.status = { serviceId: service.id, status: 'stopped' };
  }

  get serviceId(): string { return this._service.id; }

  /** Hot-update the service config without restarting */
  setService(service: Service): void {
    this._service = service;
  }

  getStatus(): ServiceRuntimeStatus {
    return { ...this.status };
  }

  async start(): Promise<void> {
    if (this.app) await this.stop();

    this.status = { serviceId: this._service.id, status: 'starting' };

    const app = Fastify({
      logger: false,
      routerOptions: {
        ignoreTrailingSlash: true,
      },
      exposeHeadRoutes: false,
    });

    // Accept any content-type as a raw string so we can inspect and log it
    app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body as string);
    });

    // Simple CORS passthrough based on service config
    app.addHook('onSend', (_req, reply, _payload, done) => {
      const origins = this._service.cors?.allowedOrigins ?? ['*'];
      reply.header('access-control-allow-origin', origins.join(', ') || '*');
      reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
      reply.header('access-control-allow-headers', '*');
      done();
    });

    const handler: RouteHandlerMethod = async (req, reply) => {
      const startMs = Date.now();

      // ── Normalise incoming request ────────────────────────────────────────
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
      }

      const { rawBody, parsedBody } = normalizeRequestBody(
        req.body,
        headers['content-type'] ?? '',
      );

      const query: Record<string, string> = {};
      if (req.query && typeof req.query === 'object') {
        for (const [k, v] of Object.entries(req.query as Record<string, string | string[]>)) {
          query[k] = Array.isArray(v) ? v[0] : v;
        }
      }

      // ── Match against endpoints ───────────────────────────────────────────
      const result = matchRequest(
        this._service,
        req.method,
        req.url,
        query,
        headers,
        parsedBody,
      );

      // ── Build response ────────────────────────────────────────────────────
      let resStatus: number;
      let resHeaders: Record<string, string>;
      let resBody: string;

      if (!result) {
        resStatus = 501;
        resHeaders = { 'content-type': 'application/json' };
        resBody = JSON.stringify({
          error: 'no_match',
          message: `mokkapi: no variant matched ${req.method} ${req.url} on service '${this._service.name}'`,
          hint: 'Add a matching endpoint + variant, or check the active scenario.',
        });
      } else {
        const { variant, params } = result;

        // Simulate latency
        if (variant.delayMs > 0) {
          await sleep(variant.delayMs);
        }

        // Render Handlebars body
        resBody = renderBody(variant.body, {
          request: { params, query, headers, body: parsedBody },
        });

        resStatus = variant.status;
        resHeaders = { ...variant.headers };

        // Inject content-type if the user didn't specify one
        const hasCt = Object.keys(resHeaders).some(
          (k) => k.toLowerCase() === 'content-type',
        );
        if (!hasCt) {
          resHeaders['content-type'] = defaultContentType(variant.bodyKind);
        }
      }

      const durationMs = Date.now() - startMs;

      // ── Persist to history ────────────────────────────────────────────────
      const pathOnly = req.url.includes('?') ? req.url.split('?')[0] : req.url;
      const queryStr  = req.url.includes('?') ? req.url.split('?')[1] : null;

      const entry = this.history.insert({
        id: 0,
        ts: startMs,
        serviceId: this._service.id,
        endpointId: result?.endpoint.id ?? null,
        variantId:  result?.variant.id  ?? null,
        method:     req.method,
        path:       pathOnly,
        query:      queryStr,
        reqHeaders: headers,
        reqBody:    rawBody ?? null,
        resStatus,
        resHeaders,
        resBody,
        durationMs,
        remoteAddr: req.socket?.remoteAddress ?? null,
      });

      this.onEntry(entry);

      // ── Send response ─────────────────────────────────────────────────────
      reply.status(resStatus);
      for (const [k, v] of Object.entries(resHeaders)) {
        reply.header(k, v);
      }
      return reply.send(resBody);
    };

    for (const method of HTTP_METHODS) {
      app[method]('/*', handler);
    }

    this.app = app;

    try {
      await app.listen({ port: this._service.port, host: '0.0.0.0' });
      this.status = { serviceId: this._service.id, status: 'running', port: this._service.port };
      console.log(`[ServiceHost] "${this._service.name}" running on :${this._service.port}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = { serviceId: this._service.id, status: 'error', error: msg };
      this.app = null;
      throw new Error(`Port ${this._service.port}: ${msg}`);
    }
  }

  async stop(): Promise<void> {
    if (this.app) {
      try { await this.app.close(); } catch { /* already closed */ }
      this.app = null;
    }
    this.status = { serviceId: this._service.id, status: 'stopped' };
    console.log(`[ServiceHost] "${this._service.name}" stopped`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeRequestBody(
  body: unknown,
  contentType: string,
): { rawBody: string | null; parsedBody: unknown } {
  if (body === undefined || body === null || body === '') {
    return { rawBody: null, parsedBody: null };
  }

  if (typeof body === 'string') {
    return normalizeTextBody(body, contentType);
  }

  if (body instanceof Uint8Array) {
    return normalizeTextBody(Buffer.from(body).toString('utf8'), contentType);
  }

  if (typeof body === 'object') {
    const rawBody = safeStringify(body);
    return { rawBody, parsedBody: body };
  }

  return { rawBody: String(body), parsedBody: body };
}

function normalizeTextBody(
  text: string,
  contentType: string,
): { rawBody: string; parsedBody: unknown } {
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return { rawBody: text, parsedBody: JSON.parse(text) };
    } catch {
      return { rawBody: text, parsedBody: text };
    }
  }

  return { rawBody: text, parsedBody: text };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
