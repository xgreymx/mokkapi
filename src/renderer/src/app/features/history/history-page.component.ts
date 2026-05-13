/**
 * HistoryPage — live request inspector.
 * Part 2 will add real data from the SQLite store; for now this renders the
 * empty-state shell with the correct layout so routing and styling are proven.
 */

import {
  Component,
  inject,
  signal,
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
    <div class="flex flex-col h-full overflow-hidden">

      <!-- Filter bar -->
      <div class="flex items-center gap-2 px-4 py-2 border-b border-[rgb(var(--border))] surface-el flex-shrink-0">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             class="text-[rgb(var(--text-muted))] flex-shrink-0">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input placeholder="Filter by path, status, service…"
               class="flex-1 bg-transparent text-sm text-[rgb(var(--text))] placeholder:text-[rgb(var(--text-xmuted))]
                      focus:outline-none" />
        @if (entries().length > 0) {
          <button (click)="clearHistory()"
                  class="text-xs text-[rgb(var(--text-muted))] hover:text-[rgb(var(--status-5xx))] transition-colors">
            Clear
          </button>
        }
      </div>

      <!-- Request table -->
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        @if (entries().length === 0) {
          <div class="flex flex-col items-center justify-center h-full gap-3 text-center">
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
        } @else {
          <!-- Table header -->
          <div class="flex items-center gap-3 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider
                      text-[rgb(var(--text-muted))] border-b border-[rgb(var(--border))] sticky top-0
                      surface-el z-10">
            <span class="w-20 flex-shrink-0">Method</span>
            <span class="flex-1">Path</span>
            <span class="w-12 flex-shrink-0 text-right">Status</span>
            <span class="w-16 flex-shrink-0 text-right">Duration</span>
            <span class="w-28 flex-shrink-0 text-right">Time</span>
          </div>

          @for (entry of entries(); track entry.id) {
            <div class="flex items-center gap-3 px-4 py-2 border-b border-[rgb(var(--border)/0.4)]
                        hover:bg-[rgb(var(--bg-elevated))] cursor-pointer transition-colors group text-sm">
              <span [class]="'w-20 flex-shrink-0 badge-method badge-' + entry.method.toLowerCase()">
                {{ entry.method }}
              </span>
              <span class="flex-1 font-mono truncate text-[rgb(var(--text))]">{{ entry.path }}</span>
              <span class="w-12 flex-shrink-0 text-right font-mono text-xs"
                    [class]="statusCodeClass(entry.resStatus)">
                {{ entry.resStatus }}
              </span>
              <span class="w-16 flex-shrink-0 text-right font-mono text-xs text-[rgb(var(--text-muted))]">
                {{ entry.durationMs }}ms
              </span>
              <span class="w-28 flex-shrink-0 text-right text-xs text-[rgb(var(--text-xmuted))] font-mono">
                {{ formatTs(entry.ts) }}
              </span>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class HistoryPageComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);

  protected readonly entries = signal<HistoryEntry[]>([]);
  private unsubscribe: (() => void) | null = null;

  async ngOnInit(): Promise<void> {
    const initial = await this.ipc.queryHistory({ limit: 200 });
    this.entries.set(initial);

    this.unsubscribe = this.ipc.onRequestReceived((entry) => {
      this.entries.update((prev) => [entry, ...prev].slice(0, 1000));
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  protected async clearHistory(): Promise<void> {
    await this.ipc.clearHistory();
    this.entries.set([]);
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
}
