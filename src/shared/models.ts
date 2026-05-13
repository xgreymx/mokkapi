// ─── Domain types shared across the Electron main process and Angular renderer ───

export type ServiceProtocol = 'http' | 'https';
export type TlsMode = 'auto' | 'byo';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyKind = 'json' | 'xml' | 'text' | 'binary-base64';
export type MatchOp = 'eq' | 'exists' | 'regex' | 'gt' | 'lt';
export type ServiceStatus = 'running' | 'stopped' | 'error' | 'starting';
export type AppTheme = 'system' | 'light' | 'dark';

// ─── TLS ─────────────────────────────────────────────────────────────────────

export interface TlsConfig {
  mode: TlsMode;
  certPath: string | null;
  keyPath: string | null;
  additionalHosts: string[];
}

// ─── Matching ────────────────────────────────────────────────────────────────

/** A single rule value: exact string, negated presence, or regex check */
export type MatchRuleValue =
  | string           // exact string match; '!present' = header must NOT exist; 'present' = must exist
  | { regex: string }; // regex match against the value

export interface JsonPathRule {
  path: string;      // JSONPath e.g. $.items[0].id
  op: MatchOp;
  value?: string | number | boolean;
}

export interface MatchRule {
  headers: Record<string, MatchRuleValue>;
  query: Record<string, MatchRuleValue>;
  bodyJsonPath: JsonPathRule[];
}

// ─── Response variant ────────────────────────────────────────────────────────

export interface ResponseVariant {
  id: string;
  name: string;
  /** Scenario names this variant is active in. Empty array = active in ALL scenarios. */
  scenarios: string[];
  match: MatchRule;
  delayMs: number;
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyKind: BodyKind;
  /** Set by the OpenAPI importer to indicate the body was synthesized from a schema */
  synthesized?: boolean;
}

// ─── Endpoint ────────────────────────────────────────────────────────────────

export interface Endpoint {
  id: string;
  method: HttpMethod;
  /** Path with optional :param segments, e.g. /v1/charges/:id */
  path: string;
  description: string;
  variants: ResponseVariant[];
  /** When set, this variant wins regardless of match rules or active scenario */
  forcedVariantId: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  port: number;
  protocol: ServiceProtocol;
  tls: TlsConfig;
  cors: { allowedOrigins: string[] };
  /** Ordered list of scenario names for this service */
  scenarios: string[];
  /** Currently active scenario — drives variant selection */
  activeScenario: string;
  /** Whether this service should be auto-started on app launch */
  enabled: boolean;
  endpoints: Endpoint[];
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export interface AppSettings {
  workspacePath: string;
  theme: AppTheme;
  defaultPortBase: number;
  historyRetentionDays: number;
  historyRetentionRows: number;
}

export interface PinnedRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

// ─── Runtime state ───────────────────────────────────────────────────────────

export interface ServiceRuntimeStatus {
  serviceId: string;
  status: ServiceStatus;
  port?: number;
  error?: string;
}

export interface WorkspaceState {
  settings: AppSettings;
  services: Service[];
  serviceStatuses: Record<string, ServiceRuntimeStatus>;
}

// ─── Request history ─────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: number;
  ts: number; // epoch ms
  serviceId: string;
  endpointId: string | null;
  variantId: string | null;
  method: string;
  path: string;
  query: string | null;
  reqHeaders: Record<string, string>;
  reqBody: string | null;
  resStatus: number;
  resHeaders: Record<string, string>;
  resBody: string | null;
  durationMs: number;
  remoteAddr: string | null;
  /** 'test-client' when sent from the built-in test panel */
  source?: 'test-client';
}

export interface HistoryFilter {
  serviceId?: string;
  method?: string;
  statusMin?: number;
  statusMax?: number;
  search?: string; // matched against path, req/res body
  limit?: number;
  before?: number; // ts cursor for pagination
}

// ─── Imports ─────────────────────────────────────────────────────────────────

export interface ImportResult {
  serviceId: string;
  serviceName: string;
  endpointsCreated: number;
  warnings: string[];
}

// ─── Test client ─────────────────────────────────────────────────────────────

export interface TestRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface TestResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
  durationMs: number;
  error?: string;
}

// ─── Creation input helpers ──────────────────────────────────────────────────

export type CreateServiceInput = Omit<Service, 'id' | 'endpoints'> & { endpoints?: Endpoint[] };
export type CreateEndpointInput = Omit<Endpoint, 'id'>;
export type CreateVariantInput = Omit<ResponseVariant, 'id'>;
