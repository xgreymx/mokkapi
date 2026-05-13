/**
 * WorkspaceStore — Angular signal-based state store for the workspace.
 * Single source of truth for services, statuses, and settings in the renderer.
 * Loaded eagerly on app init; updated via IPC events.
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import type { Service, ServiceRuntimeStatus, AppSettings } from '@shared/models';

export type ServiceWithStatus = Service & { status: ServiceRuntimeStatus };

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly ipc = inject(IpcService);

  // ── Raw signals ────────────────────────────────────────────────────────────
  readonly services      = signal<Service[]>([]);
  readonly statuses      = signal<Record<string, ServiceRuntimeStatus>>({});
  readonly settings      = signal<AppSettings | null>(null);
  readonly loading       = signal(true);
  readonly error         = signal<string | null>(null);
  readonly selectedServiceId = signal<string | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  readonly servicesWithStatus = computed<ServiceWithStatus[]>(() =>
    this.services().map((svc) => ({
      ...svc,
      status: this.statuses()[svc.id] ?? { serviceId: svc.id, status: 'stopped' },
    })),
  );

  readonly selectedService = computed(() =>
    this.servicesWithStatus().find((s) => s.id === this.selectedServiceId()) ?? null,
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  private unsubscribeStatus: (() => void) | null = null;
  private unsubscribeModified: (() => void) | null = null;

  async init(): Promise<void> {
    try {
      const ws = await this.ipc.getWorkspace();
      this.services.set(ws.services);
      this.statuses.set(ws.serviceStatuses);
      this.settings.set(ws.settings);

      // Subscribe to live events
      this.unsubscribeStatus = this.ipc.onServiceStatusChanged((status) => {
        this.statuses.update((prev) => ({ ...prev, [status.serviceId]: status }));
      });

      this.unsubscribeModified = this.ipc.onWorkspaceModified(async () => {
        const refreshed = await this.ipc.getWorkspace();
        this.services.set(refreshed.services);
        this.statuses.set(refreshed.serviceStatuses);
        this.settings.set(refreshed.settings);
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally {
      this.loading.set(false);
    }
  }

  destroy(): void {
    this.unsubscribeStatus?.();
    this.unsubscribeModified?.();
  }

  // ── Mutations (optimistic updates + IPC round-trip) ───────────────────────

  async createService(data: Parameters<IpcService['createService']>[0]): Promise<Service> {
    const svc = await this.ipc.createService(data);
    this.services.update((prev) => [...prev, svc]);
    return svc;
  }

  async updateService(id: string, data: Partial<Service>): Promise<Service> {
    const svc = await this.ipc.updateService(id, data);
    this.services.update((prev) => prev.map((s) => (s.id === id ? svc : s)));
    return svc;
  }

  async deleteService(id: string): Promise<void> {
    await this.ipc.deleteService(id);
    this.services.update((prev) => prev.filter((s) => s.id !== id));
    if (this.selectedServiceId() === id) this.selectedServiceId.set(null);
  }

  async startService(id: string): Promise<void> {
    const status = await this.ipc.startService(id);
    this.statuses.update((prev) => ({ ...prev, [id]: status }));
  }

  async stopService(id: string): Promise<void> {
    const status = await this.ipc.stopService(id);
    this.statuses.update((prev) => ({ ...prev, [id]: status }));
  }

  async updateSettings(data: Partial<AppSettings>): Promise<void> {
    const updated = await this.ipc.updateSettings(data);
    this.settings.set(updated);
  }

  selectService(id: string | null): void {
    this.selectedServiceId.set(id);
  }

  async refreshSelectedService(): Promise<void> {
    const ws = await this.ipc.getWorkspace();
    this.services.set(ws.services);
    this.statuses.set(ws.serviceStatuses);
  }
}
