import { Injectable, signal, effect, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { AppTheme } from '@shared/models';

type ResolvedTheme = 'dark' | 'light';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);

  /** Persisted preference ('system' means follow OS) */
  readonly preference = signal<AppTheme>('system');

  /** The theme actually applied to the document right now */
  readonly resolved = signal<ResolvedTheme>('dark');

  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // Restore from localStorage
    const stored = localStorage.getItem('mokkapi-theme') as AppTheme | null;
    if (stored) this.preference.set(stored);

    // Set up OS-preference listener
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaListener = () => {
      if (this.preference() === 'system') this.apply();
    };
    this.mediaQuery.addEventListener('change', this.mediaListener);

    // Reactively apply whenever preference changes
    effect(() => {
      this.preference(); // track
      this.apply();
    });
  }

  setTheme(theme: AppTheme): void {
    this.preference.set(theme);
    localStorage.setItem('mokkapi-theme', theme);
  }

  toggle(): void {
    this.setTheme(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private apply(): void {
    const pref = this.preference();
    const resolved: ResolvedTheme =
      pref === 'system'
        ? (this.mediaQuery?.matches ?? true) ? 'dark' : 'light'
        : pref;

    this.resolved.set(resolved);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }
}
