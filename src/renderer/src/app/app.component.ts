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
import { OnboardingService } from './data/onboarding.service';
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
  templateUrl: './app.component.html',
})
export class AppComponent implements OnDestroy {
  protected readonly theme = inject(ThemeService);
  protected readonly onboarding = inject(OnboardingService);
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
