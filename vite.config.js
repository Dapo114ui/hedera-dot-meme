import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    global: 'globalThis',
    process: {
      env: {}
    },
    Buffer: ['buffer', 'Buffer']
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
      process: 'process/browser',
      util: 'util/'
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        markets: resolve(__dirname, 'markets.html'),
        launch: resolve(__dirname, 'launch.html'),
        leaderboard: resolve(__dirname, 'leaderboard.html'),
        portfolio: resolve(__dirname, 'portfolio.html')
      }
    }
  }
});
