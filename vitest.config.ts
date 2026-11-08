import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The React plugin makes JSX transform correctly inside .tsx tests.
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Per-file environment: DOM tests declare `@vitest-environment jsdom` in a
    // docblock, so the rest of the suite stays fast and Node-native.
    reporters: ['default'],
    globals: false,
  },
});
