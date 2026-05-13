import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { join } from 'path';
import { WorkspaceManager } from './workspace/workspace-manager';
import { HistoryStore } from './history/history-store';
import { CertManager } from './servers/cert-manager';
import { ServiceManager } from './servers/service-manager';
import { registerIpcHandlers } from './ipc/handlers';
import { IPC } from './ipc/channels';
import type { HistoryEntry, ServiceRuntimeStatus } from '../shared/models';

let mainWindow: BrowserWindow | null = null;
const workspace = new WorkspaceManager();

let history!:  HistoryStore;
let certMgr!:  CertManager;
let services!: ServiceManager;

// ─── Window ────────────────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0B0B0C',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await workspace.init();

  const wsPath = workspace.getWorkspacePath();
  history = new HistoryStore(wsPath);
  certMgr = new CertManager(join(wsPath, 'certs'));

  // Non-blocking: generate local CA on first run
  certMgr.getOrCreateCa().catch((e) =>
    console.warn('[Main] CA generation skipped:', e),
  );

  // Prune old history entries
  history.trim(workspace.getSettings());

  const broadcastStatus = (status: ServiceRuntimeStatus): void => {
    mainWindow?.webContents.send(IPC.EVT_SERVICE_STATUS, status);
  };
  const broadcastHistory = (entry: HistoryEntry): void => {
    mainWindow?.webContents.send(IPC.EVT_REQUEST_RECEIVED, entry);
  };

  services = new ServiceManager(workspace, history, broadcastStatus, broadcastHistory);
  await services.init();

  // Broadcast workspace changes caused by external file edits
  workspace.onServiceChange(() => {
    mainWindow?.webContents.send(IPC.EVT_WORKSPACE_MODIFIED);
  });

  registerIpcHandlers(
    workspace,
    services,
    history,
    certMgr,
    () => mainWindow,
    ipcMain,
    dialog,
    shell,
  );

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', async () => {
  await services?.shutdown();
  history?.close();
  await workspace.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const { hostname, protocol } = new URL(url);
    if (!['localhost', '127.0.0.1'].includes(hostname) && protocol !== 'file:') {
      event.preventDefault();
    }
  });
});
