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
  templateUrl: './imports-page.component.html',
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
