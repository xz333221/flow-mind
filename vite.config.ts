import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'
  const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': r('./src'),
      },
    },
    server: {
      port: 7851,
      strictPort: true,
      host: '0.0.0.0',
    },
    build: isLib
      ? {
          lib: {
            entry: r('src/entry.ts'),
            name: 'FlowMind',
            fileName: (format) => `flow-mind.${format}.js`,
            formats: ['es', 'umd'],
          },
          rollupOptions: {
            external: ['vue'],
            output: {
              exports: 'named',
              globals: { vue: 'Vue' },
              assetFileNames: (assetInfo) =>
                assetInfo.name === 'style.css' ? 'style.css' : 'assets/[name][extname]',
            },
          },
          cssCodeSplit: false,
        }
      : {
          outDir: 'demo-dist',
        },
  }
})
