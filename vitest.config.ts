import { defineConfig } from 'vitest/config';

// Claude Code sets CLAUDECODE; agent runs drop the expected-error logs and
// slow-test lines that otherwise fill their context on every run.
const agentRun = Boolean(process.env.CLAUDECODE);

export default defineConfig({
  css: {
    // Tests compile imported SCSS without vite.config.ts, so repeat its opt-in.
    preprocessorOptions: { scss: { api: 'modern-compiler' } },
  },
  test: {
    environment: 'node',
    silent: agentRun,
    slowTestThreshold: agentRun ? Infinity : 300,
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'dictionaries/**', '.workflows/**', '.claude/**', '.claire/**', '.direnv/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**', 'build-tools/**'],
      exclude: ['**/__tests__/**', '**/*.d.ts', 'src/__tests__/setup.ts'],
    },
  },
});
