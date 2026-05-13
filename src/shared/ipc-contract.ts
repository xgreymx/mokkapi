/**
 * Typed IPC contract between the Electron main process and the Angular renderer.
 * Preload exposes `window.mokkapi` implementing MokkApiElectron.
 * The Angular IpcService wraps these calls.
 */

import type {
  Service,
  Endpoint,
  ResponseVariant,
  HistoryEntry,
  HistoryFilter,
  AppSettings,
  ImportResult,
  TestRequest,
  TestResponse,
  ServiceRuntimeStatus,
  WorkspaceState,
  CreateServiceInput,
  CreateEndpointInput,
  CreateVariantInput,
} from './models';

// ─── Channel name constants ───────────────────────────────────────────────────

export const IPC = {
  // Workspace
  GET_WORKSPACE: 'workspace:get',

  // Services CRUD + lifecycle
  LIST_SERVICES:  'services:list',
  CREATE_SERVICE: 'services:create',
  UPDATE_SERVICE: 'services:update',
  DELETE_SERVICE: 'services:delete',
  START_SERVICE:  'services:start',
  STOP_SERVICE:   'services:stop',

  // Endpoints
  CREATE_ENDPOINT:   'endpoints:create',
  UPDATE_ENDPOINT:   'endpoints:update',
  DELETE_ENDPOINT:   'endpoints:delete',
  REORDER_ENDPOINTS: 'endpoints:reorder',

  // Variants
  CREATE_VARIANT: 'variants:create',
  UPDATE_VARIANT: 'variants:update',
  DELETE_VARIANT: 'variants:delete',
  FORCE_VARIANT:  'variants:force',

  // History
  QUERY_HISTORY: 'history:query',
  CLEAR_HISTORY: 'history:clear',

  // Settings
  GET_SETTINGS:    'settings:get',
  UPDATE_SETTINGS: 'settings:update',

  // OpenAPI import
  IMPORT_OPENAPI:      'import:openapi',
  OPEN_IMPORT_DIALOG:  'import:open-dialog', // returns picked file path

  // Built-in test client
  SEND_REQUEST: 'test-client:send',

  // Events (main → renderer, via ipcRenderer.on)
  EVT_REQUEST_RECEIVED:   'evt:request-received',
  EVT_SERVICE_STATUS:     'evt:service-status',
  EVT_WORKSPACE_MODIFIED: 'evt:workspace-modified',

  // Shell helpers
  OPEN_WORKSPACE_FOLDER: 'shell:open-workspace-folder',
  GET_CA_PATH:           'shell:get-ca-path',
  REGENERATE_CA:         'shell:regenerate-ca',
  OPEN_FILE_DIALOG:      'shell:open-file-dialog',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// ─── The typed surface exposed on window.mokkapi via contextBridge ────────────

export interface MokkApiElectron {
  // Workspace
  getWorkspace(): Promise<WorkspaceState>;

  // Services
  listServices(): Promise<Service[]>;
  createService(data: CreateServiceInput): Promise<Service>;
  updateService(id: string, data: Partial<Service>): Promise<Service>;
  deleteService(id: string): Promise<void>;
  startService(id: string): Promise<ServiceRuntimeStatus>;
  stopService(id: string): Promise<ServiceRuntimeStatus>;

  // Endpoints
  createEndpoint(serviceId: string, data: CreateEndpointInput): Promise<Endpoint>;
  updateEndpoint(serviceId: string, endpointId: string, data: Partial<Endpoint>): Promise<Endpoint>;
  deleteEndpoint(serviceId: string, endpointId: string): Promise<void>;
  reorderEndpoints(serviceId: string, orderedIds: string[]): Promise<void>;

  // Variants
  createVariant(serviceId: string, endpointId: string, data: CreateVariantInput): Promise<ResponseVariant>;
  updateVariant(serviceId: string, endpointId: string, variantId: string, data: Partial<ResponseVariant>): Promise<ResponseVariant>;
  deleteVariant(serviceId: string, endpointId: string, variantId: string): Promise<void>;
  forceVariant(serviceId: string, endpointId: string, variantId: string | null): Promise<void>;

  // History
  queryHistory(filter: HistoryFilter): Promise<HistoryEntry[]>;
  clearHistory(serviceId?: string): Promise<void>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(data: Partial<AppSettings>): Promise<AppSettings>;

  // Import
  importOpenApi(filePath: string, targetServiceId?: string): Promise<ImportResult>;
  openImportDialog(): Promise<string | null>; // returns picked file path or null

  // Test client
  sendRequest(req: TestRequest): Promise<TestResponse>;

  // Shell helpers
  openWorkspaceFolder(): Promise<void>;
  getCaPath(): Promise<string>;
  regenerateCa(): Promise<void>;
  openFileDialog(options: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;

  // Event subscriptions — return an unsubscribe function
  onRequestReceived(cb: (entry: HistoryEntry) => void): () => void;
  onServiceStatusChanged(cb: (status: ServiceRuntimeStatus) => void): () => void;
  onWorkspaceModified(cb: () => void): () => void;
}

// Augment the global Window interface so TypeScript knows about window.mokkapi
declare global {
  interface Window {
    mokkapi: MokkApiElectron;
  }
}
