import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'web/dist/**', 'coverage/**', 'node_modules/**', 'prisma/migrations/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['web/**/*.ts', 'web/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './web/tsconfig.json',
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.config.js', '**/*.config.ts'],
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['public/**/*.js'],
    languageOptions: {
      parserOptions: { project: false, projectService: false },
      globals: {
        crypto: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
      },
    },
  },
);
