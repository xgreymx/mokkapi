import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import angular from '@analogjs/vite-plugin-angular';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [
      angular({ tsconfig: 'tsconfig.app.json' }),
      tailwindcss(),
    ],
    // Angular's zone.js must be imported in the entry point, not here
    optimizeDeps: {
      include: ['@angular/common', '@angular/core', '@angular/router', 'rxjs'],
    },
  },
});
