import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // Needed so Vite doesn't try to optimize cannon-es WASM (it's pure JS)
  optimizeDeps: {
    include: ['three', 'cannon-es', 'socket.io-client'],
  },
});
