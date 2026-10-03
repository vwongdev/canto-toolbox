import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';

// src/ domains import only from src/shared/; see .claude/agents/domain-reviewer.md
const DOMAINS = ['dictionary', 'popup', 'ocr', 'offscreen', 'stats', 'flashcards', 'settings'];

function importsOnlyShared(domain, { files = [`src/${domain}/**/*.ts`], allow = [] } = {}) {
  const group = [
    ...DOMAINS.filter((other) => other !== domain).map((other) => `../${other}/**`),
    ...allow.map((path) => `!../${path}`),
  ];
  return {
    files,
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group, message: 'A domain imports only from src/shared/ — see .claude/agents/domain-reviewer.md.' }],
      }],
    },
  };
}

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      'import-x': importX,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      'import-x/extensions': ['error', 'ignorePackages', { ts: 'never', js: 'always' }],
    },
  },
  {
    files: ['src/**'],
    rules: {
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
  ...['dictionary', 'popup', 'ocr', 'stats', 'flashcards', 'settings'].map((domain) => importsOnlyShared(domain)),
  importsOnlyShared('popup', { files: ['src/popup/content.ts'], allow: ['ocr/media-controller.js'] }),
  importsOnlyShared('offscreen', { allow: ['dictionary/offscreen-handler.js', 'ocr/offscreen.js'] }),
  importsOnlyShared('shared', { files: ['src/shared/**/*.ts'] }),
  {
    files: ['src/service-worker.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^\\./(?!shared/|[^/]+/background-handler\\.js$)',
          message: 'The service worker imports only feature background handlers and src/shared/.',
        }],
      }],
    },
  },
  {
    files: ['src/background-firefox.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^\\./(?!service-worker\\.js$|offscreen/offscreen\\.js$)',
          message: "Firefox's background page imports only the two composition roots.",
        }],
      }],
    },
  },
  {
    ignores: ['dist/**', 'dist-firefox/**', 'src/data/**', 'build-tools/dist/**', 'node_modules/**'],
  }
);
