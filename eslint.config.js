// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Bot code is untrusted competitor content in any language — the platform never lints,
    // builds, or type-checks it. Docker-fixture "bots" used only to exercise the runtime in
    // tests, the worked examples under docs/guides/examples/, and plain-JS dev scripts under
    // scripts/ are the same story: standalone scripts run directly via `node` (or inside a
    // container), not part of the TS build/lint graph. quant-fusion-ui/serve.mjs is the
    // same story again — a plain-Node static file server run directly inside its Docker image.
    ignores: [
      '.claude/**',
      '**/dist/**',
      '**/node_modules/**',
      'bots/**',
      '.yarn/**',
      '**/test/fixtures/**/*.mjs',
      'docs/guides/examples/**',
      'scripts/**/*.mjs',
      'quant-fusion-ui/serve.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Each package's tsconfig.test.json covers both src/ and test/ with the repo's real
        // strict compiler options — deliberately not projectService's "default project" for
        // stray files, which runs without our strict settings and caps out on file count.
        project: [
          './apps/*/tsconfig.test.json',
          './packages/*/tsconfig.test.json',
          './packages/game-dev-toolkit/*/tsconfig.test.json',
          './packages/research/*/tsconfig.test.json',
          './packages/stock-market-4/*/tsconfig.test.json',
          './packages/stock-market-4/research/*/tsconfig.test.json',
          './games/*/tsconfig.test.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js', 'vitest.workspace.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The entropy boundary (docs/adr/0004-deterministic-randomness.md): true randomness may
    // only enter the system through packages/rng/src/entropy.ts. Everywhere else must derive
    // randomness from a seed, never call these directly — enforced here, not just by convention.
    ignores: ['packages/rng/src/entropy.ts', '**/test/**', '**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random() is banned outside packages/rng/src/entropy.ts — derive randomness from a seed via @quant-fusion/rng instead (docs/adr/0004-deterministic-randomness.md).',
        },
        {
          object: 'crypto',
          property: 'randomBytes',
          message:
            'crypto.randomBytes() is banned outside packages/rng/src/entropy.ts — that is the one entropy boundary (docs/adr/0004-deterministic-randomness.md).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:crypto',
              importNames: ['randomBytes'],
              message:
                'crypto.randomBytes() is banned outside packages/rng/src/entropy.ts (docs/adr/0004-deterministic-randomness.md).',
            },
          ],
        },
      ],
    },
  },
);
