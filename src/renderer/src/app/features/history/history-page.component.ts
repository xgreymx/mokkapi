/**
 * HistoryPage — live request inspector.
 * Part 2 will add real data from the SQLite store; for now this renders the
 * empty-state shell with the correct layout so routing and styling are proven.
 */

import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { IpcService } from '../../ipc/ipc.service';
import type { HistoryEntry } from '@shared/models';

@Component({
  selector: 'app-history-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-h-0 flex-col overflow-hidden lg:flex-row">

      <section class="flex min-h-[280px] flex-col border-b border-[rgb(var(--border))] surface-el lg:min-h-0 lg:w-[430px] lg:max-w-[42%] lg:border-b-0 lg:border-r">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-[rgb(var(--border))] flex-shrink-0">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               class="text-[rgb(var(--text-muted))] flex-shrink-0">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            [value]="filterText()"
            (input)="setFilter($any($event.target).value)"
            placeholder="Filter by path, method, status, body…"
            class="flex-1 bg-transparent text-sm text-[rgb(var(--text))] placeholder:text-[rgb(var(--text-xmuted))] focus:outline-none"
          />
          @if (entries().length > 0) {
            <button
              (click)="clearHistory()"
              class="text-xs text-[rgb(var(--text-muted))] hover:text-[rgb(var(--status-5xx))] transition-colors"
            >
              Clear
            </button>
          }
        </div>

        <div class="flex-1 overflow-y-auto scrollbar-thin">
          @if (entries().length === 0) {
            <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none"
                   stroke="currentColor" stroke-width="1.25"
                   class="text-[rgb(var(--border))]"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
              </svg>
              <p class="text-sm text-[rgb(var(--text-muted))]">No requests yet</p>
              <p class="text-xs text-[rgb(var(--text-xmuted))]">
                Requests to your running services will appear here in real time.
              </p>
            </div>
          } @else if (filteredEntries().length === 0) {
            <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p class="text-sm text-[rgb(var(--text-muted))]">No requests match the current filter</p>
              <button
                type="button"
                (click)="setFilter('')"
                class="text-xs text-[rgb(var(--primary))] hover:text-[rgb(var(--text))] transition-colors"
              >
                Clear filter
              </button>
            </div>
          } @else {
            <div class="flex items-center gap-3 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))] border-b border-[rgb(var(--border))] sticky top-0 surface-el z-10">
              <span class="w-18 flex-shrink-0">Method</span>
              <span class="flex-1">Path</span>
              <span class="w-12 flex-shrink-0 text-right">Code</span>
              <span class="w-16 flex-shrink-0 text-right">Time</span>
            </div>

            @for (entry of filteredEntries(); track entry.id) {
              <button
                type="button"
                (click)="selectEntry(entry.id)"
                class="flex w-full items-start gap-3 px-4 py-3 border-b border-[rgb(var(--border)/0.45)] text-left transition-colors hover:bg-[rgb(var(--bg-elevated))]"
                [class.surface]="activeEntry()?.id === entry.id"
                [class.bg-[rgb(var(--bg))]]="activeEntry()?.id === entry.id"
              >
                <span [class]="'mt-0.5 w-18 flex-shrink-0 badge-method badge-' + entry.method.toLowerCase()">
                  {{ entry.method }}
                </span>

                <span class="min-w-0 flex-1">
                  <span class="block truncate font-mono text-sm text-[rgb(var(--text))]">
                    {{ fullPath(entry) }}
                  </span>
                  <span class="mt-1 flex items-center gap-2 text-[11px] text-[rgb(var(--text-xmuted))] font-mono">
                    <span>{{ entry.serviceId }}</span>
                    @if (entry.remoteAddr) {
                      <span>{{ entry.remoteAddr }}</span>
                    }
                  </span>
                </span>

                <span class="w-12 flex-shrink-0 pt-0.5 text-right font-mono text-xs" [class]="statusCodeClass(entry.resStatus)">
                  {{ entry.resStatus }}
                </span>

                <span class="w-16 flex-shrink-0 pt-0.5 text-right font-mono text-xs text-[rgb(var(--text-xmuted))]">
                  {{ formatTs(entry.ts) }}
                </span>
              </button>
            }
          }
        </div>
      </section>

      <section class="min-h-0 flex-1 overflow-y-auto surface scrollbar-thin">
        @if (activeEntry(); as entry) {
          <div class="flex min-h-full flex-col">
            <div class="border-b border-[rgb(var(--border))] px-5 py-4 surface-el">
              <div class="flex flex-wrap items-center gap-3">
                <span [class]="'badge-method badge-' + entry.method.toLowerCase()">{{ entry.method }}</span>
                <code class="min-w-0 flex-1 break-all text-sm text-[rgb(var(--text))]">{{ fullPath(entry) }}</code>
                <span class="font-mono text-sm" [class]="statusCodeClass(entry.resStatus)">{{ entry.resStatus }}</span>
              </div>

              <div class="mt-3 grid gap-2 text-xs text-[rgb(var(--text-muted))] sm:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-lg border border-[rgb(var(--border))] px-3 py-2 surface">
                  <div class="text-[rgb(var(--text-xmuted))] uppercase tracking-wider mb-1">Service</div>
                  <div class="font-mono break-all text-[rgb(var(--text))]">{{ entry.serviceId }}</div>
                </div>
                <div class="rounded-lg border border-[rgb(var(--border))] px-3 py-2 surface">
                  <div class="text-[rgb(var(--text-xmuted))] uppercase tracking-wider mb-1">Endpoint</div>
                  <div class="font-mono break-all text-[rgb(var(--text))]">{{ entry.endpointId ?? 'unmatched' }}</div>
                </div>
                <div class="rounded-lg border border-[rgb(var(--border))] px-3 py-2 surface">
                  <div class="text-[rgb(var(--text-xmuted))] uppercase tracking-wider mb-1">Variant</div>
                  <div class="font-mono break-all text-[rgb(var(--text))]">{{ entry.variantId ?? 'none' }}</div>
                </div>
                <div class="rounded-lg border border-[rgb(var(--border))] px-3 py-2 surface">
                  <div class="text-[rgb(var(--text-xmuted))] uppercase tracking-wider mb-1">Duration</div>
                  <div class="font-mono text-[rgb(var(--text))]">{{ entry.durationMs }}ms</div>
                </div>
              </div>
            </div>

            <div class="grid min-h-0 flex-1 gap-4 p-5 xl:grid-cols-2">
              <article class="min-h-0 rounded-xl border border-[rgb(var(--border))] surface-el overflow-hidden">
                <div class="flex items-center justify-between border-b border-[rgb(var(--border))] px-4 py-3">
                  <h2 class="text-sm font-semibold text-[rgb(var(--text))]">Request</h2>
                  <span class="text-xs font-mono text-[rgb(var(--text-xmuted))]">{{ formatTs(entry.ts) }}</span>
                </div>

                <div class="space-y-4 p-4 text-sm">
                  <div>
                    <div class="mb-1 text-[11px] uppercase tracking-wider text-[rgb(var(--text-xmuted))]">Remote Address</div>
                    <div class="font-mono break-all text-[rgb(var(--text))]">{{ entry.remoteAddr ?? 'unknown' }}</div>
                  </div>

                  <div>
                    <div class="mb-1 text-[11px] uppercase tracking-wider text-[rgb(var(--text-xmuted))]">Headers</div>
                    <pre class="max-h-56 overflow-auto rounded-lg border border-[rgb(var(--border))] px-3 py-2 font-mono text-xs text-[rgb(var(--text))] surface scrollbar-thin whitespace-pre-wrap break-all">{{ formatHeaders(entry.reqHeaders) }}</pre>
                  </div>

                  <div>
                    <div class="mb-1 text-[11px] uppercase tracking-wider text-[rgb(var(--text-xmuted))]">Body</div>
                    <pre class="max-h-[28rem] overflow-auto rounded-lg border border-[rgb(var(--border))] px-3 py-2 font-mono text-xs text-[rgb(var(--text))] surface scrollbar-thin whitespace-pre-wrap break-all">{{ formatBody(entry.reqBody) }}</pre>
                  </div>
                </div>
              </article>

              <article class="min-h-0 rounded-xl border border-[rgb(var(--border))] surface-el overflow-hidden">
                <div class="flex items-center justify-between border-b border-[rgb(var(--border))] px-4 py-3">
                  <h2 class="text-sm font-semibold text-[rgb(var(--text))]">Response</h2>
                  <span class="font-mono text-sm" [class]="statusCodeClass(entry.resStatus)">{{ entry.resStatus }}</span>
                </div>

                <div class="space-y-4 p-4 text-sm">
                  <div>
                    <div class="mb-1 text-[11px] uppercase tracking-wider text-[rgb(var(--text-xmuted))]">Summary</div>
                    <div class="font-mono text-[rgb(var(--text))]">{{ entry.resStatus }} in {{ entry.durationMs }}ms</div>
                  </div>

                  <div>
                    <div class="mb-1 text-[11px] uppercase tracking-wider text-[rgb(var(--text-xmuted))]">Headers</div>
                    <pre class="max-h-56 overflow-auto rounded-lg border border-[rgb(var(--border))] px-3 py-2 font-mono text-xs text-[rgb(var(--text))] surface scrollbar-thin whitespace-pre-wrap break-all">{{ formatHeaders(entry.resHeaders) }}</pre>
                  </div>

                  <div>
                    <div class="mb-1 text-[11px] uppercase tracking-wider text-[rgb(var(--text-xmuted))]">Body</div>
                    <pre class="max-h-[28rem] overflow-auto rounded-lg border border-[rgb(var(--border))] px-3 py-2 font-mono text-xs text-[rgb(var(--text))] surface scrollbar-thin whitespace-pre-wrap break-all">{{ formatBody(entry.resBody) }}</pre>
                  </div>
                </div>
              </article>
            </div>
          </div>
        } @else {
          <div class="flex h-full items-center justify-center px-6 text-center">
            <div>
              <p class="text-sm text-[rgb(var(--text-muted))]">Select a request to inspect it</p>
              <p class="mt-1 text-xs text-[rgb(var(--text-xmuted))]">
                The full request and response payloads will appear here.
              </p>
            </div>
          </div>
        }
      </section>
    </div>
  `,
})
export class HistoryPageComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);

  protected readonly entries = signal<HistoryEntry[]>([]);
  protected readonly filterText = signal('');
  protected readonly selectedEntryId = signal<number | null>(null);
  protected readonly filteredEntries = computed(() => {
    const filter = this.filterText().trim().toLowerCase();
    if (!filter) return this.entries();

    return this.entries().filter((entry) => {
      const haystack = [
        entry.method,
        entry.path,
        entry.query ?? '',
        entry.serviceId,
        String(entry.resStatus),
        entry.reqBody ?? '',
        entry.resBody ?? '',
      ].join('\n').toLowerCase();
      return haystack.includes(filter);
    });
  });
  protected readonly activeEntry = computed<HistoryEntry | null>(() => {
    const entries = this.filteredEntries();
    if (entries.length === 0) return null;

    const selectedId = this.selectedEntryId();
    return entries.find((entry) => entry.id === selectedId) ?? entries[0];
  });
  private unsubscribe: (() => void) | null = null;

  async ngOnInit(): Promise<void> {
    const initial = await this.ipc.queryHistory({ limit: 200 });
    this.applyEntries(initial);

    this.unsubscribe = this.ipc.onRequestReceived((entry) => {
      this.applyEntries([entry, ...this.entries()].slice(0, 1000));
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  protected async clearHistory(): Promise<void> {
    await this.ipc.clearHistory();
    this.applyEntries([]);
  }

  protected setFilter(value: string): void {
    this.filterText.set(value);
  }

  protected selectEntry(entryId: number): void {
    this.selectedEntryId.set(entryId);
  }

  protected statusCodeClass(code: number): string {
    if (code < 300) return 'text-[rgb(var(--status-2xx))]';
    if (code < 400) return 'text-[rgb(var(--status-3xx))]';
    if (code < 500) return 'text-[rgb(var(--status-4xx))]';
    return 'text-[rgb(var(--status-5xx))]';
  }

  protected formatTs(ts: number): string {
    return new Date(ts).toLocaleTimeString('en', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }

  protected fullPath(entry: HistoryEntry): string {
    return entry.query ? `${entry.path}?${entry.query}` : entry.path;
  }

  protected formatHeaders(headers: Record<string, string>): string {
    const entries = Object.entries(headers);
    if (entries.length === 0) return 'No headers';
    return entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }

  protected formatBody(body: string | null): string {
    if (!body) return 'No body';

    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  private applyEntries(entries: HistoryEntry[]): void {
    this.entries.set(entries);

    if (entries.length === 0) {
      this.selectedEntryId.set(null);
      return;
    }

    const selectedId = this.selectedEntryId();
    if (selectedId === null || !entries.some((entry) => entry.id === selectedId)) {
      this.selectedEntryId.set(entries[0].id);
    }
  }
}
