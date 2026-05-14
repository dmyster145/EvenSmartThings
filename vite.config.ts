import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = env.SMARTTHINGS_CONTROLS_API_ORIGIN || 'http://127.0.0.1:8787';
  const publicAppUrl = env.SMARTTHINGS_CONTROLS_PUBLIC_APP_URL || '';
  // App version is now imported directly from app.json via src/version.ts —
  // works in both dev and build, no global injection.

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        util: 'util',
      },
    },
    optimizeDeps: {
      include: ['util'],
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: false,
        },
      },
    },
    define: {
      __API_BASE_URL__: JSON.stringify(publicAppUrl),
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom/')) return 'vendor-react-dom';
            if (id.includes('node_modules/react/')) return 'vendor-react';
          },
        },
      },
    },
  };
});
