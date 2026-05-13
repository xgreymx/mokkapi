import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'services',
    pathMatch: 'full',
  },
  {
    path: 'services',
    loadComponent: () =>
      import('./features/services/services-page.component').then(
        (m) => m.ServicesPageComponent,
      ),
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./features/history/history-page.component').then(
        (m) => m.HistoryPageComponent,
      ),
  },
  {
    path: 'test-client',
    loadComponent: () =>
      import('./features/test-client/test-client-page.component').then(
        (m) => m.TestClientPageComponent,
      ),
  },
  {
    path: 'imports',
    loadComponent: () =>
      import('./features/imports/imports-page.component').then(
        (m) => m.ImportsPageComponent,
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings-page.component').then(
        (m) => m.SettingsPageComponent,
      ),
  },
  {
    path: '**',
    redirectTo: 'services',
  },
];
