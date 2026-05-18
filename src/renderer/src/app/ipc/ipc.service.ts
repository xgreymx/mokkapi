/**
 * IpcService — thin Angular wrapper around window.mokkapi (contextBridge surface).
 * All methods delegate directly; this service adds:
 *   - an injectable token that can be mocked in tests
 *   - a safe fallback when running in a browser outside Electron (dev stubs)
 */

import { Injectable } from '@angular/core';
import type { MokkApiElectron } from '@shared/ipc-contract';
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
  CaTrustStatus,
  CreateServiceInput,
  CreateEndpointInput,
  CreateVariantInput,
} from '@shared/models';

function api(): MokkApiElectron {
  if (typeof window !== 'undefined' && 'mokkapi' in window) {
    return window.mokkapi;
  }
  throw new Error('[IpcService] window.mokkapi is not defined — are we running outside Electron?');
}

@Injectable({ providedIn: 'root' })
export class IpcService {
  // ── Workspace ──────────────────────────────────────────────────────────────
  getWorkspace(): Promise<WorkspaceState> { return api().getWorkspace(); }

  // ── Services ───────────────────────────────────────────────────────────────
  listServices(): Promise<Service[]> { return api().listServices(); }
  createService(data: CreateServiceInput): Promise<Service> { return api().createService(data); }
  updateService(id: string, data: Partial<Service>): Promise<Service> { return api().updateService(id, data); }
  deleteService(id: string): Promise<void> { return api().deleteService(id); }
  startService(id: string): Promise<ServiceRuntimeStatus> { return api().startService(id); }
  stopService(id: string): Promise<ServiceRuntimeStatus> { return api().stopService(id); }

  // ── Endpoints ──────────────────────────────────────────────────────────────
  createEndpoint(serviceId: string, data: CreateEndpointInput): Promise<Endpoint> {
    return api().createEndpoint(serviceId, data);
  }
  updateEndpoint(serviceId: string, endpointId: string, data: Partial<Endpoint>): Promise<Endpoint> {
    return api().updateEndpoint(serviceId, endpointId, data);
  }
  deleteEndpoint(serviceId: string, endpointId: string): Promise<void> {
    return api().deleteEndpoint(serviceId, endpointId);
  }
  reorderEndpoints(serviceId: string, orderedIds: string[]): Promise<void> {
    return api().reorderEndpoints(serviceId, orderedIds);
  }

  // ── Variants ───────────────────────────────────────────────────────────────
  createVariant(serviceId: string, endpointId: string, data: CreateVariantInput): Promise<ResponseVariant> {
    return api().createVariant(serviceId, endpointId, data);
  }
  updateVariant(serviceId: string, endpointId: string, variantId: string, data: Partial<ResponseVariant>): Promise<ResponseVariant> {
    return api().updateVariant(serviceId, endpointId, variantId, data);
  }
  deleteVariant(serviceId: string, endpointId: string, variantId: string): Promise<void> {
    return api().deleteVariant(serviceId, endpointId, variantId);
  }
  forceVariant(serviceId: string, endpointId: string, variantId: string | null): Promise<void> {
    return api().forceVariant(serviceId, endpointId, variantId);
  }

  // ── History ────────────────────────────────────────────────────────────────
  queryHistory(filter: HistoryFilter): Promise<HistoryEntry[]> { return api().queryHistory(filter); }
  clearHistory(serviceId?: string): Promise<void> { return api().clearHistory(serviceId); }
  deleteHistoryEntry(entryId: number): Promise<void> { return api().deleteHistoryEntry(entryId); }

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings(): Promise<AppSettings> { return api().getSettings(); }
  updateSettings(data: Partial<AppSettings>): Promise<AppSettings> { return api().updateSettings(data); }

  // ── App metadata ───────────────────────────────────────────────────────────
  getAppVersion(): Promise<string> { return api().getAppVersion(); }

  // ── Import ─────────────────────────────────────────────────────────────────
  importOpenApi(filePath: string, targetServiceId?: string): Promise<ImportResult> {
    return api().importOpenApi(filePath, targetServiceId);
  }
  openImportDialog(): Promise<string | null> { return api().openImportDialog(); }

  // ── Test client ────────────────────────────────────────────────────────────
  sendRequest(req: TestRequest): Promise<TestResponse> { return api().sendRequest(req); }

  // ── Shell helpers ──────────────────────────────────────────────────────────
  openWorkspaceFolder(): Promise<void> { return api().openWorkspaceFolder(); }
  getCaPath(): Promise<string> { return api().getCaPath(); }
  getCaTrustStatus(): Promise<CaTrustStatus> { return api().getCaTrustStatus(); }
  installCa(): Promise<CaTrustStatus> { return api().installCa(); }
  regenerateCa(): Promise<void> { return api().regenerateCa(); }
  openFileDialog(options: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> {
    return api().openFileDialog(options);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  onRequestReceived(cb: (entry: HistoryEntry) => void): () => void {
    return api().onRequestReceived(cb);
  }
  onServiceStatusChanged(cb: (status: ServiceRuntimeStatus) => void): () => void {
    return api().onServiceStatusChanged(cb);
  }
  onWorkspaceModified(cb: () => void): () => void {
    return api().onWorkspaceModified(cb);
  }
}
