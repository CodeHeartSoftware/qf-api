import { defineConfig } from 'vitest/config';

// A self-contained config, deliberately NOT referenced by the root vitest.workspace.ts (which
// excludes bots/* on purpose — see that file's own comment). This bot's tests run only via
// `npm test` from inside this directory.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
