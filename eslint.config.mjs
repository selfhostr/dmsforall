// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.js',
      'apps/web/src/api/schema.d.ts',
      'apps/web/src/components/ui/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // `any` interdit : CONTRIBUTING.md impose des types stricts partout.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Les décorateurs NestJS s'appuient sur des classes vides et des paramètres injectés.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',

      // `consistent-type-imports` est DÉSACTIVÉE ici, et ce n'est pas une préférence de style.
      //
      // NestJS résout les dépendances du constructeur via les métadonnées émises par
      // `emitDecoratorMetadata`, qui a besoin de la valeur d'exécution de la classe. Or du point
      // de vue de TypeScript, une classe injectée n'apparaît QUE comme annotation de type — la
      // règle la considère donc comme un import de type et propose de la convertir.
      //
      // Appliquer ce correctif produit une panne à l'exécution, pas une erreur de compilation :
      // Nest lève « can't resolve dependencies … argument at index [0] is undefined », parfois
      // sur un seul point d'entrée, ce qui la rend coûteuse à diagnostiquer. La documentation de
      // Nest cite explicitement `import type` comme cause n°1 de cette panne.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Seules les deux règles historiques de `eslint-plugin-react-hooks` (règles des hooks +
      // exhaustivité des dépendances). La version 7 du paquet embarque désormais aussi les
      // règles du React Compiler (purity, immutability, set-state-in-effect, etc.) : les activer
      // serait une adoption d'outillage à part entière, pas un correctif mécanique — à évaluer
      // séparément par expert-react si souhaité.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
