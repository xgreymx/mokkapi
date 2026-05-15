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
  templateUrl: './test-client-page.component.html',
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
  protected readonly Object = Object;

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
