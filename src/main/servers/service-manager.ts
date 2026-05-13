/**
 * ServiceManager — orchestrates all ServiceHost instances.
 * Reads services from WorkspaceManager, starts enabled ones on init,
 * and reacts to workspace file changes by restarting the affected service.
 */

import { ServiceHost } from './service-host';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { HistoryStore } from '../history/history-store';
import type { HistoryEntry, ServiceRuntimeStatus } from '../../shared/models';

type StatusBroadcast = (status: ServiceRuntimeStatus) => void;
type HistoryBroadcast = (entry: HistoryEntry) => void;

export class ServiceManager {
  private hosts = new Map<string, ServiceHost>();

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly history: HistoryStore,
    private readonly broadcastStatus: StatusBroadcast,
    private readonly broadcastHistory: HistoryBroadcast,
  ) {}

  async init(): Promise<void> {
    // Start all enabled services
    for (const service of this.workspace.listServices()) {
      if (service.enabled) {
        await this.startService(service.id).catch((err) =>
          console.error(`[ServiceManager] Failed to start '${service.id}':`, err),
        );
      }
    }

    // React to workspace file changes (external edits, mokkapi UI saves)
    this.workspace.onServiceChange(async (serviceId) => {
      const svc = this.workspace.getService(serviceId);
      if (!svc) {
        // Service deleted
        await this.stopService(serviceId).catch(() => {});
        return;
      }
      // Update service config in existing host (if running, restart)
      const host = this.hosts.get(serviceId);
      if (host) {
        host.setService(svc);
        if (host.getStatus().status === 'running') {
          await this.restartService(serviceId).catch((err) =>
            console.warn(`[ServiceManager] Restart failed for '${serviceId}':`, err),
          );
        }
      } else if (svc.enabled) {
        await this.startService(serviceId).catch((err) =>
          console.warn(`[ServiceManager] Start failed for '${serviceId}':`, err),
        );
      }
    });
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.hosts.values()).map((h) => h.stop()),
    );
    this.hosts.clear();
  }

  // ─── Public API (called by IPC handlers) ───────────────────────────────────

  async startService(serviceId: string): Promise<ServiceRuntimeStatus> {
    const svc = this.workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);

    let host = this.hosts.get(serviceId);
    if (!host) {
      host = new ServiceHost(svc, this.history, (entry) => {
        this.broadcastHistory(entry);
      });
      this.hosts.set(serviceId, host);
    } else {
      host.setService(svc);
    }

    await host.start();
    const status = host.getStatus();
    this.broadcastStatus(status);
    return status;
  }

  async stopService(serviceId: string): Promise<ServiceRuntimeStatus> {
    const host = this.hosts.get(serviceId);
    if (host) {
      await host.stop();
      const status = host.getStatus();
      this.broadcastStatus(status);
      return status;
    }
    return { serviceId, status: 'stopped' };
  }

  async restartService(serviceId: string): Promise<ServiceRuntimeStatus> {
    await this.stopService(serviceId);
    return this.startService(serviceId);
  }

  getStatus(serviceId: string): ServiceRuntimeStatus {
    return (
      this.hosts.get(serviceId)?.getStatus() ?? { serviceId, status: 'stopped' }
    );
  }

  getAllStatuses(): Record<string, ServiceRuntimeStatus> {
    const out: Record<string, ServiceRuntimeStatus> = {};
    for (const [id, host] of this.hosts) {
      out[id] = host.getStatus();
    }
    return out;
  }
}
