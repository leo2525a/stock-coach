import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // Native (Capacitor) project. `ios/App/App/public` is a copy of the built
      // web app; the SPM/Pods scaffolding is generated. Neither is our source.
      'ios/**',
      'android/**',
      'evidence/**',
      '.cache/**',
      'dev-dist/**',
      // Throwaway probes live here; never part of the deliverable.
      'tmp/**',
      // Independent QA's own probe scripts + logs. Not part of the shipped
      // deliverable, and deliberately left in place as their evidence.
      'review-evidence/**',
      'scripts/evidence-chart.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // On as an error, not a warning: SPEC requires a clean lint run, and a
      // stale closure in the chart is exactly the kind of bug that only shows
      // up in production. Intentional exceptions carry a targeted disable.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Plain-JS build scripts run under Node, not the browser.
    files: ['scripts/**/*.mjs', '*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // The browser-evidence harness is Node, but its `page.evaluate()` callbacks
    // are serialised into a real page and therefore touch DOM globals. Both
    // sets are legitimate for these files. `evidence-chart.mjs` is ignored
    // above; the colour harness needs the same treatment as the phase-3 one.
    files: ['scripts/evidence-phase3.mjs', 'scripts/evidence-colour.mjs', 'scripts/evidence-phase4.mjs', 'scripts/evidence-phase5.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
