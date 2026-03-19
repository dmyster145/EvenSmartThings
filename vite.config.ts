import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = env.SMARTTHINGS_CONTROLS_API_ORIGIN || 'http://127.0.0.1:8787';

  return {
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
    build: {
      target: 'es2022',
      outDir: 'dist',
    },
  };
});
