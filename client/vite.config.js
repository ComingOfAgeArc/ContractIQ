import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development, calls to /api/* are forwarded to the Express server,
    // so the browser sees one origin and we don't fight CORS locally.
    proxy: { '/api': 'http://localhost:5000' },
  },
});
