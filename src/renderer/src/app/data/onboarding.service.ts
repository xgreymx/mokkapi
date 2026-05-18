import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { WorkspaceStore } from './workspace.store';

interface OnboardingStep {
  title: string;
  description: string;
  route: string;
  locationLabel: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    route: '/services',
    title: 'Services',
    description: 'Create services, edit their basic settings, start or stop them, and manage endpoints from this view.',
    locationLabel: 'Services page',
  },
  {
    route: '/history',
    title: 'Request Inspector',
    description: 'Inspect live traffic, filter requests, clear the log, or remove a single entry without wiping the full history.',
    locationLabel: 'Request Inspector',
  },
  {
    route: '/test-client',
    title: 'Test Client',
    description: 'Send requests to your mock services directly from the app and validate responses without leaving mokkapi.',
    locationLabel: 'Test Client',
  },
  {
    route: '/imports',
    title: 'OpenAPI Import',
    description: 'Import an OpenAPI file to bootstrap a service faster instead of creating every endpoint manually.',
    locationLabel: 'Import OpenAPI',
  },
  {
    route: '/settings',
    title: 'Settings and HTTPS',
    description: 'Settings centralizes theme, workspace options, history retention, HTTPS certificate management, and this onboarding replay.',
    locationLabel: 'Settings',
  },
];

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly router = inject(Router);
  private readonly store = inject(WorkspaceStore);

  readonly visible = signal(false);
  readonly stepIndex = signal(0);
  readonly steps = ONBOARDING_STEPS;
  readonly currentStep = computed(() => this.steps[this.stepIndex()] ?? null);
  readonly isLastStep = computed(() => this.stepIndex() >= this.steps.length - 1);

  private autoStarted = false;
  private returnUrl = '/services';

  constructor() {
    effect(() => {
      const settings = this.store.settings();
      if (!settings || settings.onboardingCompletedAt !== null || this.autoStarted) {
        return;
      }

      this.autoStarted = true;
      queueMicrotask(() => {
        void this.start();
      });
    });
  }

  async start(): Promise<void> {
    this.returnUrl = this.normalizeRoute(this.router.url);
    this.visible.set(true);
    await this.activateStep(0);
  }

  async next(): Promise<void> {
    if (this.isLastStep()) {
      await this.complete();
      return;
    }
    await this.activateStep(this.stepIndex() + 1);
  }

  async back(): Promise<void> {
    if (this.stepIndex() === 0) return;
    await this.activateStep(this.stepIndex() - 1);
  }

  async dismiss(): Promise<void> {
    await this.complete();
  }

  private async activateStep(index: number): Promise<void> {
    this.stepIndex.set(index);
    const step = this.steps[index];
    if (!step) return;
    await this.router.navigateByUrl(step.route);
  }

  private async complete(): Promise<void> {
    this.visible.set(false);
    if (this.store.settings()?.onboardingCompletedAt === null) {
      await this.store.updateSettings({ onboardingCompletedAt: Date.now() });
    }
    await this.router.navigateByUrl(this.returnUrl || '/services');
  }

  private normalizeRoute(url: string): string {
    if (!url || url === '/') return '/services';
    return url.split('?')[0].split('#')[0] || '/services';
  }
}