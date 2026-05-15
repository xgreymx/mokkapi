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
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IpcService } from '../../ipc/ipc.service';
import type { BodyKind, Endpoint, HttpMethod, ResponseVariant } from '@shared/models';

interface BodyKindOption {
  value: BodyKind;
  label: string;
  description: string;
  placeholder: string;
}

@Component({
  selector: 'app-endpoint-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './endpoint-editor.component.html',
  styleUrl: './endpoint-editor.component.css',
  imports: [FormsModule, ReactiveFormsModule],
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
  protected readonly currentBodyKind = signal<BodyKind>('json');

  protected readonly methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  protected readonly bodyKindOptions: BodyKindOption[] = [
    {
      value: 'json',
      label: 'JSON',
      description: 'Formats structured payloads as application/json.',
      placeholder: '{\n  "id": "{{faker.uuid}}",\n  "name": "{{faker.name}}"\n}',
    },
    {
      value: 'xml',
      label: 'XML',
      description: 'Returns XML content as application/xml.',
      placeholder: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <id>{{faker.uuid}}</id>\n</root>',
    },
    {
      value: 'html',
      label: 'HTML',
      description: 'Returns HTML content as text/html.',
      placeholder: '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Hello, {{faker.name}}!</h1>\n  </body>\n</html>',
    },
    {
      value: 'text',
      label: 'Text',
      description: 'Returns plain text as text/plain.',
      placeholder: 'Hello, {{faker.name}}!',
    },
    {
      value: 'binary-base64',
      label: 'Binary',
      description: 'Marks the payload as base64-encoded binary data.',
      placeholder: 'SGVsbG8gV29ybGQ=',
    },
  ];

  protected readonly bodyPlaceholder = computed(
    () => this.bodyKindOptions.find((o) => o.value === this.currentBodyKind())?.placeholder ?? '',
  );

  protected editMethod: HttpMethod = 'GET';
  protected editPath = '';
  protected editDescription = '';

  protected readonly variantForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    status: new FormControl(200, { nonNullable: true }),
    delayMs: new FormControl(0, { nonNullable: true }),
    scenarios: new FormControl('', { nonNullable: true }),
    body: new FormControl('', { nonNullable: true }),
  });

  protected readonly selectedVariant = computed(() => {
    const variants = this.localVariants();
    const index = this.selectedVariantIdx();
    return index >= 0 && index < variants.length ? variants[index] : null;
  });

  ngOnChanges(): void {
    this.editMethod = this.endpoint.method;
    this.editPath = this.endpoint.path;
    this.editDescription = this.endpoint.description;

    const previousId = this.localVariants()[this.selectedVariantIdx()]?.id;
    const next = this.endpoint.variants.map((v) => this.cloneVariant(v));
    this.localVariants.set(next);

    const restoredIdx = previousId
      ? next.findIndex((v) => v.id === previousId)
      : -1;
    this.selectedVariantIdx.set(restoredIdx >= 0 ? restoredIdx : 0);

    this.seedFormFromVariant();
  }

  protected selectVariant(index: number): void {
    this.flushCurrentVariantToState();
    this.selectedVariantIdx.set(index);
    this.seedFormFromVariant();
  }

  protected addHeader(): void {
    this.headerRows.update((rows) => [...rows, { key: '', value: '' }]);
  }

  protected removeHeader(index: number): void {
    this.headerRows.update((rows) => rows.filter((_, i) => i !== index));
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

  protected setBodyKind(kind: BodyKind): void {
    const prev = this.currentBodyKind();
    this.currentBodyKind.set(kind);
    this.syncBodyKindHeader(kind, prev);
  }

  protected onBodyKindSelectChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as BodyKind;
    this.setBodyKind(value);
  }

  protected statusClass(code: number): string {
    if (code < 300) return 'text-2xx bg-[rgb(var(--status-2xx)/0.12)]';
    if (code < 400) return 'text-3xx bg-[rgb(var(--status-3xx)/0.12)]';
    if (code < 500) return 'text-4xx bg-[rgb(var(--status-4xx)/0.12)]';
    return 'text-5xx bg-[rgb(var(--status-5xx)/0.12)]';
  }

  protected async saveEndpoint(): Promise<void> {
    this.saving.set(true);
    try {
      this.flushCurrentVariantToState();
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
    this.flushCurrentVariantToState();
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
    this.seedFormFromVariant();
  }

  protected async saveVariant(): Promise<void> {
    const original = this.selectedVariant();
    if (!original) return;

    this.saving.set(true);
    try {
      const updated = this.buildVariantFromForm(original);
      this.localVariants.update((variants) =>
        variants.map((v, i) => (i === this.selectedVariantIdx() ? updated : v)),
      );
      await this.ipc.updateVariant(this.serviceId, this.endpoint.id, original.id, updated);
      this.endpointChanged.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteVariant(): Promise<void> {
    const variant = this.selectedVariant();
    if (!variant) return;

    await this.ipc.deleteVariant(this.serviceId, this.endpoint.id, variant.id);
    this.localVariants.update((variants) => variants.filter((v) => v.id !== variant.id));
    this.selectedVariantIdx.set(0);
    this.seedFormFromVariant();
  }

  protected async forceVariant(variantId: string | null): Promise<void> {
    this.flushCurrentVariantToState();
    await this.ipc.forceVariant(this.serviceId, this.endpoint.id, variantId);
    this.endpointChanged.emit();
  }

  private seedFormFromVariant(): void {
    const variant = this.selectedVariant();
    if (!variant) {
      this.variantForm.reset();
      this.headerRows.set([]);
      this.currentBodyKind.set('json');
      return;
    }

    this.variantForm.patchValue(
      {
        name: variant.name,
        status: variant.status,
        delayMs: variant.delayMs,
        scenarios: variant.scenarios.join(', '),
        body: variant.body,
      },
      { emitEvent: false },
    );

    this.currentBodyKind.set(variant.bodyKind);
    this.headerRows.set(
      Object.entries(variant.headers ?? {}).map(([key, value]) => ({ key, value })),
    );
  }

  private flushCurrentVariantToState(): void {
    const idx = this.selectedVariantIdx();
    const current = this.localVariants()[idx];
    if (!current) return;
    const updated = this.buildVariantFromForm(current);
    this.localVariants.update((variants) =>
      variants.map((v, i) => (i === idx ? updated : v)),
    );
  }

  private buildVariantFromForm(original: ResponseVariant): ResponseVariant {
    const { name, status, delayMs, scenarios, body } = this.variantForm.getRawValue();
    return {
      ...original,
      name,
      status,
      delayMs,
      scenarios: scenarios
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      body,
      bodyKind: this.currentBodyKind(),
      headers: this.buildHeaders(),
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const { key, value } of this.headerRows()) {
      if (key.trim()) headers[key.trim()] = value;
    }
    return headers;
  }

  private syncBodyKindHeader(next: BodyKind, prev: BodyKind): void {
    const nextCT = this.defaultContentType(next);
    const prevCT = this.defaultContentType(prev).toLowerCase();

    this.headerRows.update((rows) => {
      const ctIdx = rows.findIndex((r) => r.key.trim().toLowerCase() === 'content-type');
      if (ctIdx === -1) return [...rows, { key: 'content-type', value: nextCT }];
      const currentValue = rows[ctIdx].value.trim().toLowerCase();
      if (!currentValue || currentValue === prevCT) {
        return rows.map((r, i) => (i === ctIdx ? { ...r, value: nextCT } : r));
      }
      return rows;
    });
  }

  private cloneVariant(variant: ResponseVariant): ResponseVariant {
    return {
      ...variant,
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
      case 'json': return 'application/json; charset=utf-8';
      case 'xml':  return 'application/xml; charset=utf-8';
      case 'html': return 'text/html; charset=utf-8';
      case 'text': return 'text/plain; charset=utf-8';
      default:     return 'application/octet-stream';
    }
  }
}
