import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Match the app's Vite config: the automatic JSX runtime, so TSX test files
  // (and the components they import) compile without an explicit React import.
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // mcp/notion ships its own runner (node --test); root vitest must not collect it.
    exclude: ['**/node_modules/**', 'mcp/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
