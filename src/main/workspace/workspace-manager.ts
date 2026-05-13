import { readdir, readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { nanoid } from './nanoid';
import { ServiceSchema, AppSettingsSchema } from './schema';
import type { Service, AppSettings, WorkspaceState, CreateServiceInput } from '../../shared/models';

const DEFAULT_WORKSPACE_PATH = join(homedir(), 'mokkapi-workspace');

type ServiceChangeCallback = (serviceId: string) => void;

export class WorkspaceManager {
  private readonly workspacePath: string;
  private services = new Map<string, Service>();
  private settings!: AppSettings;
  private watcher: FSWatcher | null = null;
  private readonly changeListeners: ServiceChangeCallback[] = [];

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath ?? DEFAULT_WORKSPACE_PATH;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.ensureDirectories();
    await this.loadSettings();
    await this.loadAllServices();
    this.startWatcher();
    console.log(`[WorkspaceManager] Loaded ${this.services.size} service(s) from ${this.workspacePath}`);
  }

  async shutdown(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async ensureDirectories(): Promise<void> {
    for (const sub of ['', 'services', 'certs', 'imports']) {
      await mkdir(join(this.workspacePath, sub), { recursive: true });
    }
  }

  private async loadSettings(): Promise<void> {
    const path = join(this.workspacePath, 'settings.json');
    try {
      const raw = await readFile(path, 'utf-8');
      const result = AppSettingsSchema.safeParse(JSON.parse(raw));
      this.settings = result.success
        ? result.data
        : this.defaultSettings();
    } catch {
      this.settings = this.defaultSettings();
      await this.persistSettings();
    }
  }

  private defaultSettings(): AppSettings {
    return {
      workspacePath: this.workspacePath,
      theme: 'system',
      defaultPortBase: 4000,
      historyRetentionDays: 30,
      historyRetentionRows: 100_000,
    };
  }

  private async persistSettings(): Promise<void> {
    await writeFile(
      join(this.workspacePath, 'settings.json'),
      JSON.stringify(this.settings, null, 2),
      'utf-8',
    );
  }

  private async loadAllServices(): Promise<void> {
    const dir = join(this.workspacePath, 'services');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      await this.loadServiceFile(join(dir, file));
    }
  }

  private async loadServiceFile(filePath: string): Promise<Service | null> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const result = ServiceSchema.safeParse(JSON.parse(raw));
      if (result.success) {
        this.services.set(result.data.id, result.data as Service);
        return result.data as Service;
      }
      console.warn(`[WorkspaceManager] Invalid service at ${filePath}:`, result.error.flatten());
      return null;
    } catch (err) {
      console.error(`[WorkspaceManager] Cannot read ${filePath}:`, err);
      return null;
    }
  }

  private async persistService(service: Service): Promise<void> {
    await writeFile(
      join(this.workspacePath, 'services', `${service.id}.json`),
      JSON.stringify(service, null, 2),
      'utf-8',
    );
  }

  private startWatcher(): void {
    const dir = join(this.workspacePath, 'services');
    this.watcher = watch(dir, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    const reload = async (filePath: string) => {
      const svc = await this.loadServiceFile(filePath);
      if (svc) this.emit(svc.id);
    };

    this.watcher
      .on('change', reload)
      .on('add', reload)
      .on('unlink', (filePath) => {
        const id = filePath.split(/[\\/]/).pop()!.replace(/\.json$/, '');
        this.services.delete(id);
        this.emit(id);
      });
  }

  private emit(serviceId: string): void {
    for (const cb of this.changeListeners) cb(serviceId);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  onServiceChange(cb: ServiceChangeCallback): () => void {
    this.changeListeners.push(cb);
    return () => {
      const i = this.changeListeners.indexOf(cb);
      if (i !== -1) this.changeListeners.splice(i, 1);
    };
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  async saveSettings(data: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...data };
    await this.persistSettings();
    return { ...this.settings };
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  listServices(): Service[] {
    return Array.from(this.services.values());
  }

  getService(id: string): Service | undefined {
    return this.services.get(id);
  }

  async createService(data: CreateServiceInput): Promise<Service> {
    const id = slugify(data.name) || nanoid(8);
    // Ensure the id is unique
    const finalId = this.services.has(id) ? `${id}-${nanoid(4)}` : id;
    const service: Service = {
      ...data,
      id: finalId,
      endpoints: data.endpoints ?? [],
    };
    await this.persistService(service);
    this.services.set(finalId, service);
    return service;
  }

  async updateService(id: string, updates: Partial<Service>): Promise<Service> {
    const existing = this.services.get(id);
    if (!existing) throw new Error(`Service '${id}' not found`);
    const updated: Service = { ...existing, ...updates, id };
    await this.persistService(updated);
    this.services.set(id, updated);
    return updated;
  }

  async deleteService(id: string): Promise<void> {
    const filePath = join(this.workspacePath, 'services', `${id}.json`);
    await unlink(filePath).catch(() => { /* already gone */ });
    this.services.delete(id);
  }

  getWorkspaceState(serviceStatuses: Record<string, import('../../shared/models').ServiceRuntimeStatus> = {}): WorkspaceState {
    return {
      settings: this.getSettings(),
      services: this.listServices(),
      serviceStatuses,
    };
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
