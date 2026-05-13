/**
 * EndpointEditorComponent — inline editor for a single endpoint and its variants.
 * Shown in the right panel of ServicesPage when an endpoint is selected.
 */

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../ipc/ipc.service';
import type { BodyKind, Endpoint, HttpMethod, ResponseVariant } from '@shared/models';

interface BodyKindOption {
  value: BodyKind;
  label: string;
  description: string;
}

@Component({
  selector: 'app-endpoint-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="flex h-full flex-col overflow-hidden">
      <div class="flex items-center gap-2 border-b border-[rgb(var(--border))] px-4 py-2.5 surface-el shrink-0">
        <select
          [(ngModel)]="editMethod"
          class="rounded border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2 py-1 text-xs font-mono text-[rgb(var(--text))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]"
        >
          @for (m of methods; track m) {
            <option [value]="m">{{ m }}</option>
          }
        </select>

        <input
          [(ngModel)]="editPath"
          placeholder="/v1/resource/:id"
          class="flex-1 rounded border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2.5 py-1 text-sm font-mono text-[rgb(var(--text))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]"
        />

        <input
          [(ngModel)]="editDescription"
          placeholder="Description (optional)"
          class="w-48 rounded border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2.5 py-1 text-xs text-[rgb(var(--text))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]"
        />

        <button
          type="button"
          (click)="saveEndpoint()"
          [disabled]="saving()"
          class="rounded bg-[rgb(var(--primary))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--primary-fg))] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>

        <button
          type="button"
          (click)="deleteEndpoint()"
          class="rounded px-2 py-1 text-[rgb(var(--status-5xx))] transition-colors hover:bg-[rgb(var(--status-5xx)/0.1)]"
          title="Delete endpoint"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </div>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <div class="flex w-48 shrink-0 flex-col overflow-hidden border-r border-[rgb(var(--border))]">
          <div class="flex items-center justify-between border-b border-[rgb(var(--border))] px-3 py-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
              Variants
            </span>
            <button
              type="button"
              (click)="addVariant()"
              class="text-[rgb(var(--primary))] transition-opacity hover:opacity-70"
              title="Add variant"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto py-1 scrollbar-thin">
            @for (v of localVariants(); track v.id; let i = $index) {
              <button
                type="button"
                (click)="selectVariant(i)"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[rgb(var(--bg))]"
                [class.bg-background]="selectedVariantIdx() === i"
                [class.text-text]="selectedVariantIdx() === i"
                [class.text-muted-foreground]="selectedVariantIdx() !== i"
              >
                <span class="rounded px-1 py-0.5 text-xs font-mono" [class]="statusClass(v.status)">
                  {{ v.status }}
                </span>
                <span class="flex-1 truncate">{{ v.name }}</span>
                @if (endpoint.forcedVariantId === v.id) {
                  <span class="text-xs text-[rgb(var(--status-4xx))]" title="Forced">⚡</span>
                }
              </button>
            }

            @if (localVariants().length === 0) {
              <p class="px-3 py-4 text-center text-xs text-[rgb(var(--text-xmuted))]">No variants</p>
            }
          </div>
        </div>

        <div class="flex-1 overflow-y-auto scrollbar-thin">
          @if (selectedVariant(); as v) {
            <div class="flex flex-col gap-4 p-4">
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

              <div>
                <label class="field-label">Active in scenarios</label>
                <input
                  [(ngModel)]="variantScenariosInput"
                  placeholder="Default, Outage  (empty = all scenarios)"
                  class="field-input w-full text-sm"
                  (blur)="syncScenarios()"
                />
                <p class="mt-0.5 text-xs text-[rgb(var(--text-xmuted))]">
                  Comma-separated. Leave empty to match all scenarios.
                </p>
              </div>

              <div class="overflow-hidden rounded-xl border border-[rgb(var(--border))] surface-el">
                <div class="flex items-center justify-between gap-3 border-b border-[rgb(var(--border))] px-3 py-2.5">
                  <div>
                    <label class="field-label mb-0">Response Headers</label>
                    <p class="mt-0.5 text-[11px] text-[rgb(var(--text-xmuted))]">
                      These are returned exactly as configured below.
                    </p>
                  </div>

                  <button
                    type="button"
                    (click)="addHeader()"
                    class="rounded-full border border-[rgb(var(--border))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--text-muted))] transition-colors hover:border-[rgb(var(--primary))] hover:text-[rgb(var(--text))]"
                  >
                    + Add header
                  </button>
                </div>

                <div class="space-y-2 p-3">
                  @if (headerRows().length === 0) {
                    <div class="rounded-lg border border-dashed border-[rgb(var(--border))] px-3 py-3 text-xs text-[rgb(var(--text-xmuted))]">
                      No custom headers yet. Add one to control <span class="font-mono">content-type</span>, cache behavior, tracing, or any custom response metadata.
                    </div>
                  }

                  @for (entry of headerRows(); track $index; let i = $index) {
                    <div class="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)_auto] gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-3 py-3">
                      <label class="block min-w-0">
                        <span class="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--text-xmuted))]">
                          Header
                        </span>
                        <input [(ngModel)]="entry.key" placeholder="content-type" class="field-input w-full font-mono text-xs" />
                      </label>

                      <label class="block min-w-0">
                        <span class="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--text-xmuted))]">
                          Value
                        </span>
                        <input [(ngModel)]="entry.value" placeholder="application/json; charset=utf-8" class="field-input w-full font-mono text-xs" />
                      </label>

                      <button
                        type="button"
                        (click)="removeHeader(i)"
                        class="mb-0.5 flex h-9 w-9 self-end items-center justify-center rounded-lg border border-transparent text-[rgb(var(--text-xmuted))] transition-colors hover:border-[rgb(var(--status-5xx)/0.25)] hover:bg-[rgb(var(--status-5xx)/0.08)] hover:text-[rgb(var(--status-5xx))]"
                        title="Remove header"
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              </div>

              <div>
                <div class="mb-1.5 flex flex-wrap items-center gap-3">
                  <label class="field-label mb-0">Body</label>
                  <div class="ml-auto flex flex-wrap items-center gap-1.5">
                    @for (kind of bodyKindOptions; track kind.value) {
                      <button
                        type="button"
                        (click)="setBodyKind(kind.value)"
                        [class]="bodyKindChipClass(normalizedBodyKind(v.bodyKind) === kind.value)"
                        [title]="kind.description"
                      >
                        {{ kind.label }}
                      </button>
                    }
                  </div>
                </div>

                <textarea
                  [(ngModel)]="v.body"
                  rows="12"
                  placeholder='{
  "id": "{{faker.uuid}}",
  "name": "{{faker.name}}"
}'
                  class="body-textarea"
                ></textarea>

                <p class="mt-1 text-xs text-[rgb(var(--text-xmuted))]">
                  <span class="mr-2 font-medium text-[rgb(var(--text-muted))]">
                    {{ bodyKindDescription(normalizedBodyKind(v.bodyKind)) }}
                  </span>
                  Handlebars templates supported:
                  <code class="font-mono">&#123;&#123;faker.uuid&#125;&#125;</code>
                  <code class="ml-1 font-mono">&#123;&#123;request.body.field&#125;&#125;</code>
                  <code class="ml-1 font-mono">&#123;&#123;request.params.id&#125;&#125;</code>
                </p>
              </div>

              <details>
                <summary class="mb-2 cursor-pointer select-none text-xs font-medium text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]">
                  Match rules (advanced)
                </summary>

                <div class="space-y-3 rounded border border-[rgb(var(--border))] p-3 text-xs">
                  <div>
                    <div class="mb-1 flex items-center justify-between">
                      <span class="font-medium text-[rgb(var(--text-muted))]">Header match</span>
                      <button type="button" (click)="addMatchHeader(v)" class="text-[rgb(var(--primary))] hover:underline">+ Add</button>
                    </div>

                    @for (entry of matchHeaderRows(v); track $index; let i = $index) {
                      <div class="mb-1 flex items-center gap-2">
                        <input [(ngModel)]="entry.key" placeholder="Header name" class="field-input flex-1 font-mono" />
                        <input [(ngModel)]="entry.value" placeholder="present / !present / exact-value" class="field-input flex-1" />
                        <button type="button" (click)="removeMatchHeader(v, i)" class="text-[rgb(var(--text-xmuted))] hover:text-[rgb(var(--status-5xx))]">✕</button>
                      </div>
                    }
                  </div>

                  <div>
                    <div class="mb-1 flex items-center justify-between">
                      <span class="font-medium text-[rgb(var(--text-muted))]">Query match</span>
                      <button type="button" (click)="addMatchQuery(v)" class="text-[rgb(var(--primary))] hover:underline">+ Add</button>
                    </div>

                    @for (entry of matchQueryRows(v); track $index; let i = $index) {
                      <div class="mb-1 flex items-center gap-2">
                        <input [(ngModel)]="entry.key" placeholder="Param name" class="field-input flex-1 font-mono" />
                        <input [(ngModel)]="entry.value" placeholder="exact-value or present" class="field-input flex-1" />
                        <button type="button" (click)="removeMatchQuery(v, i)" class="text-[rgb(var(--text-xmuted))] hover:text-[rgb(var(--status-5xx))]">✕</button>
                      </div>
                    }
                  </div>
                </div>
              </details>

              <div class="flex items-center gap-3 border-t border-[rgb(var(--border))] pt-2">
                @if (endpoint.forcedVariantId === v.id) {
                  <button type="button" (click)="forceVariant(null)" class="text-xs text-[rgb(var(--status-4xx))] hover:underline">
                    ⚡ Remove forced variant
                  </button>
                } @else {
                  <button type="button" (click)="forceVariant(v.id)" class="text-xs text-[rgb(var(--text-muted))] hover:text-[rgb(var(--status-4xx))] hover:underline">
                    ⚡ Force this variant
                  </button>
                }

                <div class="flex-1"></div>

                <button
                  type="button"
                  (click)="saveVariant()"
                  [disabled]="saving()"
                  class="rounded bg-[rgb(var(--primary))] px-3 py-1.5 text-xs font-medium text-[rgb(var(--primary-fg))] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Save variant
                </button>

                <button
                  type="button"
                  (click)="deleteVariant()"
                  class="rounded border border-[rgb(var(--border))] px-2.5 py-1.5 text-xs text-[rgb(var(--status-5xx))] transition-colors hover:bg-[rgb(var(--status-5xx)/0.1)]"
                >
                  Delete
                </button>
              </div>
            </div>
          } @else {
            <div class="flex h-full items-center justify-center text-sm text-[rgb(var(--text-muted))]">
              Select or add a variant
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .field-label {
      @apply block mb-1 text-xs font-medium text-[rgb(var(--text-muted))];
    }

    .field-input {
      @apply rounded border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2.5 py-1 text-sm text-[rgb(var(--text))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))];
    }

    .body-textarea {
      @apply w-full resize-y rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-3 py-2 text-xs leading-5 text-[rgb(var(--text))] placeholder:text-[rgb(var(--text-xmuted))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))];
      font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
      tab-size: 2;
    }

    .kind-chip {
      @apply rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors;
    }

    .kind-chip-active {
      @apply border-[rgb(var(--primary))] bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))];
    }

    .kind-chip-idle {
      @apply border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-[rgb(var(--text-muted))] hover:border-[rgb(var(--primary))] hover:text-[rgb(var(--text))];
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
  protected readonly headerRows = signal<{ key: string; value: string }[]>([]);
  protected variantScenariosInput = '';

  protected readonly methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  protected readonly bodyKindOptions: BodyKindOption[] = [
    { value: 'json', label: 'JSON', description: 'Formats structured payloads as application/json.' },
    { value: 'xml', label: 'XML', description: 'Returns XML content.' },
    { value: 'text', label: 'Text', description: 'Returns plain text.' },
    { value: 'binary-base64', label: 'Binary', description: 'Marks the payload as base64-encoded binary data.' },
  ];

  protected editMethod: HttpMethod = 'GET';
  protected editPath = '';
  protected editDescription = '';

  protected readonly selectedVariant = computed(() => {
    const variants = this.localVariants();
    const index = this.selectedVariantIdx();
    return index >= 0 && index < variants.length ? variants[index] : null;
  });

  ngOnChanges(): void {
    this.editMethod = this.endpoint.method;
    this.editPath = this.endpoint.path;
    this.editDescription = this.endpoint.description;
    this.localVariants.set(this.endpoint.variants.map((variant) => this.cloneVariant(variant)));
    this.selectedVariantIdx.set(0);
    this.syncSelectedVariantDraftFromState();
  }

  protected selectVariant(index: number): void {
    this.selectedVariantIdx.set(index);
    this.syncSelectedVariantDraftFromState();
  }

  protected syncScenarios(): void {
    const variant = this.selectedVariant();
    if (!variant) return;

    variant.scenarios = this.variantScenariosInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  protected addHeader(): void {
    this.headerRows.update((rows) => [...rows, { key: '', value: '' }]);
  }

  protected removeHeader(index: number): void {
    this.headerRows.update((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }

  protected matchHeaderRows(variant: ResponseVariant): { key: string; value: string }[] {
    return Object.entries(variant.match.headers ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : value,
    }));
  }

  protected matchQueryRows(variant: ResponseVariant): { key: string; value: string }[] {
    return Object.entries(variant.match.query ?? {}).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : value,
    }));
  }

  protected addMatchHeader(variant: ResponseVariant): void {
    variant.match = { ...variant.match, headers: { ...variant.match.headers, '': '' } };
  }

  protected removeMatchHeader(variant: ResponseVariant, index: number): void {
    const entries = Object.entries(variant.match.headers ?? {});
    entries.splice(index, 1);
    variant.match = { ...variant.match, headers: Object.fromEntries(entries) };
  }

  protected addMatchQuery(variant: ResponseVariant): void {
    variant.match = { ...variant.match, query: { ...variant.match.query, '': '' } };
  }

  protected removeMatchQuery(variant: ResponseVariant, index: number): void {
    const entries = Object.entries(variant.match.query ?? {});
    entries.splice(index, 1);
    variant.match = { ...variant.match, query: Object.fromEntries(entries) };
  }

  protected async saveEndpoint(): Promise<void> {
    this.saving.set(true);
    try {
      this.syncScenarios();
      this.syncSelectedVariantDraftToState();
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
    const variant = await this.ipc.createVariant(this.serviceId, this.endpoint.id, {
      name: 'New variant',
      scenarios: [],
      match: { headers: {}, query: {}, bodyJsonPath: [] },
      delayMs: 0,
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{}',
      bodyKind: 'json',
    });

    this.localVariants.update((variants) => [...variants, this.cloneVariant(variant)]);
    this.selectedVariantIdx.set(this.localVariants().length - 1);
    this.syncSelectedVariantDraftFromState();
  }

  protected async saveVariant(): Promise<void> {
    const variant = this.selectedVariant();
    if (!variant) return;

    this.saving.set(true);
    try {
      this.syncScenarios();
      const updatedVariant = this.syncSelectedVariantDraftToState();
      if (!updatedVariant) return;

      await this.ipc.updateVariant(this.serviceId, this.endpoint.id, variant.id, updatedVariant);
      this.endpointChanged.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteVariant(): Promise<void> {
    const variant = this.selectedVariant();
    if (!variant) return;

    await this.ipc.deleteVariant(this.serviceId, this.endpoint.id, variant.id);
    this.localVariants.update((variants) => variants.filter((candidate) => candidate.id !== variant.id));
    this.selectedVariantIdx.set(0);
    this.syncSelectedVariantDraftFromState();
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

  protected normalizedBodyKind(kind: BodyKind | string | null | undefined): BodyKind {
    return this.bodyKindOptions.some((option) => option.value === kind)
      ? (kind as BodyKind)
      : 'json';
  }

  protected setBodyKind(kind: BodyKind): void {
    const variant = this.selectedVariant();
    if (!variant) return;

    const previousKind = this.normalizedBodyKind(variant.bodyKind);
    variant.bodyKind = kind;

    const nextContentType = this.defaultContentType(kind);
    const previousContentType = this.defaultContentType(previousKind).toLowerCase();

    this.headerRows.update((rows) => {
      const contentTypeIndex = rows.findIndex((row) => row.key.trim().toLowerCase() === 'content-type');
      if (contentTypeIndex === -1) {
        return [...rows, { key: 'content-type', value: nextContentType }];
      }

      const currentValue = rows[contentTypeIndex].value.trim().toLowerCase();
      if (!currentValue || currentValue === previousContentType) {
        const updatedRows = [...rows];
        updatedRows[contentTypeIndex] = { ...updatedRows[contentTypeIndex], value: nextContentType };
        return updatedRows;
      }

      return rows;
    });
  }

  protected bodyKindChipClass(active: boolean): string {
    return active ? 'kind-chip kind-chip-active' : 'kind-chip kind-chip-idle';
  }

  protected bodyKindDescription(kind: BodyKind): string {
    return this.bodyKindOptions.find((option) => option.value === kind)?.description ?? '';
  }

  private syncSelectedVariantDraftFromState(): void {
    const variant = this.selectedVariant();
    if (!variant) {
      this.variantScenariosInput = '';
      this.headerRows.set([]);
      return;
    }

    this.variantScenariosInput = variant.scenarios.join(', ');
    this.headerRows.set(
      Object.entries(variant.headers ?? {}).map(([key, value]) => ({ key, value })),
    );
  }

  private syncSelectedVariantDraftToState(): ResponseVariant | null {
    const variant = this.selectedVariant();
    if (!variant) return null;

    const updatedVariant: ResponseVariant = {
      ...variant,
      body: variant.body ?? '',
      bodyKind: this.normalizedBodyKind(variant.bodyKind),
      headers: this.buildHeaders(),
      scenarios: [...variant.scenarios],
    };

    this.localVariants.update((variants) =>
      variants.map((candidate, index) =>
        index === this.selectedVariantIdx() ? updatedVariant : candidate,
      ),
    );

    return updatedVariant;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const { key, value } of this.headerRows()) {
      if (key.trim()) {
        headers[key.trim()] = value;
      }
    }
    return headers;
  }

  private cloneVariant(variant: ResponseVariant): ResponseVariant {
    return {
      ...variant,
      bodyKind: this.normalizedBodyKind(variant.bodyKind),
      headers: { ...(variant.headers ?? {}) },
      match: {
        ...variant.match,
        headers: { ...(variant.match.headers ?? {}) },
        query: { ...(variant.match.query ?? {}) },
        bodyJsonPath: [...(variant.match.bodyJsonPath ?? [])],
      },
    };
  }

  private defaultContentType(kind: BodyKind): string {
    switch (kind) {
      case 'json':
        return 'application/json; charset=utf-8';
      case 'xml':
        return 'application/xml; charset=utf-8';
      case 'text':
        return 'text/plain; charset=utf-8';
      default:
        return 'application/octet-stream';
    }
  }
}
