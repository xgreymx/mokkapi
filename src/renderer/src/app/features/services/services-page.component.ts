import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { CertificateTrustService } from '../../data/certificate-trust.service';
import { WorkspaceStore } from '../../data/workspace.store';
import { IpcService } from '../../ipc/ipc.service';
import { EndpointEditorComponent } from './endpoint-editor.component';
import type { Endpoint, ServiceProtocol } from '@shared/models';

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
  protected readonly servicesRailVisible = computed(() => this.showServicesRail() || this.peekServicesRail());
  protected readonly endpointsRailVisible = computed(() => this.showEndpointsRail() || this.peekEndpointsRail());

  private servicesRailPeekTimer: ReturnType<typeof setTimeout> | null = null;
  private endpointsRailPeekTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly railPeekDelayMs = 260;

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
    this.clearServicesRailPeekTimer();
    this.clearEndpointsRailPeekTimer();
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
    this.newProtocol.set('http');
    this.showNewServiceForm.set(false);
    this.showServicesRail.set(true);
    this.showEndpointsRail.set(true);
    const lastId = this.store.services().at(-1)?.id ?? null;
    this.store.selectService(lastId);
  }

  protected openEditServiceForm(): void {
    const service = this.store.selectedService();
    if (!service) return;
    this.editProtocol.set(service.protocol);
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

    this.showEditServiceForm.set(false);
  }

  protected async startService(): Promise<void> {
    const id = this.store.selectedServiceId();
    if (id) await this.store.startService(id);
  }

  protected async stopService(): Promise<void> {
    const id = this.store.selectedServiceId();
    if (id) await this.store.stopService(id);
  }
}
