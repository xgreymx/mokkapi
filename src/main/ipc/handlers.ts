/**
 * Registers all ipcMain handlers.
 * Part 2: wires in the real ServiceManager, HistoryStore, CertManager, and OpenAPI importer.
 */

import { app, type IpcMain, type BrowserWindow, type Dialog, type Shell } from 'electron';
import { IPC } from './channels';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { ServiceManager } from '../servers/service-manager';
import type { HistoryStore } from '../history/history-store';
import type { CertManager } from '../servers/cert-manager';
import { importOpenApi3 } from '../importers/openapi3';

export function registerIpcHandlers(
  workspace:  WorkspaceManager,
  services:   ServiceManager,
  history:    HistoryStore,
  certMgr:    CertManager,
  getWindow:  () => BrowserWindow | null,
  ipcMain:    IpcMain,
  dialog:     Dialog,
  shell:      Shell,
): void {

  // ── Workspace ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_WORKSPACE, () =>
    workspace.getWorkspaceState(services.getAllStatuses()),
  );

  // ── Services ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LIST_SERVICES, () => workspace.listServices());

  ipcMain.handle(IPC.CREATE_SERVICE, (_e, data) =>
    workspace.createService(data),
  );

  ipcMain.handle(IPC.UPDATE_SERVICE, (_e, { id, data }) =>
    workspace.updateService(id, data),
  );

  ipcMain.handle(IPC.DELETE_SERVICE, async (_e, id: string) => {
    await services.stopService(id).catch(() => {});
    await workspace.deleteService(id);
  });

  ipcMain.handle(IPC.START_SERVICE, (_e, id: string) =>
    services.startService(id),
  );

  ipcMain.handle(IPC.STOP_SERVICE, (_e, id: string) =>
    services.stopService(id),
  );

  // ── Endpoints ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CREATE_ENDPOINT, async (_e, { serviceId, data }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    const endpoint = { ...data, id: randomId() };
    await workspace.updateService(serviceId, {
      endpoints: [...svc.endpoints, endpoint],
    });
    return endpoint;
  });

  ipcMain.handle(IPC.UPDATE_ENDPOINT, async (_e, { serviceId, endpointId, data }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    let updated: typeof svc.endpoints[number] | undefined;
    const endpoints = svc.endpoints.map((ep) => {
      if (ep.id !== endpointId) return ep;
      updated = { ...ep, ...data, id: endpointId };
      return updated;
    });
    if (!updated) throw new Error(`Endpoint '${endpointId}' not found`);
    await workspace.updateService(serviceId, { endpoints });
    return updated;
  });

  ipcMain.handle(IPC.DELETE_ENDPOINT, async (_e, { serviceId, endpointId }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    await workspace.updateService(serviceId, {
      endpoints: svc.endpoints.filter((ep) => ep.id !== endpointId),
    });
  });

  ipcMain.handle(IPC.REORDER_ENDPOINTS, async (_e, { serviceId, orderedIds }: { serviceId: string; orderedIds: string[] }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    const map = new Map(svc.endpoints.map((ep) => [ep.id, ep]));
    await workspace.updateService(serviceId, {
      endpoints: orderedIds.map((id) => map.get(id)!).filter(Boolean),
    });
  });

  // ── Variants ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CREATE_VARIANT, async (_e, { serviceId, endpointId, data }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    const variant = { ...data, id: randomId() };
    const endpoints = svc.endpoints.map((ep) =>
      ep.id === endpointId ? { ...ep, variants: [...ep.variants, variant] } : ep,
    );
    await workspace.updateService(serviceId, { endpoints });
    return variant;
  });

  ipcMain.handle(IPC.UPDATE_VARIANT, async (_e, { serviceId, endpointId, variantId, data }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    let updated: import('../../shared/models').ResponseVariant | undefined;
    const endpoints = svc.endpoints.map((ep) => {
      if (ep.id !== endpointId) return ep;
      const variants = ep.variants.map((v) => {
        if (v.id !== variantId) return v;
        updated = { ...v, ...data, id: variantId };
        return updated;
      });
      return { ...ep, variants };
    });
    if (!updated) throw new Error(`Variant '${variantId}' not found`);
    await workspace.updateService(serviceId, { endpoints });
    return updated;
  });

  ipcMain.handle(IPC.DELETE_VARIANT, async (_e, { serviceId, endpointId, variantId }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    const endpoints = svc.endpoints.map((ep) => {
      if (ep.id !== endpointId) return ep;
      return { ...ep, variants: ep.variants.filter((v) => v.id !== variantId) };
    });
    await workspace.updateService(serviceId, { endpoints });
  });

  ipcMain.handle(IPC.FORCE_VARIANT, async (_e, { serviceId, endpointId, variantId }) => {
    const svc = workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);
    const endpoints = svc.endpoints.map((ep) =>
      ep.id === endpointId ? { ...ep, forcedVariantId: variantId } : ep,
    );
    await workspace.updateService(serviceId, { endpoints });
  });

  // ── History ────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.QUERY_HISTORY, (_e, filter) =>
    history.query(filter),
  );

  ipcMain.handle(IPC.CLEAR_HISTORY, (_e, { serviceId }: { serviceId?: string }) => {
    history.clear(serviceId);
  });

  ipcMain.handle(IPC.DELETE_HISTORY_ENTRY, (_e, { entryId }: { entryId: number }) => {
    history.delete(entryId);
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SETTINGS, () => workspace.getSettings());

  ipcMain.handle(IPC.UPDATE_SETTINGS, (_e, data) =>
    workspace.saveSettings(data),
  );

  ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion());

  // ── OpenAPI import ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.IMPORT_OPENAPI, (_e, { filePath, targetServiceId }) =>
    importOpenApi3(filePath, workspace, targetServiceId),
  );

  ipcMain.handle(IPC.OPEN_IMPORT_DIALOG, async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose OpenAPI 3 spec',
      filters: [{ name: 'OpenAPI', extensions: ['yaml', 'yml', 'json'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Test client ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SEND_REQUEST, async (_e, req) => {
    const start = Date.now();
    try {
      const resp = await fetch(req.url, {
        method: req.method,
        headers: new Headers(req.headers),
        body: req.body ?? undefined,
        // @ts-expect-error Node 20 fetch supports this but TS types may lag
        signal: AbortSignal.timeout(30_000),
      });
      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => { headers[k] = v; });
      return {
        status: resp.status,
        statusText: resp.statusText,
        headers,
        body,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return {
        status: 0,
        statusText: 'Error',
        headers: {},
        body: null,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // ── Shell / CA helpers ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.OPEN_WORKSPACE_FOLDER, () =>
    shell.openPath(workspace.getWorkspacePath()),
  );

  ipcMain.handle(IPC.GET_CA_PATH, () => certMgr.getCaPath());

  ipcMain.handle(IPC.GET_CA_TRUST_STATUS, () => certMgr.getCaTrustStatus());

  ipcMain.handle(IPC.INSTALL_CA, () => certMgr.installCa());

  ipcMain.handle(IPC.REGENERATE_CA, () => certMgr.generateCa());

  ipcMain.handle(IPC.OPEN_FILE_DIALOG, async (_e, options) => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: options.title,
      filters: options.filters,
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
