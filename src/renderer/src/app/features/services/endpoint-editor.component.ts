import {
  ElementRef,
  OnDestroy,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  computed,
  effect,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { IpcService } from '../../ipc/ipc.service';
import { ThemeService } from '../../data/theme.service';
import type {
  BodyKind,
  Endpoint,
  HttpMethod,
  MatchRuleValue,
  ResponseVariant,
} from '@shared/models';

interface BodyKindOption {
  value: BodyKind;
  name: string;
  mimeType: string;
  description: string;
  placeholder: string;
}

interface BodyHelperSnippet {
  label: string;
  snippet: string;
}

interface StatusPreset {
  code: number;
  label: string;
}

type MatchRuleMode = 'exact' | 'present' | 'absent' | 'regex';

interface HeaderRow {
  key: string;
  value: string;
}

interface MatchRuleRow {
  key: string;
  mode: MatchRuleMode;
  value: string;
}

@Component({
  selector: 'app-endpoint-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './endpoint-editor.component.html',
  styleUrl: './endpoint-editor.component.css',
  imports: [FormsModule, ReactiveFormsModule],
})
export class EndpointEditorComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) serviceId!: string;
  @Input({ required: true }) endpoint!: Endpoint;
  @Input() availableScenarios: string[] = [];
  @Input() activeScenario = '';
  @Output() endpointChanged = new EventEmitter<void>();
  @Output() endpointDeleted = new EventEmitter<void>();

  @ViewChild('bodyEditorHost')
  protected set bodyEditorHost(elementRef: ElementRef<HTMLDivElement> | undefined) {
    if (!elementRef) {
      this.destroyBodyEditor();
      return;
    }

    this.mountBodyEditor(elementRef.nativeElement);
  }

  private readonly ipc = inject(IpcService);
  private readonly themeService = inject(ThemeService);
  private readonly bodyLanguageCompartment = new Compartment();
  private readonly bodyThemeCompartment = new Compartment();
  private readonly bodyPlaceholderCompartment = new Compartment();
  private bodyEditorView: EditorView | null = null;
  private variantRailPeekTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly railPeekDelayMs = 260;

  protected readonly saving = signal(false);
  protected readonly selectedVariantIdx = signal(0);
  protected readonly localVariants = signal<ResponseVariant[]>([]);
  protected readonly headerRows = signal<HeaderRow[]>([]);
  protected readonly matchHeaderRows = signal<MatchRuleRow[]>([]);
  protected readonly matchQueryRows = signal<MatchRuleRow[]>([]);
  protected readonly scenarioTags = signal<string[]>([]);
  protected readonly scenarioDraft = signal('');
  protected readonly serviceScenarios = signal<string[]>([]);
  protected readonly activeServiceScenario = signal('');
  protected readonly currentBodyKind = signal<BodyKind>('json');
  protected readonly showVariantRail = signal(true);
  protected readonly peekVariantRail = signal(false);
  protected readonly variantRailVisible = computed(() => this.showVariantRail() || this.peekVariantRail());

  protected readonly methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  protected readonly matchRuleModes: { value: MatchRuleMode; text: string }[] = [
    { value: 'exact', text: 'Equals' },
    { value: 'present', text: 'Present' },
    { value: 'absent', text: 'Absent' },
    { value: 'regex', text: 'Regex' },
  ];

  protected readonly bodyKindOptions: BodyKindOption[] = [
    {
      value: 'json',
      name: 'JSON',
      mimeType: 'application/json; charset=utf-8',
      description: 'Formats structured payloads as application/json.',
      placeholder: '{\n  "id": "{{faker.uuid}}",\n  "name": "{{faker.name}}"\n}',
    },
    {
      value: 'xml',
      name: 'XML',
      mimeType: 'application/xml; charset=utf-8',
      description: 'Returns XML content as application/xml.',
      placeholder: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <id>{{faker.uuid}}</id>\n</root>',
    },
    {
      value: 'html',
      name: 'HTML',
      mimeType: 'text/html; charset=utf-8',
      description: 'Returns HTML content as text/html.',
      placeholder: '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Hello, {{faker.name}}!</h1>\n  </body>\n</html>',
    },
    {
      value: 'text',
      name: 'Text',
      mimeType: 'text/plain; charset=utf-8',
      description: 'Returns plain text as text/plain.',
      placeholder: 'Hello, {{faker.name}}!',
    },
    {
      value: 'binary-base64',
      name: 'Binary',
      mimeType: 'application/octet-stream',
      description: 'Marks the payload as base64-encoded binary data.',
      placeholder: 'SGVsbG8gV29ybGQ=',
    },
  ];
  protected readonly bodyHelperSnippets: BodyHelperSnippet[] = [
    { label: 'UUID faker', snippet: '{{faker.uuid}}' },
    { label: 'Body field', snippet: '{{request.body.field}}' },
    { label: 'Route param', snippet: '{{request.params.id}}' },
  ];
  protected readonly statusPresets: StatusPreset[] = [
    { code: 200, label: 'OK' },
    { code: 201, label: 'Created' },
    { code: 204, label: 'No Content' },
    { code: 400, label: 'Bad Request' },
    { code: 401, label: 'Unauthorized' },
    { code: 404, label: 'Not Found' },
    { code: 409, label: 'Conflict' },
    { code: 422, label: 'Unprocessable' },
    { code: 500, label: 'Server Error' },
    { code: 503, label: 'Unavailable' },
  ];

  protected readonly bodyPlaceholder = computed(
    () => this.bodyKindOptions.find((option) => option.value === this.currentBodyKind())?.placeholder ?? '',
  );
  protected readonly bodyKindDetail = computed<BodyKindOption>(
    () => this.bodyKindOptions.find((option) => option.value === this.currentBodyKind()) ?? this.bodyKindOptions[0],
  );
  protected readonly scenarioSuggestions = computed(() =>
    this.serviceScenarios().filter((scenario) => !this.hasScenarioTag(scenario)),
  );
  protected readonly scenarioSummary = computed(() => {
    const selected = this.scenarioTags();
    const active = this.activeServiceScenario();

    if (selected.length === 0) {
      return active
        ? `Matches every scenario. Active now: ${active}.`
        : 'Matches every scenario.';
    }

    const includesActive = active
      ? selected.some((scenario) => this.sameScenarioTag(scenario, active))
      : false;

    if (includesActive) {
      return `Matches ${selected.length} scenario${selected.length === 1 ? '' : 's'}, including the current active scenario.`;
    }

    return active
      ? `Matches ${selected.length} scenario${selected.length === 1 ? '' : 's'}. Active now: ${active}.`
      : `Matches ${selected.length} scenario${selected.length === 1 ? '' : 's'}.`;
  });

  protected editMethod: HttpMethod = 'GET';
  protected editPath = '';
  protected editDescription = '';

  protected readonly variantForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    status: new FormControl(200, { nonNullable: true }),
    delayMs: new FormControl(0, { nonNullable: true }),
    body: new FormControl('', { nonNullable: true }),
  });

  protected readonly selectedVariant = computed(() => {
    const variants = this.localVariants();
    const index = this.selectedVariantIdx();
    return index >= 0 && index < variants.length ? variants[index] : null;
  });

  constructor() {
    effect(() => {
      this.currentBodyKind();
      this.reconfigureBodyEditorLanguage();
      this.reconfigureBodyEditorPlaceholder();
    });

    effect(() => {
      this.themeService.resolved();
      this.reconfigureBodyEditorTheme();
    });
  }

  ngOnDestroy(): void {
    this.clearVariantRailPeekTimer();
    this.destroyBodyEditor();
  }

  ngOnChanges(): void {
    this.serviceScenarios.set(
      this.normalizeScenarioTags([...this.availableScenarios, this.activeScenario]),
    );
    this.activeServiceScenario.set(this.activeScenario.trim());

    this.editMethod = this.endpoint.method;
    this.editPath = this.endpoint.path;
    this.editDescription = this.endpoint.description;

    const previousId = this.localVariants()[this.selectedVariantIdx()]?.id;
    const next = this.endpoint.variants.map((variant) => this.cloneVariant(variant));
    this.localVariants.set(next);

    const restoredIdx = previousId
      ? next.findIndex((variant) => variant.id === previousId)
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

  protected addMatchHeader(): void {
    this.matchHeaderRows.update((rows) => [...rows, this.createEmptyMatchRuleRow()]);
  }

  protected removeMatchHeader(index: number): void {
    this.matchHeaderRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected addMatchQuery(): void {
    this.matchQueryRows.update((rows) => [...rows, this.createEmptyMatchRuleRow()]);
  }

  protected removeMatchQuery(index: number): void {
    this.matchQueryRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected matchValuePlaceholder(mode: MatchRuleMode): string {
    switch (mode) {
      case 'present':
      case 'absent':
        return 'No value needed';
      case 'regex':
        return '^Bearer\\s.+';
      default:
        return 'Exact value';
    }
  }

  protected isRuleValueDisabled(mode: MatchRuleMode): boolean {
    return mode === 'present' || mode === 'absent';
  }

  protected setBodyKind(kind: BodyKind): void {
    if (this.currentBodyKind() === kind) return;

    const previous = this.currentBodyKind();
    this.currentBodyKind.set(kind);
    this.syncBodyKindHeader(kind, previous);

    if (this.shouldReplaceBodyWithStarter(this.variantForm.controls.body.value, previous)) {
      this.setBodyValue(this.starterTemplateFor(kind));
    }
  }

  protected toggleVariantRail(): void {
    const next = !this.showVariantRail();
    this.showVariantRail.set(next);
    if (next) this.peekVariantRail.set(false);
    this.clearVariantRailPeekTimer();
  }

  protected scheduleVariantRailPeek(): void {
    if (this.showVariantRail() || this.peekVariantRail()) return;
    this.clearVariantRailPeekTimer();
    this.variantRailPeekTimer = window.setTimeout(() => {
      this.peekVariantRail.set(true);
      this.variantRailPeekTimer = null;
    }, this.railPeekDelayMs);
  }

  protected cancelVariantRailPeek(): void {
    this.clearVariantRailPeekTimer();
    if (!this.showVariantRail()) {
      this.peekVariantRail.set(false);
    }
  }

  protected onScenarioDraftChange(value: string): void {
    const { completed, draft } = this.parseScenarioInput(value);
    this.addScenarioTags(completed);
    this.scenarioDraft.set(draft);
  }

  protected onScenarioDraftKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (!this.scenarioDraft().trim()) return;
      event.preventDefault();
      this.commitScenarioDraft();
      return;
    }

    if (event.key === 'Backspace' && !this.scenarioDraft().trim() && this.scenarioTags().length > 0) {
      event.preventDefault();
      this.removeScenario(this.scenarioTags().length - 1);
    }
  }

  protected commitScenarioDraft(): void {
    const draft = this.scenarioDraft().trim();
    if (!draft) {
      this.scenarioDraft.set('');
      return;
    }

    this.addScenarioTags([draft]);
    this.scenarioDraft.set('');
  }

  protected toggleScenario(tag: string): void {
    if (this.hasScenarioTag(tag)) {
      this.scenarioTags.update((current) =>
        current.filter((scenario) => !this.sameScenarioTag(scenario, tag)),
      );
      return;
    }

    this.addScenarioTags([tag]);
  }

  protected removeScenario(index: number): void {
    this.scenarioTags.update((current) => current.filter((_, i) => i !== index));
  }

  protected isActiveServiceScenario(tag: string): boolean {
    const active = this.activeServiceScenario();
    return !!active && this.sameScenarioTag(tag, active);
  }

  protected insertBodySnippet(snippet: string): void {
    if (!this.bodyEditorView) {
      this.setBodyValue(`${this.variantForm.controls.body.value}${snippet}`);
      return;
    }

    const selection = this.bodyEditorView.hasFocus
      ? this.bodyEditorView.state.selection.main
      : { from: this.bodyEditorView.state.doc.length, to: this.bodyEditorView.state.doc.length };

    this.bodyEditorView.dispatch({
      changes: { from: selection.from, to: selection.to, insert: snippet },
      selection: { anchor: selection.from + snippet.length },
      scrollIntoView: true,
    });

    this.bodyEditorView.focus();
  }

  protected statusClass(code: number): string {
    if (code < 300) return 'text-2xx bg-[rgb(var(--status-2xx)/0.12)]';
    if (code < 400) return 'text-3xx bg-[rgb(var(--status-3xx)/0.12)]';
    if (code < 500) return 'text-4xx bg-[rgb(var(--status-4xx)/0.12)]';
    return 'text-5xx bg-[rgb(var(--status-5xx)/0.12)]';
  }

  protected statusTone(code: number): '2xx' | '3xx' | '4xx' | '5xx' {
    if (code < 300) return '2xx';
    if (code < 400) return '3xx';
    if (code < 500) return '4xx';
    return '5xx';
  }

  protected statusLabel(code: number): string {
    switch (code) {
      case 100: return 'Continue';
      case 101: return 'Switching Protocols';
      case 200: return 'OK';
      case 201: return 'Created';
      case 202: return 'Accepted';
      case 204: return 'No Content';
      case 301: return 'Moved Permanently';
      case 302: return 'Found';
      case 304: return 'Not Modified';
      case 307: return 'Temporary Redirect';
      case 308: return 'Permanent Redirect';
      case 400: return 'Bad Request';
      case 401: return 'Unauthorized';
      case 403: return 'Forbidden';
      case 404: return 'Not Found';
      case 405: return 'Method Not Allowed';
      case 408: return 'Request Timeout';
      case 409: return 'Conflict';
      case 410: return 'Gone';
      case 415: return 'Unsupported Media Type';
      case 422: return 'Unprocessable Content';
      case 429: return 'Too Many Requests';
      case 500: return 'Internal Server Error';
      case 501: return 'Not Implemented';
      case 502: return 'Bad Gateway';
      case 503: return 'Service Unavailable';
      case 504: return 'Gateway Timeout';
      default:
        if (code < 200) return 'Informational response';
        if (code < 300) return 'Successful response';
        if (code < 400) return 'Redirection response';
        if (code < 500) return 'Client error response';
        return 'Server error response';
    }
  }

  protected setStatusPreset(code: number): void {
    this.variantForm.controls.status.setValue(code);
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
      body: this.starterTemplateFor('json'),
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
        variants.map((variant, index) => (index === this.selectedVariantIdx() ? updated : variant)),
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
    this.localVariants.update((variants) => variants.filter((item) => item.id !== variant.id));
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
      this.variantForm.reset(
        {
          name: '',
          status: 200,
          delayMs: 0,
          body: '',
        },
        { emitEvent: false },
      );
      this.headerRows.set([]);
      this.matchHeaderRows.set([]);
      this.matchQueryRows.set([]);
      this.scenarioTags.set([]);
      this.scenarioDraft.set('');
      this.currentBodyKind.set('json');
      this.setBodyValue('');
      return;
    }

    this.variantForm.patchValue(
      {
        name: variant.name,
        status: variant.status,
        delayMs: variant.delayMs,
        body: variant.body,
      },
      { emitEvent: false },
    );

    this.currentBodyKind.set(variant.bodyKind);
    this.setBodyValue(variant.body);
    this.scenarioTags.set(this.normalizeScenarioTags(variant.scenarios));
    this.scenarioDraft.set('');
    this.headerRows.set(
      Object.entries(variant.headers ?? {}).map(([key, value]) => ({ key, value })),
    );
    this.matchHeaderRows.set(this.parseMatchRows(variant.match.headers ?? {}));
    this.matchQueryRows.set(this.parseMatchRows(variant.match.query ?? {}));
  }

  private flushCurrentVariantToState(): void {
    const index = this.selectedVariantIdx();
    const current = this.localVariants()[index];
    if (!current) return;

    const updated = this.buildVariantFromForm(current);
    this.localVariants.update((variants) =>
      variants.map((variant, rowIndex) => (rowIndex === index ? updated : variant)),
    );
  }

  private buildVariantFromForm(original: ResponseVariant): ResponseVariant {
    const { name, status, delayMs, body } = this.variantForm.getRawValue();

    return {
      ...original,
      name,
      status,
      delayMs,
      scenarios: [...this.scenarioTags()],
      body,
      bodyKind: this.currentBodyKind(),
      headers: this.buildHeaders(),
      match: {
        ...original.match,
        headers: this.buildMatchRecord(this.matchHeaderRows()),
        query: this.buildMatchRecord(this.matchQueryRows()),
        bodyJsonPath: [...(original.match.bodyJsonPath ?? [])],
      },
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const { key, value } of this.headerRows()) {
      if (key.trim()) headers[key.trim()] = value;
    }
    return headers;
  }

  private buildMatchRecord(rows: MatchRuleRow[]): Record<string, MatchRuleValue> {
    const rules: Record<string, MatchRuleValue> = {};

    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;

      switch (row.mode) {
        case 'present':
          rules[key] = 'present';
          break;
        case 'absent':
          rules[key] = '!present';
          break;
        case 'regex':
          rules[key] = { regex: row.value };
          break;
        default:
          rules[key] = row.value;
          break;
      }
    }

    return rules;
  }

  private parseMatchRows(rules: Record<string, MatchRuleValue>): MatchRuleRow[] {
    return Object.entries(rules).map(([key, value]) => {
      if (typeof value === 'object' && 'regex' in value) {
        return { key, mode: 'regex', value: value.regex };
      }
      if (value === 'present') {
        return { key, mode: 'present', value: '' };
      }
      if (value === '!present') {
        return { key, mode: 'absent', value: '' };
      }
      return { key, mode: 'exact', value };
    });
  }

  private createEmptyMatchRuleRow(): MatchRuleRow {
    return {
      key: '',
      mode: 'exact',
      value: '',
    };
  }

  private parseScenarioInput(value: string): { completed: string[]; draft: string } {
    if (!/[\n,]/.test(value)) {
      return { completed: [], draft: value };
    }

    const tokens = value
      .split(/[\n,]/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (/[\n,]\s*$/.test(value)) {
      return { completed: tokens, draft: '' };
    }

    const draft = tokens.pop() ?? '';
    return { completed: tokens, draft };
  }

  private clearVariantRailPeekTimer(): void {
    if (this.variantRailPeekTimer === null) return;
    clearTimeout(this.variantRailPeekTimer);
    this.variantRailPeekTimer = null;
  }

  private mountBodyEditor(parent: HTMLDivElement): void {
    this.destroyBodyEditor();

    this.bodyEditorView = new EditorView({
      state: EditorState.create({
        doc: this.variantForm.controls.body.value,
        extensions: [
          basicSetup,
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          this.bodyLanguageCompartment.of(this.languageExtensionFor(this.currentBodyKind())),
          this.bodyThemeCompartment.of(this.editorThemeExtension()),
          this.bodyPlaceholderCompartment.of(placeholder(this.bodyPlaceholder())),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;

            const next = update.state.doc.toString();
            if (next === this.variantForm.controls.body.value) return;

            this.variantForm.controls.body.setValue(next, { emitEvent: false });
          }),
        ],
      }),
      parent,
    });
  }

  private destroyBodyEditor(): void {
    this.bodyEditorView?.destroy();
    this.bodyEditorView = null;
  }

  private reconfigureBodyEditorLanguage(): void {
    if (!this.bodyEditorView) return;

    this.bodyEditorView.dispatch({
      effects: this.bodyLanguageCompartment.reconfigure(this.languageExtensionFor(this.currentBodyKind())),
    });
  }

  private reconfigureBodyEditorTheme(): void {
    if (!this.bodyEditorView) return;

    this.bodyEditorView.dispatch({
      effects: this.bodyThemeCompartment.reconfigure(this.editorThemeExtension()),
    });
  }

  private reconfigureBodyEditorPlaceholder(): void {
    if (!this.bodyEditorView) return;

    this.bodyEditorView.dispatch({
      effects: this.bodyPlaceholderCompartment.reconfigure(placeholder(this.bodyPlaceholder())),
    });
  }

  private syncBodyEditorDocument(value: string): void {
    if (!this.bodyEditorView) return;

    const current = this.bodyEditorView.state.doc.toString();
    if (current === value) return;

    this.bodyEditorView.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }

  private setBodyValue(value: string): void {
    if (this.variantForm.controls.body.value !== value) {
      this.variantForm.controls.body.setValue(value, { emitEvent: false });
    }

    this.syncBodyEditorDocument(value);
  }

  private languageExtensionFor(kind: BodyKind): Extension {
    switch (kind) {
      case 'json':
        return json();
      case 'xml':
        return xml();
      case 'html':
        return html();
      default:
        return [];
    }
  }

  private editorThemeExtension(): Extension {
    return this.themeService.resolved() === 'dark'
      ? oneDark
      : syntaxHighlighting(defaultHighlightStyle, { fallback: true });
  }

  private starterTemplateFor(kind: BodyKind): string {
    return this.bodyKindOptions.find((option) => option.value === kind)?.placeholder ?? '';
  }

  private shouldReplaceBodyWithStarter(currentBody: string, previousKind: BodyKind): boolean {
    const trimmed = currentBody.trim();
    if (!trimmed) return true;

    if (previousKind === 'json' && trimmed === '{}') return true;

    return this.bodyKindOptions.some((option) => option.placeholder.trim() === trimmed);
  }

  private syncBodyKindHeader(next: BodyKind, previous: BodyKind): void {
    const nextCT = this.contentTypeFor(next);
    const previousCT = this.contentTypeFor(previous).toLowerCase();

    this.headerRows.update((rows) => {
      const contentTypeIndex = rows.findIndex((row) => row.key.trim().toLowerCase() === 'content-type');
      if (contentTypeIndex === -1) {
        return [...rows, { key: 'content-type', value: nextCT }];
      }

      const currentValue = rows[contentTypeIndex].value.trim().toLowerCase();
      if (!currentValue || currentValue === previousCT) {
        return rows.map((row, index) =>
          index === contentTypeIndex ? { ...row, value: nextCT } : row,
        );
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

  private addScenarioTags(rawTags: string[]): void {
    this.scenarioTags.set(this.normalizeScenarioTags([...this.scenarioTags(), ...rawTags]));
  }

  private hasScenarioTag(tag: string): boolean {
    return this.scenarioTags().some((scenario) => this.sameScenarioTag(scenario, tag));
  }

  private sameScenarioTag(left: string, right: string): boolean {
    return this.normalizeScenarioTag(left) === this.normalizeScenarioTag(right);
  }

  private normalizeScenarioTags(tags: string[]): string[] {
    const unique = new Set<string>();
    const normalized: string[] = [];

    for (const rawTag of tags) {
      const tag = rawTag.trim();
      if (!tag) continue;

      const lookup = this.normalizeScenarioTag(tag);
      if (unique.has(lookup)) continue;

      unique.add(lookup);
      normalized.push(tag);
    }

    return normalized;
  }

  private normalizeScenarioTag(tag: string): string {
    return tag.trim().toLowerCase();
  }

  private contentTypeFor(kind: BodyKind): string {
    return this.bodyKindOptions.find((option) => option.value === kind)?.mimeType ?? 'application/octet-stream';
  }
}
