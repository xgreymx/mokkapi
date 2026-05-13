/**
 * EndpointEditorComponent — inline editor for a single endpoint and its variants.
 * Shown in the right panel of ServicesPage when an endpoint is selected.
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
  OnChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../ipc/ipc.service';
import type { Endpoint, ResponseVariant, HttpMethod, BodyKind } from '@shared/models';

@Component({
  selector: 'app-endpoint-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="flex flex-col h-full overflow-hidden">

      <!-- ── Endpoint header ──────────────────────────────────────────── -->
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-[rgb(var(--border))] surface-el flex-shrink-0">
        <select [(ngModel)]="editMethod"
                class="rounded border border-[rgb(var(--border))] px-2 py-1 text-xs font-mono
                       bg-[rgb(var(--bg))] text-[rgb(var(--text))] focus:outline-none
                       focus:ring-1 focus:ring-[rgb(var(--border-focus))]">
          @for (m of methods; track m) {
            <option [value]="m">{{ m }}</option>
          }
        </select>
        <input [(ngModel)]="editPath" placeholder="/v1/resource/:id"
               class="flex-1 rounded border border-[rgb(var(--border))] px-2.5 py-1 text-sm
                      bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono focus:outline-none
                      focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
        <input [(ngModel)]="editDescription" placeholder="Description (optional)"
               class="w-48 rounded border border-[rgb(var(--border))] px-2.5 py-1 text-xs
                      bg-[rgb(var(--bg))] text-[rgb(var(--text))] focus:outline-none
                      focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
        <button (click)="saveEndpoint()"
                [disabled]="saving()"
                class="px-2.5 py-1 rounded text-xs font-medium
                       bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))]
                       hover:opacity-90 disabled:opacity-50 transition-opacity">
          Save
        </button>
        <button (click)="deleteEndpoint()"
                class="px-2 py-1 rounded text-xs text-[rgb(var(--status-5xx))]
                       hover:bg-[rgb(var(--status-5xx)/0.1)] transition-colors"
                title="Delete endpoint">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </div>

      <!-- ── Variant list + editor ─────────────────────────────────────── -->
      <div class="flex flex-1 overflow-hidden">

        <!-- Variant sidebar -->
        <div class="flex flex-col w-48 border-r border-[rgb(var(--border))] overflow-hidden flex-shrink-0">
          <div class="flex items-center justify-between px-3 py-2 border-b border-[rgb(var(--border))]">
            <span class="text-xs font-semibold text-[rgb(var(--text-muted))] uppercase tracking-wider">
              Variants
            </span>
            <button (click)="addVariant()"
                    class="text-[rgb(var(--primary))] hover:opacity-70 transition-opacity"
                    title="Add variant">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                   stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto scrollbar-thin py-1">
            @for (v of localVariants(); track v.id; let i = $index) {
              <button (click)="selectVariant(i)"
                      class="flex items-center gap-2 w-full px-3 py-2 text-left text-xs
                             hover:bg-[rgb(var(--bg))] transition-colors group"
                      [class.bg-background]="selectedVariantIdx() === i"
                      [class.text-text]="selectedVariantIdx() === i"
                      [class.text-muted-foreground]="selectedVariantIdx() !== i">
                <span class="text-xs font-mono px-1 py-0.5 rounded"
                      [class]="statusClass(v.status)">
                  {{ v.status }}
                </span>
                <span class="flex-1 truncate">{{ v.name }}</span>

                <!-- Forced indicator -->
                @if (endpoint.forcedVariantId === v.id) {
                  <span class="text-[rgb(var(--status-4xx))] text-xs" title="Forced">⚡</span>
                }
              </button>
            }
            @if (localVariants().length === 0) {
              <p class="px-3 py-4 text-xs text-[rgb(var(--text-xmuted))] text-center">No variants</p>
            }
          </div>
        </div>

        <!-- Variant detail editor -->
        <div class="flex-1 overflow-y-auto scrollbar-thin">
          @if (selectedVariant(); as v) {
            <div class="p-4 flex flex-col gap-4">

              <!-- Name + status + delay row -->
              <div class="flex items-center gap-3">
                <div class="flex-1">
                  <label class="field-label">Name</label>
                  <input [(ngModel)]="v.name" class="field-input w-full" placeholder="Success 200" />
                </div>
                <div class="w-20">
                  <label class="field-label">Status</label>
                  <input type="number" [(ngModel)]="v.status" class="field-input w-full text-right font-mono" />
                </div>
                <div class="w-24">
                  <label class="field-label">Delay (ms)</label>
                  <input type="number" [(ngModel)]="v.delayMs" min="0" class="field-input w-full text-right font-mono" />
                </div>
              </div>

              <!-- Scenarios -->
              <div>
                <label class="field-label">Active in scenarios</label>
                <input [(ngModel)]="variantScenariosInput"
                       placeholder="Default, Outage  (empty = all scenarios)"
                       class="field-input w-full text-sm"
                       (blur)="syncScenarios()" />
                <p class="text-xs text-[rgb(var(--text-xmuted))] mt-0.5">
                  Comma-separated. Leave empty to match all scenarios.
                </p>
              </div>

              <!-- Response headers KV table -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="field-label">Response Headers</label>
                  <button (click)="addHeader()"
                          class="text-xs text-[rgb(var(--primary))] hover:underline">
                    + Add
                  </button>
                </div>
                @for (entry of headerRows(); track $index; let i = $index) {
                  <div class="flex items-center gap-2 mb-1">
                    <input [(ngModel)]="entry.key" placeholder="Header"
                           class="field-input flex-1 font-mono text-xs" />
                    <input [(ngModel)]="entry.value" placeholder="Value"
                           class="field-input flex-1 text-xs" />
                    <button (click)="removeHeader(i)"
                            class="text-[rgb(var(--text-xmuted))] hover:text-[rgb(var(--status-5xx))]">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
                           stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                }
              </div>

              <!-- Body -->
              <div>
                <div class="flex items-center gap-3 mb-1.5">
                  <label class="field-label">Body</label>
                  <select [(ngModel)]="v.bodyKind"
                          class="ml-auto rounded border border-[rgb(var(--border))] px-2 py-0.5 text-xs
                                 bg-[rgb(var(--bg))] text-[rgb(var(--text))] focus:outline-none">
                    @for (k of bodyKinds; track k) {
                      <option [value]="k">{{ k }}</option>
                    }
                  </select>
                </div>
                <textarea [(ngModel)]="v.body" rows="12"
                          placeholder='{\n  "id": "{{faker.uuid}}",\n  "name": "{{faker.name}}"\n}'
                          class="w-full rounded border border-[rgb(var(--border))] px-3 py-2 text-xs
                                 bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono resize-y
                                 focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]
                                 placeholder:text-[rgb(var(--text-xmuted))]">
                </textarea>
                <p class="text-xs text-[rgb(var(--text-xmuted))] mt-1">
                  Handlebars templates supported:
                  <code class="font-mono">&#123;&#123;faker.uuid&#125;&#125;</code>
                  <code class="font-mono ml-1">&#123;&#123;request.body.field&#125;&#125;</code>
                  <code class="font-mono ml-1">&#123;&#123;request.params.id&#125;&#125;</code>
                </p>
              </div>

              <!-- Match rules summary -->
              <details>
                <summary class="text-xs font-medium text-[rgb(var(--text-muted))] cursor-pointer
                                hover:text-[rgb(var(--text))] mb-2 select-none">
                  Match rules (advanced)
                </summary>
                <div class="rounded border border-[rgb(var(--border))] p-3 text-xs space-y-3">

                  <!-- Header rules -->
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-[rgb(var(--text-muted))] font-medium">Header match</span>
                      <button (click)="addMatchHeader(v)"
                              class="text-[rgb(var(--primary))] hover:underline">+ Add</button>
                    </div>
                    @for (entry of matchHeaderRows(v); track $index; let i = $index) {
                      <div class="flex items-center gap-2 mb-1">
                        <input [(ngModel)]="entry.key" placeholder="Header name"
                               class="field-input flex-1 font-mono" />
                        <input [(ngModel)]="entry.value"
                               placeholder="present / !present / exact-value"
                               class="field-input flex-1" />
                        <button (click)="removeMatchHeader(v, i)"
                                class="text-[rgb(var(--text-xmuted))] hover:text-[rgb(var(--status-5xx))]">✕</button>
                      </div>
                    }
                  </div>

                  <!-- Query rules -->
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-[rgb(var(--text-muted))] font-medium">Query match</span>
                      <button (click)="addMatchQuery(v)"
                              class="text-[rgb(var(--primary))] hover:underline">+ Add</button>
                    </div>
                    @for (entry of matchQueryRows(v); track $index; let i = $index) {
                      <div class="flex items-center gap-2 mb-1">
                        <input [(ngModel)]="entry.key" placeholder="Param name"
                               class="field-input flex-1 font-mono" />
                        <input [(ngModel)]="entry.value" placeholder="exact-value or present"
                               class="field-input flex-1" />
                        <button (click)="removeMatchQuery(v, i)"
                                class="text-[rgb(var(--text-xmuted))] hover:text-[rgb(var(--status-5xx))]">✕</button>
                      </div>
                    }
                  </div>
                </div>
              </details>

              <!-- Force / Unforce button -->
              <div class="flex items-center gap-3 pt-2 border-t border-[rgb(var(--border))]">
                @if (endpoint.forcedVariantId === v.id) {
                  <button (click)="forceVariant(null)"
                          class="text-xs text-[rgb(var(--status-4xx))] hover:underline">
                    ⚡ Remove forced variant
                  </button>
                } @else {
                  <button (click)="forceVariant(v.id)"
                          class="text-xs text-[rgb(var(--text-muted))] hover:text-[rgb(var(--status-4xx))] hover:underline">
                    ⚡ Force this variant
                  </button>
                }
                <div class="flex-1"></div>
                <button (click)="saveVariant()"
                        [disabled]="saving()"
                        class="px-3 py-1.5 rounded text-xs font-medium
                               bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))]
                               hover:opacity-90 disabled:opacity-50 transition-opacity">
                  Save variant
                </button>
                <button (click)="deleteVariant()"
                        class="px-2.5 py-1.5 rounded text-xs border border-[rgb(var(--border))]
                               text-[rgb(var(--status-5xx))] hover:bg-[rgb(var(--status-5xx)/0.1)]
                               transition-colors">
                  Delete
                </button>
              </div>
            </div>
          } @else {
            <div class="flex items-center justify-center h-full text-sm text-[rgb(var(--text-muted))]">
              Select or add a variant
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .field-label {
      @apply block text-xs font-medium text-[rgb(var(--text-muted))] mb-1;
    }
    .field-input {
      @apply rounded border border-[rgb(var(--border))] px-2.5 py-1 text-sm
             bg-[rgb(var(--bg))] text-[rgb(var(--text))]
             focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))];
    }
  `],
})
export class EndpointEditorComponent implements OnChanges {
  @Input({ required: true }) serviceId!: string;
  @Input({ required: true }) endpoint!: Endpoint;
  @Output() endpointChanged = new EventEmitter<void>();
  @Output() endpointDeleted = new EventEmitter<void>();

  private readonly ipc = inject(IpcService);

  protected readonly saving = signal(false);
  protected readonly selectedVariantIdx = signal(0);
  protected readonly localVariants = signal<ResponseVariant[]>([]);
  protected variantScenariosInput = '';
  protected headerRows = signal<{ key: string; value: string }[]>([]);

  protected readonly methods: HttpMethod[] = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
  protected readonly bodyKinds: BodyKind[] = ['json','xml','text','binary-base64'];

  protected editMethod: HttpMethod = 'GET';
  protected editPath = '';
  protected editDescription = '';

  protected readonly selectedVariant = computed(() => {
    const vs = this.localVariants();
    const i = this.selectedVariantIdx();
    return i < vs.length ? vs[i] : null;
  });

  ngOnChanges(): void {
    this.editMethod = this.endpoint.method;
    this.editPath = this.endpoint.path;
    this.editDescription = this.endpoint.description;
    this.localVariants.set(this.endpoint.variants.map((v) => ({ ...v, match: { ...v.match } })));
    this.selectedVariantIdx.set(0);
    this.syncHeaderRows();
    this.syncScenariosInput();
  }

  private syncHeaderRows(): void {
    const v = this.selectedVariant();
    if (!v) return;
    this.headerRows.set(
      Object.entries(v.headers ?? {}).map(([key, value]) => ({ key, value })),
    );
  }

  private syncScenariosInput(): void {
    const v = this.selectedVariant();
    this.variantScenariosInput = v ? v.scenarios.join(', ') : '';
  }

  protected selectVariant(i: number): void {
    this.selectedVariantIdx.set(i);
    this.syncHeaderRows();
    this.syncScenariosInput();
  }

  protected syncScenarios(): void {
    const v = this.selectedVariant();
    if (!v) return;
    v.scenarios = this.variantScenariosInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // ── Header KV rows ──────────────────────────────────────────────────────────

  protected addHeader(): void {
    this.headerRows.update((r) => [...r, { key: '', value: '' }]);
  }

  protected removeHeader(i: number): void {
    this.headerRows.update((r) => r.filter((_, idx) => idx !== i));
  }

  private buildHeaders(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { key, value } of this.headerRows()) {
      if (key.trim()) out[key.trim()] = value;
    }
    return out;
  }

  // ── Match rule helpers ──────────────────────────────────────────────────────

  protected matchHeaderRows(v: ResponseVariant): { key: string; value: string }[] {
    return Object.entries(v.match.headers ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : value,
    }));
  }

  protected matchQueryRows(v: ResponseVariant): { key: string; value: string }[] {
    return Object.entries(v.match.query ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : value,
    }));
  }

  protected addMatchHeader(v: ResponseVariant): void {
    v.match = { ...v.match, headers: { ...v.match.headers, '': '' } };
  }

  protected removeMatchHeader(v: ResponseVariant, i: number): void {
    const entries = Object.entries(v.match.headers ?? {});
    entries.splice(i, 1);
    v.match = { ...v.match, headers: Object.fromEntries(entries) };
  }

  protected addMatchQuery(v: ResponseVariant): void {
    v.match = { ...v.match, query: { ...v.match.query, '': '' } };
  }

  protected removeMatchQuery(v: ResponseVariant, i: number): void {
    const entries = Object.entries(v.match.query ?? {});
    entries.splice(i, 1);
    v.match = { ...v.match, query: Object.fromEntries(entries) };
  }

  // ── CRUD operations ─────────────────────────────────────────────────────────

  protected async saveEndpoint(): Promise<void> {
    this.saving.set(true);
    try {
      await this.ipc.updateEndpoint(this.serviceId, this.endpoint.id, {
        method: this.editMethod,
        path: this.editPath,
        description: this.editDescription,
        variants: this.localVariants(),
      });
      this.endpointChanged.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteEndpoint(): Promise<void> {
    await this.ipc.deleteEndpoint(this.serviceId, this.endpoint.id);
    this.endpointDeleted.emit();
  }

  protected async addVariant(): Promise<void> {
    const newV = await this.ipc.createVariant(this.serviceId, this.endpoint.id, {
      name: 'New variant',
      scenarios: [],
      match: { headers: {}, query: {}, bodyJsonPath: [] },
      delayMs: 0,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{}',
      bodyKind: 'json',
    });
    this.localVariants.update((vs) => [...vs, newV]);
    this.selectedVariantIdx.set(this.localVariants().length - 1);
    this.syncHeaderRows();
    this.syncScenariosInput();
  }

  protected async saveVariant(): Promise<void> {
    const v = this.selectedVariant();
    if (!v) return;
    this.saving.set(true);
    try {
      this.syncScenarios();
      await this.ipc.updateVariant(this.serviceId, this.endpoint.id, v.id, {
        ...v,
        headers: this.buildHeaders(),
      });
      this.endpointChanged.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteVariant(): Promise<void> {
    const v = this.selectedVariant();
    if (!v) return;
    await this.ipc.deleteVariant(this.serviceId, this.endpoint.id, v.id);
    this.localVariants.update((vs) => vs.filter((x) => x.id !== v.id));
    this.selectedVariantIdx.set(0);
  }

  protected async forceVariant(variantId: string | null): Promise<void> {
    await this.ipc.forceVariant(this.serviceId, this.endpoint.id, variantId);
    this.endpointChanged.emit();
  }

  protected statusClass(code: number): string {
    if (code < 300) return 'text-[rgb(var(--status-2xx))] bg-[rgb(var(--status-2xx)/0.1)]';
    if (code < 400) return 'text-[rgb(var(--status-3xx))] bg-[rgb(var(--status-3xx)/0.1)]';
    if (code < 500) return 'text-[rgb(var(--status-4xx))] bg-[rgb(var(--status-4xx)/0.1)]';
    return 'text-[rgb(var(--status-5xx))] bg-[rgb(var(--status-5xx)/0.1)]';
  }
}
