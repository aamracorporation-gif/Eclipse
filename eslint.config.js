// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "supabase/functions/**"],
  }
  ,
  {
    rules: {
      'import/no-unresolved': 'off',
      'import/no-duplicates': 'off',
      'import/namespace': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    files: ['backend/**/*.js', 'scripts/**/*.cjs'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
    rules: {
      'expo/no-dynamic-env-var': 'off',
    },
  },
  {
    files: ['__tests__/**/*.ts', '__tests__/**/*.tsx'],
    rules: {
      // Jest module-isolation tests intentionally require modules after mocks
      // and resetModules calls; static imports would change their semantics.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
