import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { CertificateTrustService } from '../../data/certificate-trust.service';
import { WorkspaceStore } from '../../data/workspace.store';
import { IpcService } from '../../ipc/ipc.service';
import { EndpointEditorComponent } from './endpoint-editor.component';
import type { Endpoint, ExportCertChoice, ExportCertSource, ExportResult, ExportTarget, IisIntegrationStatus, ServiceProtocol } from '@shared/models';

@Component({
  selector: 'app-services-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EndpointEditorComponent],
  templateUrl: './services-page.component.html',
  styleUrl: './services-page.component.css',
})
export class ServicesPageComponent implements OnDestroy {
  protected readonly caTrust = inject(CertificateTrustService);
  protected readonly store = inject(WorkspaceStore);
  protected readonly ipc = inject(IpcService);

  protected readonly showNewServiceForm = signal(false);
  protected readonly showEditServiceForm = signal(false);
  protected readonly showServicesRail = signal(true);
  protected readonly showEndpointsRail = signal(true);
  protected readonly peekServicesRail = signal(false);
  protected readonly peekEndpointsRail = signal(false);
  protected readonly selectedEndpointId = signal<string | null>(null);
  protected readonly newProtocol = signal<ServiceProtocol>('http');
  protected readonly editProtocol = signal<ServiceProtocol>('http');
  protected readonly iisStatus = signal<IisIntegrationStatus | null>(null);
  protected readonly newPort = signal(0);
  protected readonly editPort = signal(0);
  protected readonly newServiceIisStatus = signal<IisIntegrationStatus | null>(null);
  protected readonly editServiceIisStatus = signal<IisIntegrationStatus | null>(null);
  protected readonly iisInstallWarning = computed(() => {
    const status = this.iisStatus();
    if (!status?.bindingActive || status.canProxy || !status.message) return null;
    return status.message;
  });
  protected readonly newServiceIisMessage = computed(() => this.describeModalIisState(this.newServiceIisStatus()));
  protected readonly editServiceIisMessage = computed(() => this.describeModalIisState(this.editServiceIisStatus()));
  protected readonly servicesRailVisible = computed(() => this.showServicesRail() || this.peekServicesRail());
  protected readonly endpointsRailVisible = computed(() => this.showEndpointsRail() || this.peekEndpointsRail());
  protected readonly pendingServiceAction = signal<'start' | 'stop' | null>(null);
  protected readonly pendingServiceId = signal<string | null>(null);
  protected readonly iisConfigFeedback = signal<string | null>(null);

  // ── .NET export ────────────────────────────────────────────────────────────
  protected readonly showExportForm = signal(false);
  protected readonly exportTargets = signal<Record<ExportTarget, boolean>>({
    selfcontained: true,
    docker: true,
    framework: true,
  });
  protected readonly exportOutputDir = signal<string | null>(null);
  protected readonly exporting = signal(false);
  protected readonly exportResult = signal<ExportResult | null>(null);
  protected readonly exportError = signal<string | null>(null);
  protected readonly anyExportTarget = computed(() =>
    Object.values(this.exportTargets()).some(Boolean),
  );
  // HTTPS certificate selection (only relevant when the service uses https).
  protected readonly exportCertSource = signal<ExportCertSource>('self-signed');
  protected readonly customCertPath = signal<string | null>(null);
  protected readonly customKeyPath = signal<string | null>(null);
  protected readonly dotnetAvailable = signal(false);
  /** The 'custom' source needs both files before export can run. */
  protected readonly exportCertReady = computed(() =>
    this.exportCertSource() !== 'custom' || (!!this.customCertPath() && !!this.customKeyPath()),
  );

  private servicesRailPeekTimer: ReturnType<typeof setTimeout> | null = null;
  private endpointsRailPeekTimer: ReturnType<typeof setTimeout> | null = null;
  private iisStatusRequestId = 0;
  private newServiceIisRequestId = 0;
  private editServiceIisRequestId = 0;
  private readonly railPeekDelayMs = 260;

  private readonly syncSelectedServiceIisStatus = effect(() => {
    const service = this.store.selectedService();
    if (!service || !this.usesIisManagedPort(service.protocol, service.port)) {
      this.iisStatusRequestId++;
      this.iisStatus.set(null);
      return;
    }

    const requestId = ++this.iisStatusRequestId;
    this.ipc.getIisStatus(service.port, service.protocol)
      .then((status) => {
        if (requestId !== this.iisStatusRequestId) return;
        this.iisStatus.set(status);
      })
      .catch((error: unknown) => {
        if (requestId !== this.iisStatusRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        this.iisStatus.set({
          applicable: true,
          iisInstalled: false,
          requiresElevation: false,
          bindingActive: false,
          siteName: null,
          urlRewriteInstalled: false,
          arrInstalled: false,
          canProxy: false,
          message,
        });
      });
  });

  private readonly syncNewServiceIisStatus = effect(() => {
    const protocol = this.newProtocol();
    const port = this.newPort();
    if (!this.showNewServiceForm() || !this.usesIisManagedPort(protocol, port)) {
      this.newServiceIisRequestId++;
      this.newServiceIisStatus.set(null);
      return;
    }

    const requestId = ++this.newServiceIisRequestId;
    this.ipc.getIisStatus(port, protocol)
      .then((status) => {
        if (requestId !== this.newServiceIisRequestId) return;
        this.newServiceIisStatus.set(status.iisInstalled ? status : null);
      })
      .catch(() => {
        if (requestId !== this.newServiceIisRequestId) return;
        this.newServiceIisStatus.set(null);
      });
  });

  private readonly syncEditServiceIisStatus = effect(() => {
    const protocol = this.editProtocol();
    const port = this.editPort();
    if (!this.showEditServiceForm() || !this.usesIisManagedPort(protocol, port)) {
      this.editServiceIisRequestId++;
      this.editServiceIisStatus.set(null);
      return;
    }

    const requestId = ++this.editServiceIisRequestId;
    this.ipc.getIisStatus(port, protocol)
      .then((status) => {
        if (requestId !== this.editServiceIisRequestId) return;
        this.editServiceIisStatus.set(status.iisInstalled ? status : null);
      })
      .catch(() => {
        if (requestId !== this.editServiceIisRequestId) return;
        this.editServiceIisStatus.set(null);
      });
  });

  protected readonly selectedEndpoint = computed(() => {
    const id = this.selectedEndpointId();
    if (!id) return null;
    return this.store.selectedService()?.endpoints.find((e) => e.id === id) ?? null;
  });

  protected readonly listeningPorts = computed(() =>
    this.store.servicesWithStatus()
      .filter((service) => service.status.status === 'running')
      .map((service) => ({ id: service.id, port: service.port })),
  );

  protected readonly nextPort = computed(() => {
    const ports = this.store.services().map((s) => s.port);
    const base = this.store.settings()?.defaultPortBase ?? 4000;
    let p = base + 1;
    while (ports.includes(p)) p++;
    return p;
  });

  protected selectService(id: string): void {
    this.store.selectService(id);
    this.selectedEndpointId.set(null);
    this.showEndpointsRail.set(true);
  }

  protected toggleServicesRail(): void {
    const next = !this.showServicesRail();
    this.showServicesRail.set(next);
    if (next) this.peekServicesRail.set(false);
    this.clearServicesRailPeekTimer();
  }

  protected toggleEndpointsRail(): void {
    const next = !this.showEndpointsRail();
    this.showEndpointsRail.set(next);
    if (next) this.peekEndpointsRail.set(false);
    this.clearEndpointsRailPeekTimer();
  }

  ngOnDestroy(): void {
    this.iisStatusRequestId++;
    this.newServiceIisRequestId++;
    this.editServiceIisRequestId++;
    this.clearServicesRailPeekTimer();
    this.clearEndpointsRailPeekTimer();
  }

  private usesIisManagedPort(protocol: ServiceProtocol, port: number): boolean {
    return (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443);
  }

  protected openNewServiceForm(): void {
    this.newProtocol.set('http');
    this.newPort.set(this.nextPort());
    this.showNewServiceForm.set(true);
  }

  protected setNewPort(value: number): void {
    this.newPort.set(Number.isFinite(value) ? value : 0);
  }

  protected setEditPort(value: number): void {
    this.editPort.set(Number.isFinite(value) ? value : 0);
  }

  protected closeNewServiceForm(): void {
    this.showNewServiceForm.set(false);
    this.newServiceIisRequestId++;
    this.newServiceIisStatus.set(null);
  }

  protected closeEditServiceForm(): void {
    this.showEditServiceForm.set(false);
    this.editServiceIisRequestId++;
    this.editServiceIisStatus.set(null);
  }

  private describeModalIisState(status: IisIntegrationStatus | null): { kind: 'info' | 'warning'; text: string } | null {
    if (!status?.iisInstalled) return null;
    if (status.requiresElevation && status.message) {
      return { kind: 'warning', text: status.message };
    }
    if (status.bindingActive && !status.canProxy && status.message) {
      return { kind: 'warning', text: status.message };
    }
    if (status.bindingActive && status.canProxy) {
      return {
        kind: 'info',
        text: `IIS site '${status.siteName ?? 'active site'}' is already using this binding. mokkapi will publish the matching endpoints through IIS while the mock is running.`,
      };
    }
    return {
      kind: 'info',
      text: 'IIS is installed on this machine, but it is not currently using this binding. mokkapi will listen directly unless IIS takes this port.',
    };
  }

  protected scheduleServicesRailPeek(): void {
    if (this.showServicesRail() || this.peekServicesRail()) return;
    this.clearServicesRailPeekTimer();
    this.servicesRailPeekTimer = window.setTimeout(() => {
      this.peekServicesRail.set(true);
      this.servicesRailPeekTimer = null;
    }, this.railPeekDelayMs);
  }

  protected cancelServicesRailPeek(): void {
    this.clearServicesRailPeekTimer();
    if (!this.showServicesRail()) {
      this.peekServicesRail.set(false);
    }
  }

  protected scheduleEndpointsRailPeek(): void {
    if (this.showEndpointsRail() || this.peekEndpointsRail()) return;
    this.clearEndpointsRailPeekTimer();
    this.endpointsRailPeekTimer = window.setTimeout(() => {
      this.peekEndpointsRail.set(true);
      this.endpointsRailPeekTimer = null;
    }, this.railPeekDelayMs);
  }

  protected cancelEndpointsRailPeek(): void {
    this.clearEndpointsRailPeekTimer();
    if (!this.showEndpointsRail()) {
      this.peekEndpointsRail.set(false);
    }
  }

  private clearServicesRailPeekTimer(): void {
    if (this.servicesRailPeekTimer === null) return;
    clearTimeout(this.servicesRailPeekTimer);
    this.servicesRailPeekTimer = null;
  }

  private clearEndpointsRailPeekTimer(): void {
    if (this.endpointsRailPeekTimer === null) return;
    clearTimeout(this.endpointsRailPeekTimer);
    this.endpointsRailPeekTimer = null;
  }

  protected statusDotClass(status: string): string {
    switch (status) {
      case 'running':  return 'dot-running';
      case 'error':    return 'dot-error';
      case 'starting': return 'dot-starting';
      default:         return 'dot-stopped';
    }
  }

  protected statusCodeClass(code: number): string {
    if (code < 300) return 'text-2xx bg-[rgb(var(--status-2xx)/0.12)]';
    if (code < 400) return 'text-3xx bg-[rgb(var(--status-3xx)/0.12)]';
    if (code < 500) return 'text-4xx bg-[rgb(var(--status-4xx)/0.12)]';
    return 'text-5xx bg-[rgb(var(--status-5xx)/0.12)]';
  }

  protected isPendingServiceAction(action: 'start' | 'stop'): boolean {
    return this.pendingServiceAction() === action && this.pendingServiceId() === this.store.selectedServiceId();
  }

  protected activeVariantStatus(ep: Endpoint): number | null {
    if (ep.variants.length === 0) return null;
    const forced = ep.forcedVariantId
      ? ep.variants.find((v) => v.id === ep.forcedVariantId)
      : null;
    return (forced ?? ep.variants[0]).status;
  }

  protected async addEndpoint(): Promise<void> {
    const serviceId = this.store.selectedServiceId();
    if (!serviceId) return;
    this.showEndpointsRail.set(true);
    const ep = await this.ipc.createEndpoint(serviceId, {
      method: 'GET',
      path: '/new-endpoint',
      description: '',
      variants: [],
      forcedVariantId: null,
    });
    await this.store.refreshSelectedService();
    this.selectedEndpointId.set(ep.id);
  }

  protected async onEndpointChanged(): Promise<void> {
    await this.store.refreshSelectedService();
  }

  protected async onEndpointDeleted(): Promise<void> {
    this.selectedEndpointId.set(null);
    await this.store.refreshSelectedService();
  }

  protected async createService(name: string, port: number): Promise<void> {
    if (!name.trim()) return;
    await this.store.createService({
      name: name.trim(),
      port,
      protocol: this.newProtocol(),
      tls: { mode: 'auto', certPath: null, keyPath: null, additionalHosts: [] },
      cors: { allowedOrigins: ['*'] },
      scenarios: ['Default'],
      activeScenario: 'Default',
      enabled: true,
    });
    this.closeNewServiceForm();
    this.showServicesRail.set(true);
    this.showEndpointsRail.set(true);
    const lastId = this.store.services().at(-1)?.id ?? null;
    this.store.selectService(lastId);
  }

  protected openEditServiceForm(): void {
    const service = this.store.selectedService();
    if (!service) return;
    this.editProtocol.set(service.protocol);
    this.editPort.set(service.port);
    this.showEditServiceForm.set(true);
  }

  protected editServiceFromList(serviceId: string): void {
    this.selectService(serviceId);
    this.openEditServiceForm();
  }

  protected async saveServiceEdits(name: string, port: number): Promise<void> {
    const serviceId = this.store.selectedServiceId();
    if (!serviceId || !name.trim()) return;

    await this.store.updateService(serviceId, {
      name: name.trim(),
      port,
      protocol: this.editProtocol(),
    });

    this.closeEditServiceForm();
  }

  protected async startService(): Promise<void> {
    const id = this.store.selectedServiceId();
    if (!id || this.pendingServiceId() === id) return;

    this.pendingServiceId.set(id);
    this.pendingServiceAction.set('start');
    try {
      await this.store.startService(id);
    } finally {
      if (this.pendingServiceId() === id) {
        this.pendingServiceId.set(null);
        this.pendingServiceAction.set(null);
      }
    }
  }

  protected async stopService(): Promise<void> {
    const id = this.store.selectedServiceId();
    if (!id || this.pendingServiceId() === id) return;

    this.pendingServiceId.set(id);
    this.pendingServiceAction.set('stop');
    try {
      await this.store.stopService(id);
    } finally {
      if (this.pendingServiceId() === id) {
        this.pendingServiceId.set(null);
        this.pendingServiceAction.set(null);
      }
    }
  }

  protected async openIisSiteConfig(): Promise<void> {
    const serviceId = this.store.selectedServiceId();
    if (!serviceId) return;

    this.iisConfigFeedback.set(null);
    try {
      await this.ipc.openIisSiteConfig(serviceId);
    } catch (error: unknown) {
      this.iisConfigFeedback.set(error instanceof Error ? error.message : String(error));
    }
  }

  // ── .NET export ────────────────────────────────────────────────────────────

  protected openExportForm(): void {
    const svc = this.store.selectedService();
    if (!svc) return;
    this.exportResult.set(null);
    this.exportError.set(null);
    this.exportOutputDir.set(null);
    this.exportCertSource.set('self-signed');
    this.customCertPath.set(null);
    this.customKeyPath.set(null);
    this.showExportForm.set(true);
    if (svc.protocol === 'https') {
      void this.caTrust.refresh();
      void this.ipc.detectDotnet().then((ok) => this.dotnetAvailable.set(ok));
    }
  }

  protected closeExportForm(): void {
    this.showExportForm.set(false);
  }

  protected toggleExportTarget(target: ExportTarget): void {
    this.exportTargets.update((prev) => ({ ...prev, [target]: !prev[target] }));
  }

  protected setExportCertSource(source: ExportCertSource): void {
    this.exportCertSource.set(source);
  }

  protected async chooseCustomCert(): Promise<void> {
    const path = await this.ipc.openFileDialog({
      title: 'Select the HTTPS certificate (PEM)',
      filters: [{ name: 'Certificate', extensions: ['pem', 'crt', 'cer'] }],
    });
    if (path) this.customCertPath.set(path);
  }

  protected async chooseCustomKey(): Promise<void> {
    const path = await this.ipc.openFileDialog({
      title: 'Select the private key (PEM)',
      filters: [{ name: 'Private key', extensions: ['pem', 'key'] }],
    });
    if (path) this.customKeyPath.set(path);
  }

  protected async chooseExportOutputDir(): Promise<void> {
    const dir = await this.ipc.openExportDialog();
    if (dir) this.exportOutputDir.set(dir);
  }

  protected async runExport(): Promise<void> {
    const serviceId = this.store.selectedServiceId();
    const svc = this.store.selectedService();
    if (!serviceId || !svc || !this.anyExportTarget() || this.exporting()) return;

    const targets = (Object.keys(this.exportTargets()) as ExportTarget[]).filter(
      (t) => this.exportTargets()[t],
    );

    let cert: ExportCertChoice | undefined;
    if (svc.protocol === 'https') {
      const source = this.exportCertSource();
      if (source === 'custom') {
        if (!this.customCertPath() || !this.customKeyPath()) {
          this.exportError.set('Select both a certificate and a private key for the custom option.');
          return;
        }
        cert = { source, certPath: this.customCertPath()!, keyPath: this.customKeyPath()! };
      } else {
        cert = { source };
      }
    }

    this.exporting.set(true);
    this.exportResult.set(null);
    this.exportError.set(null);
    try {
      const result = await this.ipc.exportService(serviceId, {
        targets,
        outputDir: this.exportOutputDir() ?? undefined,
        cert,
      });
      this.exportResult.set(result);
    } catch (error: unknown) {
      this.exportError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.exporting.set(false);
    }
  }

  protected async openExportFolder(): Promise<void> {
    const result = this.exportResult();
    if (result) await this.ipc.openExportFolder(result.outputPath);
  }
}
