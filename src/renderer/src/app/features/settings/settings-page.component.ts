/**
 * SettingsPage — workspace path, theme, port base, history retention, TLS/CA management.
 */

import {
  Component,
  inject,
  signal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceStore } from '../../data/workspace.store';
import { ThemeService } from '../../data/theme.service';
import { IpcService } from '../../ipc/ipc.service';
import type { AppTheme } from '@shared/models';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="h-full overflow-y-auto scrollbar-thin px-6 py-6 max-w-2xl">
      <h1 class="font-semibold text-base mb-6">Settings</h1>

      <!-- ── Appearance ──────────────────────────────────────────────────── -->
      <section class="mb-8">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))] mb-3">
          Appearance
        </h2>
        <div class="surface-el rounded-lg border border-[rgb(var(--border))] divide-y divide-[rgb(var(--border))]">

          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm font-medium">Theme</p>
              <p class="text-xs text-[rgb(var(--text-muted))]">
                Currently resolved: {{ themeService.resolved() }}
              </p>
            </div>
            <div class="flex gap-1 rounded-lg border border-[rgb(var(--border))] p-0.5 bg-[rgb(var(--bg))]">
              @for (opt of themeOptions; track opt.value) {
                <button (click)="setTheme(opt.value)"
                        class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
                        [class]="themeService.preference() === opt.value
                          ? 'bg-[rgb(var(--bg-elevated))] text-[rgb(var(--text))] shadow-sm'
                          : 'text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]'">
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>
        </div>
      </section>

      <!-- ── Workspace ───────────────────────────────────────────────────── -->
      <section class="mb-8">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))] mb-3">
          Workspace
        </h2>
        <div class="surface-el rounded-lg border border-[rgb(var(--border))] divide-y divide-[rgb(var(--border))]">

          <div class="flex items-center justify-between px-4 py-3">
            <div class="flex-1 min-w-0 mr-4">
              <p class="text-sm font-medium">Workspace folder</p>
              <p class="text-xs text-[rgb(var(--text-muted))] font-mono truncate mt-0.5">
                {{ store.settings()?.workspacePath }}
              </p>
            </div>
            <button (click)="openWorkspaceFolder()"
                    class="flex-shrink-0 px-2.5 py-1 text-xs border border-[rgb(var(--border))] rounded
                           text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] transition-colors">
              Open folder
            </button>
          </div>

          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm font-medium">Default port base</p>
              <p class="text-xs text-[rgb(var(--text-muted))]">New services increment from this port</p>
            </div>
            <input type="number" [(ngModel)]="portBase"
                   (change)="savePortBase()"
                   class="w-24 rounded border border-[rgb(var(--border))] px-2 py-1 text-sm
                          bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono text-right
                          focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
          </div>
        </div>
      </section>

      <!-- ── History ─────────────────────────────────────────────────────── -->
      <section class="mb-8">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))] mb-3">
          Request History
        </h2>
        <div class="surface-el rounded-lg border border-[rgb(var(--border))] divide-y divide-[rgb(var(--border))]">

          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm font-medium">Retention (days)</p>
              <p class="text-xs text-[rgb(var(--text-muted))]">Older entries are trimmed on launch</p>
            </div>
            <input type="number" [(ngModel)]="retentionDays"
                   (change)="saveRetention()"
                   class="w-20 rounded border border-[rgb(var(--border))] px-2 py-1 text-sm
                          bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono text-right
                          focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
          </div>

          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm font-medium">Max rows</p>
              <p class="text-xs text-[rgb(var(--text-muted))]">Oldest entries pruned beyond this limit</p>
            </div>
            <input type="number" [(ngModel)]="retentionRows"
                   (change)="saveRetention()"
                   class="w-28 rounded border border-[rgb(var(--border))] px-2 py-1 text-sm
                          bg-[rgb(var(--bg))] text-[rgb(var(--text))] font-mono text-right
                          focus:outline-none focus:ring-1 focus:ring-[rgb(var(--border-focus))]" />
          </div>
        </div>
      </section>

      <!-- ── HTTPS / Certificate Authority ──────────────────────────────── -->
      <section class="mb-8">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))] mb-3">
          HTTPS / Local CA
        </h2>
        <div class="surface-el rounded-lg border border-[rgb(var(--border))] divide-y divide-[rgb(var(--border))]">

          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm font-medium">Local CA certificate</p>
              <p class="text-xs text-[rgb(var(--text-muted))] font-mono mt-0.5 truncate max-w-xs">
                {{ caPath() }}
              </p>
            </div>
            <button (click)="regenerateCa()"
                    class="flex-shrink-0 px-2.5 py-1 text-xs border border-[rgb(var(--border))] rounded
                           text-[rgb(var(--text-muted))] hover:text-[rgb(var(--status-4xx))]
                           hover:border-[rgb(var(--status-4xx)/0.5)] transition-colors">
              Regenerate CA
            </button>
          </div>

          <!-- Trust instructions -->
          <div class="px-4 py-3">
            <p class="text-xs font-medium mb-2">Trust the CA (once, per machine)</p>
            <div class="rounded bg-[rgb(var(--bg))] border border-[rgb(var(--border))] px-3 py-2">
              <p class="text-xs font-mono text-[rgb(var(--text-muted))] mb-1">Windows (PowerShell as admin):</p>
              <pre class="text-xs font-mono text-[rgb(var(--text))] whitespace-pre-wrap break-all">certutil -addstore Root "{{ caPath() }}"</pre>
            </div>
          </div>
        </div>
      </section>

      <!-- ── About ───────────────────────────────────────────────────────── -->
      <section>
        <div class="surface-el rounded-lg border border-[rgb(var(--border))] px-4 py-3 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">mokkapi</p>
            <p class="text-xs text-[rgb(var(--text-muted))]">v0.1.0 — local-first Mock API workbench</p>
          </div>
          <a href="https://github.com" target="_blank"
             class="text-xs text-[rgb(var(--primary))] hover:underline">
            GitHub →
          </a>
        </div>
      </section>
    </div>
  `,
})
export class SettingsPageComponent implements OnInit {
  protected readonly store = inject(WorkspaceStore);
  protected readonly themeService = inject(ThemeService);
  private readonly ipc = inject(IpcService);

  protected portBase = 4000;
  protected retentionDays = 30;
  protected retentionRows = 100_000;
  protected readonly caPath = signal('');

  protected readonly themeOptions: { label: string; value: AppTheme }[] = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

  async ngOnInit(): Promise<void> {
    const s = this.store.settings();
    if (s) {
      this.portBase = s.defaultPortBase;
      this.retentionDays = s.historyRetentionDays;
      this.retentionRows = s.historyRetentionRows;
    }
    this.caPath.set(await this.ipc.getCaPath());
  }

  protected setTheme(theme: AppTheme): void {
    this.themeService.setTheme(theme);
    this.store.updateSettings({ theme });
  }

  protected savePortBase(): void {
    this.store.updateSettings({ defaultPortBase: this.portBase });
  }

  protected saveRetention(): void {
    this.store.updateSettings({
      historyRetentionDays: this.retentionDays,
      historyRetentionRows: this.retentionRows,
    });
  }

  protected openWorkspaceFolder(): void {
    this.ipc.openWorkspaceFolder();
  }

  protected async regenerateCa(): Promise<void> {
    await this.ipc.regenerateCa();
    this.caPath.set(await this.ipc.getCaPath());
  }
}
