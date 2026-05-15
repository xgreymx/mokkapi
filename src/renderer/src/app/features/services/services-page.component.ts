import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { WorkspaceStore } from '../../data/workspace.store';
import { IpcService } from '../../ipc/ipc.service';
import { EndpointEditorComponent } from './endpoint-editor.component';
import type { Endpoint } from '@shared/models';

@Component({
  selector: 'app-services-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EndpointEditorComponent],
  templateUrl: './services-page.component.html',
})
export class ServicesPageComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly ipc = inject(IpcService);

  protected readonly showNewServiceForm = signal(false);
  protected readonly selectedEndpointId = signal<string | null>(null);

  protected readonly selectedEndpoint = computed(() => {
    const id = this.selectedEndpointId();
    if (!id) return null;
    return this.store.selectedService()?.endpoints.find((e) => e.id === id) ?? null;
  });

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
      protocol: 'http',
      tls: { mode: 'auto', certPath: null, keyPath: null, additionalHosts: [] },
      cors: { allowedOrigins: ['*'] },
      scenarios: ['Default'],
      activeScenario: 'Default',
      enabled: true,
    });
    this.showNewServiceForm.set(false);
    const lastId = this.store.services().at(-1)?.id ?? null;
    this.store.selectService(lastId);
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
