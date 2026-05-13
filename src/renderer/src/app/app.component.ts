/**
 * AppComponent = shell layout.
 * Contains: left icon rail, top bar, and the lazy-loaded page content via router-outlet.
 * All navigation lives here so it's always visible.
 */

import {
  Component,
  inject,
  computed,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from './data/theme.service';
import { WorkspaceStore } from './data/workspace.store';

interface NavItem {
  path: string;
  icon: string;   // inline SVG path (d attribute)
  label: string;
  viewBox?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <!-- Root layout: fixed rail + flex column (top bar + page) -->
    <div class="flex h-screen overflow-hidden surface">

      <!-- ── Left icon rail ──────────────────────────────────────────────── -->
      <nav class="flex flex-col items-center py-3 gap-1 border-r border-[rgb(var(--border))]"
           style="width: var(--rail-width); flex-shrink: 0;">

        <!-- App logo mark -->
        <div class="w-8 h-8 mb-2 flex items-center justify-center">
          <span class="text-[rgb(var(--primary))] font-bold text-sm font-mono leading-none select-none">mk</span>
        </div>

        <div class="w-6 h-px bg-[rgb(var(--border))] mb-1"></div>

        <!-- Main nav items -->
        @for (item of navItems; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active"
             class="rail-btn group relative"
             [title]="item.label"
             [attr.aria-label]="item.label">
            <svg [attr.viewBox]="item.viewBox ?? '0 0 24 24'" width="18" height="18"
                 fill="none" stroke="currentColor" stroke-width="1.75"
                 stroke-linecap="round" stroke-linejoin="round">
              <path [attr.d]="item.icon" />
            </svg>
          </a>
        }

        <!-- Push theme toggle to bottom -->
        <div class="flex-1"></div>

        <button class="rail-btn"
                (click)="theme.toggle()"
                [title]="theme.resolved() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
                aria-label="Toggle theme">
          @if (theme.resolved() === 'dark') {
            <!-- Sun icon -->
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.75"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
          } @else {
            <!-- Moon icon -->
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                 stroke="currentColor" stroke-width="1.75"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          }
        </button>
      </nav>

      <!-- ── Main area: top bar + routed page ───────────────────────────── -->
      <div class="flex flex-col flex-1 overflow-hidden min-w-0">

        <!-- Top bar -->
        <header class="flex items-center justify-between px-4 border-b border-[rgb(var(--border))] surface-el"
                style="height: var(--topbar-height); flex-shrink: 0;">

          <!-- Left: app name + workspace -->
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm tracking-tight text-[rgb(var(--text))]">mokkapi</span>
            @if (workspace.settings()) {
              <span class="text-xs text-[rgb(var(--text-muted))] font-mono">
                {{ runningCount() }} running
              </span>
            }
          </div>

          <!-- Right: active service status indicators (up to 5 dots) -->
          <div class="flex items-center gap-3">
            @for (svc of workspace.servicesWithStatus().slice(0, 5); track svc.id) {
              <div class="flex items-center gap-1.5 text-xs text-[rgb(var(--text-muted))]">
                <span [class]="statusDotClass(svc.status.status)"></span>
                <span class="font-mono">:{{ svc.port }}</span>
              </div>
            }
          </div>
        </header>

        <!-- Page content -->
        <main class="flex-1 overflow-hidden">
          @if (workspace.loading()) {
            <div class="flex items-center justify-center h-full text-[rgb(var(--text-muted))] text-sm">
              Loading workspace…
            </div>
          } @else if (workspace.error()) {
            <div class="flex flex-col items-center justify-center h-full gap-2">
              <p class="text-[rgb(var(--status-5xx))] text-sm font-medium">Failed to load workspace</p>
              <p class="text-[rgb(var(--text-muted))] text-xs font-mono">{{ workspace.error() }}</p>
            </div>
          } @else {
            <router-outlet />
          }
        </main>
      </div>
    </div>
  `,
})
export class AppComponent implements OnDestroy {
  protected readonly theme = inject(ThemeService);
  protected readonly workspace = inject(WorkspaceStore);

  protected readonly navItems: NavItem[] = [
    {
      path: '/services',
      label: 'Services',
      // Layers icon
      icon: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    },
    {
      path: '/history',
      label: 'Request Inspector',
      // List / activity icon
      icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    },
    {
      path: '/test-client',
      label: 'Test Client',
      // Send icon
      icon: 'M22 2 11 13M22 2 15 22 11 13 2 9l20-7z',
    },
    {
      path: '/imports',
      label: 'Import OpenAPI',
      // Upload cloud icon
      icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    },
    {
      path: '/settings',
      label: 'Settings',
      // Sliders icon
      icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    },
  ];

  protected readonly runningCount = computed(() =>
    Object.values(this.workspace.statuses()).filter((s) => s.status === 'running').length,
  );

  protected statusDotClass(status: string): string {
    switch (status) {
      case 'running':  return 'dot-running';
      case 'error':    return 'dot-error';
      case 'starting': return 'dot-starting';
      default:         return 'dot-stopped';
    }
  }

  ngOnDestroy(): void {
    this.workspace.destroy();
  }
}
