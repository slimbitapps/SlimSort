import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sicherheitsregeln (CSP) setzt Tauri selbst – siehe src-tauri/tauri.conf.json
export default defineConfig({
  base: './',
  plugins: [
    react(),
  ],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5199, strictPort: true },
});
