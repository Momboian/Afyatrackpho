// Vite settings for the website (development server and production build).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The website source code lives in the client folder.
  root: 'client',
  plugins: [react()],
  // npm run build writes the finished website to the dist folder, which the API server can serve.
  build: { outDir: '../dist', emptyOutDir: true },
  // Development server on port 5173. Any request to /api is passed on to the API server on port 4000.
  // If the API is not running, these requests fail with "Request failed (500)".
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    proxy: { '/api': `http://localhost:${process.env.PORT || 4000}` }
  }
});
