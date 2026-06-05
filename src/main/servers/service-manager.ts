/**
 * ServiceManager — orchestrates all ServiceHost instances.
 * Reads services from WorkspaceManager, starts enabled ones on init,
 * and reacts to workspace file changes by restarting the affected service.
 */

import { ServiceHost } from './service-host';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { HistoryStore } from '../history/history-store';
import type { CertManager } from './cert-manager';
import type {
  HistoryEntry,
  Service,
  ServiceRuntimeStatus,
  IisDiagnosticsReport,
  IisIntegrationStatus,
} from '../../shared/models';
import type { Shell } from 'electron';
import { IisManager } from './iis-manager';

type StatusBroadcast = (status: ServiceRuntimeStatus) => void;
type HistoryBroadcast = (entry: HistoryEntry) => void;

export class ServiceManager {
  private hosts = new Map<string, ServiceHost>();

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly history: HistoryStore,
    private readonly certs: CertManager,
    private readonly iis: IisManager,
    private readonly broadcastStatus: StatusBroadcast,
    private readonly broadcastHistory: HistoryBroadcast,
  ) {}

  async init(): Promise<void> {
    for (const service of this.workspace.listServices()) {
      if (service.enabled) {
        await this.startServiceInternal(service.id, { allowElevation: false }).catch((err) =>
          console.error(`[ServiceManager] Failed to start '${service.id}':`, err),
        );
      }
    }

    this.workspace.onServiceChange(async (serviceId) => {
      const svc = this.workspace.getService(serviceId);
      if (!svc) {
        await this.stopService(serviceId).catch(() => {});
        return;
      }

      const host = this.hosts.get(serviceId);
      if (host) {
        host.setService(svc);
        if (host.getStatus().status === 'running') {
          await this.restartService(serviceId, { allowElevation: false }).catch((err) =>
            console.warn(`[ServiceManager] Restart failed for '${serviceId}':`, err),
          );
        }
      } else if (svc.enabled) {
        await this.startServiceInternal(serviceId, { allowElevation: false }).catch((err) =>
          console.warn(`[ServiceManager] Start failed for '${serviceId}':`, err),
        );
      }
    });
  }

  async shutdown(): Promise<void> {
    const proxiedServiceIds = Array.from(this.hosts.entries())
      .filter(([, host]) => host.getStatus().exposure === 'iis')
      .map(([serviceId]) => serviceId);

    await Promise.allSettled(
      Array.from(this.hosts.values()).map((host) => host.stop()),
    );
    await Promise.allSettled(
      proxiedServiceIds.map((serviceId) => this.iis.removeServiceProxy(serviceId)),
    );
    this.hosts.clear();
  }

  getIisIntegrationStatus(
    service: Pick<Service, 'port' | 'protocol'>,
    options?: { allowElevation?: boolean },
  ): Promise<IisIntegrationStatus> {
    return this.iis.inspectService(service, options);
  }

  getIisDiagnostics(options?: { allowElevation?: boolean }): Promise<IisDiagnosticsReport> {
    return this.iis.inspectBindings(options);
  }

  async openIisSiteConfig(serviceId: string, shell: Shell): Promise<void> {
    const host = this.hosts.get(serviceId);
    const status = host?.getStatus();
    const siteName = status?.exposure === 'iis' ? status.iisSiteName : null;
    if (!siteName) {
      throw new Error('The selected service is not currently published through IIS.');
    }

    const configPath = await this.iis.getSiteConfigPath(siteName, { allowElevation: true });
    const shellResult = await shell.openPath(configPath);
    if (shellResult) {
      throw new Error(shellResult);
    }
  }

  async startService(serviceId: string): Promise<ServiceRuntimeStatus> {
    return this.startServiceInternal(serviceId, { allowElevation: true });
  }

  private async startServiceInternal(
    serviceId: string,
    options: { allowElevation: boolean },
  ): Promise<ServiceRuntimeStatus> {
    const svc = this.workspace.getService(serviceId);
    if (!svc) throw new Error(`Service '${serviceId}' not found`);

    let host = this.hosts.get(serviceId);
    if (!host) {
      host = new ServiceHost(svc, this.history, this.certs, (entry) => {
        this.broadcastHistory(entry);
      });
      this.hosts.set(serviceId, host);
    } else {
      host.setService(svc);
    }

    const toBlockedStatus = (
      exposure: 'direct' | 'iis',
      errorMessage: string,
      siteName?: string | null,
    ): ServiceRuntimeStatus => ({
      serviceId,
      status: 'error',
      port: svc.port,
      exposure,
      ...(siteName ? { iisSiteName: siteName } : {}),
      error: errorMessage,
    });

    const finalizeError = async (
      error: unknown,
      exposure: 'direct' | 'iis',
      siteName?: string | null,
    ): Promise<never> => {
      await host.stop().catch(() => {});
      const status = toBlockedStatus(
        exposure,
        error instanceof Error ? error.message : String(error),
        siteName,
      );
      host.setRuntimeStatus(status);
      this.broadcastStatus(status);
      throw error;
    };

    const startDirect = async (): Promise<ServiceRuntimeStatus> => {
      try {
        await host.start({
          port: svc.port,
          publicPort: svc.port,
          protocol: svc.protocol,
          exposure: 'direct',
        });
      } catch (error) {
        await finalizeError(error, 'direct');
      }

      return host.getStatus();
    };

    const startViaIis = async (siteName: string): Promise<ServiceRuntimeStatus> => {
      try {
        await host.start({
          port: 0,
          publicPort: svc.port,
          protocol: 'http',
          exposure: 'iis',
          iisSiteName: siteName,
          localOnly: true,
        });

        const backendPort = host.getStatus().listenPort;
        if (!backendPort) {
          throw new Error('Could not determine the internal backend port for IIS.');
        }

        await this.iis.applyServiceProxy(svc, siteName, backendPort);
      } catch (error) {
        await finalizeError(error, 'iis', siteName);
      }

      return host.getStatus();
    };

    const initialIisStatus = await this.iis.inspectService(svc, { allowElevation: false });

    if (initialIisStatus.bindingActive && !initialIisStatus.canProxy) {
      const status = toBlockedStatus(
        'iis',
        initialIisStatus.message ?? 'IIS is active on this binding but URL Rewrite and ARR are required.',
        initialIisStatus.siteName,
      );
      host.setRuntimeStatus(status);
      this.broadcastStatus(status);
      return status;
    }

    if (initialIisStatus.bindingActive && initialIisStatus.canProxy && initialIisStatus.siteName) {
      const status = await startViaIis(initialIisStatus.siteName);
      this.broadcastStatus(status);
      return status;
    }

    try {
      const status = await startDirect();
      this.broadcastStatus(status);
      return status;
    } catch (error) {
      if (!shouldInspectIisAfterBindFailure(error)) {
        throw error;
      }

      if (!options.allowElevation) {
        const status = toBlockedStatus(
          initialIisStatus.requiresElevation ? 'iis' : 'direct',
          initialIisStatus.requiresElevation
            ? (initialIisStatus.message ?? 'Administrator permission is required to inspect IIS before starting this service automatically.')
            : (error instanceof Error ? error.message : String(error)),
        );
        host.setRuntimeStatus(status);
        this.broadcastStatus(status);
        return status;
      }
    }

    const elevatedIisStatus = await this.iis.inspectService(svc, { allowElevation: true });

    if (elevatedIisStatus.bindingActive && !elevatedIisStatus.canProxy) {
      const status = toBlockedStatus(
        'iis',
        elevatedIisStatus.message ?? 'IIS is active on this binding but URL Rewrite and ARR are required.',
        elevatedIisStatus.siteName,
      );
      host.setRuntimeStatus(status);
      this.broadcastStatus(status);
      return status;
    }

    if (elevatedIisStatus.bindingActive && elevatedIisStatus.canProxy && elevatedIisStatus.siteName) {
      const status = await startViaIis(elevatedIisStatus.siteName);
      this.broadcastStatus(status);
      return status;
    }

    const status = toBlockedStatus(
      'direct',
      'The port is already in use, but IIS did not report an active matching binding for this service.',
    );
    host.setRuntimeStatus(status);
    this.broadcastStatus(status);
    return status;
  }

  async stopService(serviceId: string): Promise<ServiceRuntimeStatus> {
    let cleanupError: string | null = null;
    const host = this.hosts.get(serviceId);
    if (host) {
      const previousStatus = host.getStatus();
      await host.stop();
      if (previousStatus.exposure === 'iis') {
        await this.iis.removeServiceProxy(serviceId).catch((error: unknown) => {
          cleanupError = error instanceof Error ? error.message : String(error);
        });
      }
      const status = host.getStatus();
      if (cleanupError) {
        const errorStatus: ServiceRuntimeStatus = {
          serviceId,
          status: 'error',
          error: cleanupError,
        };
        host.setRuntimeStatus(errorStatus);
        this.broadcastStatus(errorStatus);
        return errorStatus;
      }
      this.broadcastStatus(status);
      return status;
    }
    return { serviceId, status: 'stopped' };
  }

  async restartService(
    serviceId: string,
    options: { allowElevation: boolean } = { allowElevation: true },
  ): Promise<ServiceRuntimeStatus> {
    await this.stopService(serviceId);
    return this.startServiceInternal(serviceId, options);
  }

  getStatus(serviceId: string): ServiceRuntimeStatus {
    return this.hosts.get(serviceId)?.getStatus() ?? { serviceId, status: 'stopped' };
  }

  getAllStatuses(): Record<string, ServiceRuntimeStatus> {
    const out: Record<string, ServiceRuntimeStatus> = {};
    for (const [id, host] of this.hosts) {
      out[id] = host.getStatus();
    }
    return out;
  }
}

function shouldInspectIisAfterBindFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /EADDRINUSE|already in use|Only one usage of each socket address/i.test(message);
}
