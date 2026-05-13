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
  template: `
    <div class="flex h-full overflow-hidden">

      <!-- ── Services sidebar ──────────────────────────────────────────── -->
      <aside class="flex flex-col w-56 border-r border-[rgb(var(--border))] surface-el overflow-hidden flex-shrink-0">
        <div class="flex items-center justify-between px-3 py-2 border-b border-[rgb(var(--border))]">
          <span class="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
            Services
          </span>
          <button (click)="showNewServiceForm.set(true)"
                  class="flex items-center justify-center w-6 h-6 rounded hover:bg-[rgb(var(--bg))]
                         text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] transition-colors"
                  title="New service">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto scrollbar-thin py-1">
          @if (store.services().length === 0) {
            <div class="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none"
                   stroke="currentColor" stroke-width="1.25"
                   class="text-[rgb(var(--text-muted))]"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              <p class="text-xs text-[rgb(var(--text-muted))]">No services yet</p>
              <button (click)="showNewServiceForm.set(true)"
                      class="text-xs text-[rgb(var(--primary))] hover:underline">
                Create your first service
              </button>
            </div>
          }

          @for (svc of store.servicesWithStatus(); track svc.id) {
            <button
              (click)="selectService(svc.id)"
              class="flex items-center gap-2 w-full px-3 py-2 text-left text-sm
                     hover:bg-[rgb(var(--bg))] transition-colors"
              [class.bg-background]="store.selectedServiceId() === svc.id"
            >
              <span [class]="statusDotClass(svc.status.status) + ' flex-shrink-0'"></span>
              <span class="flex-1 truncate font-medium text-[rgb(var(--text))]">{{ svc.name }}</span>
              <span class="font-mono text-xs text-[rgb(var(--text-muted))] flex-shrink-0">
                :{{ svc.port }}
              </span>
            </button>
          }
        </div>
      </aside>

      <!-- ── Endpoint list ─────────────────────────────────────────────── -->
      <div class="flex flex-col w-72 border-r border-[rgb(var(--border))] overflow-hidden flex-shrink-0">

        @if (!store.selectedService()) {
          <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none"
                 stroke="currentColor" stroke-width="1"
                 class="text-[rgb(var(--border))]"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <p class="text-xs text-[rgb(var(--text-muted))]">
              Select a service to view its endpoints
            </p>
          </div>
        } @else {
          <!-- Service header -->
          <div class="flex items-center justify-between px-3 py-2 border-b border-[rgb(var(--border))] surface-el flex-shrink-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <span [class]="statusDotClass(store.selectedService()!.status.status)"></span>
              <span class="text-xs font-mono text-[rgb(var(--text-muted))] truncate">
                :{{ store.selectedService()!.port }}
              </span>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0">
              @if (store.selectedService()!.status.status !== 'running') {
                <button (click)="startService()"
                        class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                               bg-[rgb(var(--status-2xx)/0.1)] text-[rgb(var(--status-2xx))]
                               hover:bg-[rgb(var(--status-2xx)/0.2)] transition-colors">
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                    <path d="M5 3l14 9L5 21V3z"/>
                  </svg>
                  Start
                </button>
              } @else {
                <button (click)="stopService()"
                        class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                               bg-[rgb(var(--status-5xx)/0.1)] text-[rgb(var(--status-5xx))]
                               hover:bg-[rgb(var(--status-5xx)/0.2)] transition-colors">
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12"/>
                  </svg>
                  Stop
                </button>
              }
              <button (click)="addEndpoint()"
                      title="Add endpoint"
                      class="flex items-center justify-center w-6 h-6 rounded
                             text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]
                             hover:bg-[rgb(var(--bg))] transition-colors">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Endpoint rows -->
          <div class="flex-1 overflow-y-auto scrollbar-thin">
            @if (store.selectedService()!.endpoints.length === 0) {
              <div class="flex flex-col items-center justify-center h-40 gap-2 px-4">
                <p class="text-xs text-[rgb(var(--text-muted))] text-center">
                  No endpoints yet.<br>Add one or import an OpenAPI spec.
                </p>
              </div>
            }

            @for (ep of store.selectedService()!.endpoints; track ep.id) {
              <button
                (click)="selectedEndpointId.set(ep.id)"
                class="flex items-center gap-2.5 w-full px-3 py-2 text-left
                       border-b border-[rgb(var(--border)/0.4)]
                       hover:bg-[rgb(var(--bg-elevated))] transition-colors"
                [class.bg-background]="selectedEndpointId() === ep.id"
              >
                <span [class]="'badge-method badge-' + ep.method.toLowerCase() + ' flex-shrink-0'">
                  {{ ep.method }}
                </span>
                <span class="flex-1 text-xs font-mono text-[rgb(var(--text))] truncate">
                  {{ ep.path }}
                </span>
                @if (activeVariantStatus(ep); as code) {
                  <span class="text-xs font-mono px-1 py-0.5 rounded flex-shrink-0"
                        [class]="statusCodeClass(code)">
                    {{ code }}
                  </span>
                }
              </button>
            }
          </div>
        }
      </div>

      <!-- ── Endpoint editor ───────────────────────────────────────────── -->
      <div class="flex-1 overflow-hidden">
        @if (selectedEndpoint() && store.selectedService()) {
          <app-endpoint-editor
            [serviceId]="store.selectedServiceId()!"
            [endpoint]="selectedEndpoint()!"
            (endpointChanged)="onEndpointChanged()"
            (endpointDeleted)="onEndpointDeleted()"
          />
        } @else {
          <div class="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none"
                 stroke="currentColor" stroke-width="1"
                 class="text-[rgb(var(--border))]"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <p class="text-xs text-[rgb(var(--text-muted))]">
              Select an endpoint to edit its variants
            </p>
          </div>
        }
      </div>

      <!-- ── New service modal ─────────────────────────────────────────── -->
      @if (showNewServiceForm()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center"
             style="background: rgba(0,0,0,0.6)"
             (click)="showNewServiceForm.set(false)">
          <div class="surface-el border border-[rgb(var(--border))] rounded-lg shadow-xl p-6 w-96"
               (click)="$event.stopPropagation()">
            <h2 class="font-semibold text-base mb-4">New Service</h2>
            <div class="flex flex-col gap-3">
              <div>
                <label class="text-xs font-medium text-[rgb(var(--text-muted))] block mb-1">Name</label>
                <input #nameInput
                       placeholder="Payments API"
                       class="w-full rounded border border-[rgb(var(--border))] px-3 py-1.5 text-sm
                              bg-[rgb(var(--bg))] text-[rgb(var(--text))]
                              focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
              </div>
              <div>
                <label class="text-xs font-medium text-[rgb(var(--text-muted))] block mb-1">Port</label>
                <input #portInput type="number" [value]="nextPort()"
                       class="w-full rounded border border-[rgb(var(--border))] px-3 py-1.5 text-sm
                              bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono
                              focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
              <button (click)="showNewServiceForm.set(false)"
                      class="px-3 py-1.5 text-sm rounded border border-[rgb(var(--border))]
                             text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] transition-colors">
                Cancel
              </button>
              <button (click)="createService(nameInput.value, +portInput.value)"
                      class="px-3 py-1.5 text-sm rounded
                             bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))]
                             hover:opacity-90 transition-opacity font-medium">
                Create
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ServicesPageComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly ipc = inject(IpcService);

  protected readonly showNewServiceForm = signal(false);
  protected readonly selectedEndpointId = signal<string | null>(null);

  // Derives fresh endpoint from store — stays in sync after saves/refreshes
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
    if (code < 300) return 'text-[rgb(var(--status-2xx))] bg-[rgb(var(--status-2xx)/0.1)]';
    if (code < 400) return 'text-[rgb(var(--status-3xx))] bg-[rgb(var(--status-3xx)/0.1)]';
    if (code < 500) return 'text-[rgb(var(--status-4xx))] bg-[rgb(var(--status-4xx)/0.1)]';
    return 'text-[rgb(var(--status-5xx))] bg-[rgb(var(--status-5xx)/0.1)]';
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
    // selectedEndpoint computed auto-updates from refreshed store
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
