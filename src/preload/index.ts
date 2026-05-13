/**
 * Electron preload script.
 * Exposes a strongly-typed window.mokkapi surface to the Angular renderer
 * via contextBridge. No raw ipcRenderer access leaks into the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-contract';
import type { MokkApiElectron } from '../shared/ipc-contract';

const mokkapi: MokkApiElectron = {
  // ── Workspace ──────────────────────────────────────────────────────────────
  getWorkspace: () => ipcRenderer.invoke(IPC.GET_WORKSPACE),

  // ── Services ───────────────────────────────────────────────────────────────
  listServices: () => ipcRenderer.invoke(IPC.LIST_SERVICES),
  createService: (data) => ipcRenderer.invoke(IPC.CREATE_SERVICE, data),
  updateService: (id, data) => ipcRenderer.invoke(IPC.UPDATE_SERVICE, { id, data }),
  deleteService: (id) => ipcRenderer.invoke(IPC.DELETE_SERVICE, id),
  startService: (id) => ipcRenderer.invoke(IPC.START_SERVICE, id),
  stopService: (id) => ipcRenderer.invoke(IPC.STOP_SERVICE, id),

  // ── Endpoints ──────────────────────────────────────────────────────────────
  createEndpoint: (serviceId, data) =>
    ipcRenderer.invoke(IPC.CREATE_ENDPOINT, { serviceId, data }),
  updateEndpoint: (serviceId, endpointId, data) =>
    ipcRenderer.invoke(IPC.UPDATE_ENDPOINT, { serviceId, endpointId, data }),
  deleteEndpoint: (serviceId, endpointId) =>
    ipcRenderer.invoke(IPC.DELETE_ENDPOINT, { serviceId, endpointId }),
  reorderEndpoints: (serviceId, orderedIds) =>
    ipcRenderer.invoke(IPC.REORDER_ENDPOINTS, { serviceId, orderedIds }),

  // ── Variants ───────────────────────────────────────────────────────────────
  createVariant: (serviceId, endpointId, data) =>
    ipcRenderer.invoke(IPC.CREATE_VARIANT, { serviceId, endpointId, data }),
  updateVariant: (serviceId, endpointId, variantId, data) =>
    ipcRenderer.invoke(IPC.UPDATE_VARIANT, { serviceId, endpointId, variantId, data }),
  deleteVariant: (serviceId, endpointId, variantId) =>
    ipcRenderer.invoke(IPC.DELETE_VARIANT, { serviceId, endpointId, variantId }),
  forceVariant: (serviceId, endpointId, variantId) =>
    ipcRenderer.invoke(IPC.FORCE_VARIANT, { serviceId, endpointId, variantId }),

  // ── History ────────────────────────────────────────────────────────────────
  queryHistory: (filter) => ipcRenderer.invoke(IPC.QUERY_HISTORY, filter),
  clearHistory: (serviceId) => ipcRenderer.invoke(IPC.CLEAR_HISTORY, { serviceId }),

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  updateSettings: (data) => ipcRenderer.invoke(IPC.UPDATE_SETTINGS, data),

  // ── Import ─────────────────────────────────────────────────────────────────
  importOpenApi: (filePath, targetServiceId) =>
    ipcRenderer.invoke(IPC.IMPORT_OPENAPI, { filePath, targetServiceId }),
  openImportDialog: () => ipcRenderer.invoke(IPC.OPEN_IMPORT_DIALOG),

  // ── Test client ────────────────────────────────────────────────────────────
  sendRequest: (req) => ipcRenderer.invoke(IPC.SEND_REQUEST, req),

  // ── Shell helpers ──────────────────────────────────────────────────────────
  openWorkspaceFolder: () => ipcRenderer.invoke(IPC.OPEN_WORKSPACE_FOLDER),
  getCaPath: () => ipcRenderer.invoke(IPC.GET_CA_PATH),
  regenerateCa: () => ipcRenderer.invoke(IPC.REGENERATE_CA),
  openFileDialog: (options) => ipcRenderer.invoke(IPC.OPEN_FILE_DIALOG, options),

  // ── Event subscriptions ────────────────────────────────────────────────────
  onRequestReceived: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, entry: Parameters<typeof cb>[0]) => cb(entry);
    ipcRenderer.on(IPC.EVT_REQUEST_RECEIVED, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_REQUEST_RECEIVED, listener);
  },

  onServiceStatusChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: Parameters<typeof cb>[0]) => cb(status);
    ipcRenderer.on(IPC.EVT_SERVICE_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_SERVICE_STATUS, listener);
  },

  onWorkspaceModified: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.EVT_WORKSPACE_MODIFIED, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_WORKSPACE_MODIFIED, listener);
  },
};

contextBridge.exposeInMainWorld('mokkapi', mokkapi);
