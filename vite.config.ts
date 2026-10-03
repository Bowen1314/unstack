import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app lives in web/. In development the Unstack server mounts Vite as
// middleware (one port); `npm run build` writes static files to dist/web.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
  },
});
