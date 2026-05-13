/**
 * TestClientPage — built-in HTTP request runner.
 * Uses window.mokkapi.sendRequest (via IPC) so requests go through the main
 * process fetch, which has no CORS restrictions.
 */

import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../ipc/ipc.service';
import type { HttpMethod, TestResponse } from '@shared/models';

interface HeaderRow { key: string; value: string; enabled: boolean; }

@Component({
  selector: 'app-test-client-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="flex flex-col h-full overflow-hidden">

      <!-- Request input area -->
      <div class="flex flex-col gap-3 p-4 border-b border-[rgb(var(--border))] surface-el shrink-0">

        <!-- Method + URL + Send -->
        <div class="flex items-center gap-2">
          <select [(ngModel)]="method"
                  class="rounded border border-[rgb(var(--border))] px-2 py-1.5 text-sm
                         bg-[rgb(var(--bg))] text-[rgb(var(--text))] focus:outline-none
                         focus:ring-1 focus:ring-[rgb(var(--border-focus))]">
            @for (m of methods; track m) {
              <option [value]="m">{{ m }}</option>
            }
          </select>

          <input [(ngModel)]="url" placeholder="http://localhost:4001/v1/charges"
                 class="flex-1 rounded border border-[rgb(var(--border))] px-3 py-1.5 text-sm
                        bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono
                        focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]
                        placeholder:text-[rgb(var(--text-xmuted))]"
                 (keydown.enter)="send()" />

          <button (click)="send()" [disabled]="sending()"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium
                         bg-[rgb(var(--primary))] text-[rgb(var(--primary-fg))]
                         hover:opacity-90 transition-opacity disabled:opacity-50">
            @if (sending()) { Sending… } @else { Send }
          </button>
        </div>

        <!-- Tabs: Headers / Body -->
        <div class="flex gap-4 text-xs">
          @for (tab of tabs; track tab) {
            <button (click)="activeTab.set(tab)"
                    class="pb-1 font-medium transition-colors"
                    [class]="activeTab() === tab
                      ? 'text-[rgb(var(--text))] border-b border-[rgb(var(--primary))]'
                      : 'text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]'">
              {{ tab }}
            </button>
          }
        </div>

        <!-- Headers tab -->
        @if (activeTab() === 'Headers') {
          <div class="flex flex-col gap-1.5">
            @for (row of headers(); track $index; let i = $index) {
              <div class="flex items-center gap-2">
                <input [(ngModel)]="row.key" placeholder="Header name"
                       class="flex-1 rounded border border-[rgb(var(--border))] px-2 py-1 text-xs
                              bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono focus:outline-none
                              focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
                <input [(ngModel)]="row.value" placeholder="Value"
                       class="flex-1 rounded border border-[rgb(var(--border))] px-2 py-1 text-xs
                              bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono focus:outline-none
                              focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
                <button (click)="removeHeader(i)"
                        class="text-[rgb(var(--text-xmuted))] hover:text-[rgb(var(--status-5xx))] transition-colors">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                       stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            }
            <button (click)="addHeader()"
                    class="text-xs text-[rgb(var(--primary))] hover:underline w-fit">
              + Add header
            </button>
          </div>
        }

        <!-- Body tab -->
        @if (activeTab() === 'Body') {
          <textarea [(ngModel)]="body" rows="5" placeholder='{"key": "value"}'
                    class="w-full rounded border border-[rgb(var(--border))] px-3 py-2 text-xs
                           bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono resize-none
                           focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]
                           placeholder:text-[rgb(var(--text-xmuted))]">
          </textarea>
        }
      </div>

      <!-- Response area -->
      <div class="flex-1 overflow-y-auto scrollbar-thin p-4">
        @if (!response() && !error()) {
          <div class="flex flex-col items-center justify-center h-full gap-2 text-center">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none"
                 stroke="currentColor" stroke-width="1.25"
                 class="text-[rgb(var(--border))]"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 2 11 13M22 2 15 22 11 13 2 9l20-7z"/>
            </svg>
            <p class="text-sm text-[rgb(var(--text-muted))]">Send a request to see the response</p>
          </div>
        }

        @if (error()) {
          <div class="rounded border border-[rgb(var(--status-5xx)/0.3)] bg-[rgb(var(--status-5xx)/0.06)] p-4 text-sm font-mono text-[rgb(var(--status-5xx))]">
            {{ error() }}
          </div>
        }

        @if (response(); as res) {
          <div class="flex flex-col gap-3">
            <!-- Status line -->
            <div class="flex items-center gap-3">
              <span class="text-sm font-mono font-semibold" [class]="statusCodeClass(res.status)">
                {{ res.status }} {{ res.statusText }}
              </span>
              <span class="text-xs font-mono text-[rgb(var(--text-muted))]">
                {{ res.durationMs }}ms
              </span>
            </div>

            <!-- Response headers -->
            @if (Object.keys(res.headers).length > 0) {
              <details class="text-xs">
                <summary class="cursor-pointer text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] font-medium">
                  Response Headers ({{ Object.keys(res.headers).length }})
                </summary>
                <div class="mt-1.5 rounded border border-[rgb(var(--border))] overflow-hidden">
                  @for (entry of objectEntries(res.headers); track entry[0]) {
                    <div class="flex gap-2 px-3 py-1.5 border-b border-[rgb(var(--border)/0.5)] last:border-0">
                      <span class="font-mono text-[rgb(var(--text-muted))] shrink-0">{{ entry[0] }}</span>
                      <span class="font-mono text-[rgb(var(--text))] truncate">{{ entry[1] }}</span>
                    </div>
                  }
                </div>
              </details>
            }

            <!-- Response body -->
            @if (res.body !== null) {
              <div>
                <p class="text-xs font-medium text-[rgb(var(--text-muted))] mb-1.5">Body</p>
                <pre class="rounded border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-4 py-3
                            text-xs font-mono text-[rgb(var(--text))] overflow-x-auto scrollbar-thin
                            whitespace-pre-wrap break-all">{{ prettyBody(res) }}</pre>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class TestClientPageComponent {
  private readonly ipc = inject(IpcService);

  protected method: HttpMethod = 'GET';
  protected url = '';
  protected body = '';
  protected readonly methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  protected readonly tabs = ['Headers', 'Body'] as const;
  protected readonly activeTab = signal<'Headers' | 'Body'>('Headers');
  protected readonly headers = signal<HeaderRow[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  protected readonly sending = signal(false);
  protected readonly response = signal<TestResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly Object = Object; // expose Object.keys/entries to template

  protected objectEntries(obj: Record<string, string>): [string, string][] {
    return Object.entries(obj);
  }

  protected addHeader(): void {
    this.headers.update((prev) => [...prev, { key: '', value: '', enabled: true }]);
  }

  protected removeHeader(index: number): void {
    this.headers.update((prev) => prev.filter((_, i) => i !== index));
  }

  protected async send(): Promise<void> {
    if (!this.url.trim() || this.sending()) return;
    this.sending.set(true);
    this.response.set(null);
    this.error.set(null);

    try {
      const headerMap: Record<string, string> = {};
      for (const row of this.headers()) {
        if (row.enabled && row.key.trim()) {
          headerMap[row.key.trim()] = row.value;
        }
      }
      const result = await this.ipc.sendRequest({
        method: this.method,
        url: this.url.trim(),
        headers: headerMap,
        body: this.body.trim() || null,
      });
      if (result.error) {
        this.error.set(result.error);
      } else {
        this.response.set(result);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.sending.set(false);
    }
  }

  protected prettyBody(res: TestResponse): string {
    if (!res.body) return '';
    const ct = res.headers['content-type'] ?? '';
    if (ct.includes('json')) {
      try { return JSON.stringify(JSON.parse(res.body), null, 2); } catch { /* fall through */ }
    }
    return res.body;
  }

  protected statusCodeClass(code: number): string {
    if (code < 300) return 'text-[rgb(var(--status-2xx))]';
    if (code < 400) return 'text-[rgb(var(--status-3xx))]';
    if (code < 500) return 'text-[rgb(var(--status-4xx))]';
    return 'text-[rgb(var(--status-5xx))]';
  }
}
