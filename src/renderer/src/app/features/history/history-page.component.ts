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
  templateUrl: './history-page.component.html',
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

  protected async deleteEntry(entryId: number, event?: Event): Promise<void> {
    event?.stopPropagation();
    await this.ipc.deleteHistoryEntry(entryId);
    this.applyEntries(this.entries().filter((entry) => entry.id !== entryId));
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
