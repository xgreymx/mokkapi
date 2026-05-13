import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { WorkspaceStore } from './data/workspace.store';
import { ThemeService } from './data/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // Batch DOM updates via zone.js event coalescing
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Use hash routing (#/services) so Electron's file:// protocol doesn't break on reload
    provideRouter(routes, withHashLocation()),

    // Initialise the theme and workspace before the first route renders
    {
      provide: APP_INITIALIZER,
      useFactory: (theme: ThemeService, workspace: WorkspaceStore) => async () => {
        // ThemeService applies theme in its constructor; just ensure it's constructed
        void theme;
        await workspace.init();
      },
      deps: [ThemeService, WorkspaceStore],
      multi: true,
    },
  ],
};
