import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: media: thumb: preview:; media-src 'self' media: blob:; " +
  "font-src 'self' data:; connect-src 'self' media: thumb: preview:; worker-src 'self' blob:";

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5199, strictPort: true },
});
