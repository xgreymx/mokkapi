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
import { CertificateTrustService } from '../../data/certificate-trust.service';
import { WorkspaceStore } from '../../data/workspace.store';
import { ThemeService } from '../../data/theme.service';
import { OnboardingService } from '../../data/onboarding.service';
import { IpcService } from '../../ipc/ipc.service';
import type { AppTheme } from '@shared/models';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './settings-page.component.html',
})
export class SettingsPageComponent implements OnInit {
  protected readonly store = inject(WorkspaceStore);
  protected readonly certTrust = inject(CertificateTrustService);
  protected readonly themeService = inject(ThemeService);
  protected readonly onboarding = inject(OnboardingService);
  private readonly ipc = inject(IpcService);

  protected portBase = 4000;
  protected retentionDays = 30;
  protected retentionRows = 100_000;
  protected readonly appVersion = signal('');

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
    this.appVersion.set(await this.ipc.getAppVersion());
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
    await this.certTrust.regenerate();
  }
}
