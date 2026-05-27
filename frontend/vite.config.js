import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['crypto', 'stream', 'buffer', 'util', 'events'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: { global: 'globalThis' },
  build: {
    rollupOptions: {
      output: {
        // Don't code-split Circle SDK — bundle it all together
        manualChunks: undefined,
      },
    },
  },
})