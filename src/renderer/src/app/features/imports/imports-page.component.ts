/**
 * ImportsPage — drag-and-drop or file-picker for an OpenAPI 3 YAML/JSON file.
 * Full import logic lives in Part 2 (main process openapi3.ts importer).
 * This component wires up the UI flow and calls the IPC stub.
 */

import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router } from '@angular/router';
import { IpcService } from '../../ipc/ipc.service';
import type { ImportResult } from '@shared/models';

@Component({
  selector: 'app-imports-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center h-full px-8 gap-6 max-w-lg mx-auto">

      <div class="text-center">
        <h2 class="font-semibold text-base mb-1">Import OpenAPI Spec</h2>
        <p class="text-sm text-[rgb(var(--text-muted))]">
          Drop an OpenAPI 3 YAML or JSON file to create a service with all its endpoints pre-populated.
        </p>
      </div>

      <!-- Drop zone -->
      <div (dragover)="$event.preventDefault()"
           (drop)="onDrop($event)"
           class="w-full border-2 border-dashed border-[rgb(var(--border))] rounded-lg
                  flex flex-col items-center justify-center gap-3 py-12 px-6 text-center
                  hover:border-[rgb(var(--primary))] hover:bg-[rgb(var(--primary)/0.03)]
                  transition-colors cursor-pointer"
           (click)="openFilePicker()">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none"
             stroke="currentColor" stroke-width="1.25"
             class="text-[rgb(var(--text-muted))]"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
        <div>
          <p class="text-sm font-medium text-[rgb(var(--text))]">Drop file here or click to browse</p>
          <p class="text-xs text-[rgb(var(--text-muted))] mt-0.5">.yaml, .yml, .json</p>
        </div>
      </div>

      <!-- Result -->
      @if (result()) {
        <div class="w-full rounded border border-[rgb(var(--status-2xx)/0.3)]
                    bg-[rgb(var(--status-2xx)/0.06)] p-4">
          <p class="text-sm font-medium text-[rgb(var(--status-2xx))] mb-1">Import successful</p>
          <p class="text-xs text-[rgb(var(--text-muted))]">
            Created service <strong>{{ result()!.serviceName }}</strong> with
            {{ result()!.endpointsCreated }} endpoint(s).
          </p>
          @if (result()!.warnings.length > 0) {
            <ul class="mt-2 text-xs text-[rgb(var(--status-4xx))]">
              @for (w of result()!.warnings; track $index) {
                <li>⚠ {{ w }}</li>
              }
            </ul>
          }
          <button (click)="goToServices()"
                  class="mt-3 text-xs text-[rgb(var(--primary))] hover:underline">
            View service →
          </button>
        </div>
      }

      @if (importError()) {
        <div class="w-full rounded border border-[rgb(var(--status-5xx)/0.3)]
                    bg-[rgb(var(--status-5xx)/0.06)] p-4">
          <p class="text-sm font-medium text-[rgb(var(--status-5xx))]">Import failed</p>
          <p class="text-xs text-[rgb(var(--text-muted))] mt-1 font-mono">{{ importError() }}</p>
        </div>
      }

      @if (loading()) {
        <p class="text-sm text-[rgb(var(--text-muted))] animate-pulse">Importing…</p>
      }
    </div>
  `,
})
export class ImportsPageComponent {
  private readonly ipc = inject(IpcService);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly importError = signal<string | null>(null);

  protected async openFilePicker(): Promise<void> {
    const path = await this.ipc.openImportDialog();
    if (path) await this.doImport(path);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    // In Electron, File.path is available on dropped files
    const path = (file as File & { path?: string }).path;
    if (path) await this.doImport(path);
  }

  private async doImport(filePath: string): Promise<void> {
    this.loading.set(true);
    this.result.set(null);
    this.importError.set(null);
    try {
      const res = await this.ipc.importOpenApi(filePath);
      this.result.set(res);
    } catch (err) {
      this.importError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected goToServices(): void {
    this.router.navigate(['/services']);
  }
}
