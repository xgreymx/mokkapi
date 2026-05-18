import { Injectable, computed, inject, signal } from '@angular/core';
import type { CaTrustStatus } from '@shared/models';
import { IpcService } from '../ipc/ipc.service';

type FeedbackKind = 'info' | 'success' | 'error';

interface FeedbackState {
  kind: FeedbackKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class CertificateTrustService {
  private readonly ipc = inject(IpcService);

  readonly status = signal<CaTrustStatus | null>(null);
  readonly loading = signal(true);
  readonly installing = signal(false);
  readonly feedback = signal<FeedbackState | null>(null);
  readonly requiresInstall = computed(() => {
    const status = this.status();
    return !!status && !status.installed;
  });

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.status.set(await this.ipc.getCaTrustStatus());
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', message: this.toMessage(error) });
    } finally {
      this.loading.set(false);
    }
  }

  async install(): Promise<void> {
    this.installing.set(true);
    this.feedback.set({
      kind: 'info',
      message: 'Installing the local CA. Your system may ask for permission before continuing.',
    });

    try {
      const status = await this.ipc.installCa();
      this.status.set(status);
      this.feedback.set({
        kind: 'success',
        message: 'Local CA installed successfully. HTTPS services should now be trusted.',
      });
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', message: this.toMessage(error) });
    } finally {
      this.installing.set(false);
    }
  }

  async regenerate(): Promise<void> {
    this.loading.set(true);
    this.feedback.set({ kind: 'info', message: 'Generating a new local CA…' });

    try {
      await this.ipc.regenerateCa();
      const status = await this.ipc.getCaTrustStatus();
      this.status.set(status);
      this.feedback.set({
        kind: status.installed ? 'success' : 'info',
        message: status.installed
          ? 'Local CA regenerated and verified.'
          : 'Local CA regenerated. Install it again before using HTTPS.',
      });
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', message: this.toMessage(error) });
    } finally {
      this.loading.set(false);
    }
  }

  clearFeedback(): void {
    this.feedback.set(null);
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}