import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * The three-layer architecture from CLAUDE.md is enforced here, not by convention.
 *
 *   src/engine/      pure TypeScript simulation. Owns all game state.
 *   src/canvas/      the R3F board. Reads engine state in useFrame.
 *   src/components/  the HUD. Reads only the 4 Hz snapshot from src/store.
 *
 * Data flows one way, and the engine imports none of the layers above it.
 */

/** Everything src/engine may not import: the React/three/zustand world, and the layers above it. */
const forbiddenInEngine = [
  'react',
  'react-dom',
  'react-dom/*',
  'three',
  'three/*',
  '@react-three/*',
  'zustand',
  'zustand/*',
  // Relative hops out of the engine, e.g. '../store/uiStore' or '../../canvas/paths'.
  '**/canvas',
  '**/canvas/**',
  '**/components',
  '**/components/**',
  '**/store',
  '**/store/**',
]

/** Math.random, Date.now and performance.now are banned in the engine by D23. */
const clockAndRandom = [
  {
    object: 'Math',
    property: 'random',
    message: 'The engine is deterministic (D23). Use the seeded RNG in src/engine/rng.ts.',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'The engine has no wall clock (D23). Game time is the tick count.',
  },
  {
    object: 'performance',
    property: 'now',
    message: 'The engine has no wall clock (D23). Game time is the tick count.',
  },
]

export default tseslint.config(
  // design/ is the static export of the design canvas (D37): reference only, never linted or imported.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'design/**'] },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // The React layers: canvas and components.
  {
    files: ['src/canvas/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },

  // The engine layer: pure, deterministic, no UI.
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: forbiddenInEngine,
              message:
                'src/engine is pure TypeScript: no react, three, @react-three/*, zustand, or src/canvas, src/components, src/store (CLAUDE.md).',
            },
          ],
        },
      ],
      'no-restricted-properties': ['error', ...clockAndRandom],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'The engine has no wall clock (D23). Game time is the tick count.',
        },
      ],
      // CLAUDE.md code style: no non-null assertions in engine code.
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  // Engine tests keep the import rules, but regain a clock so they can measure
  // tick-loop performance (Session 1: a 6,000-tick run must stay under 200 ms).
  {
    files: ['src/engine/__tests__/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...clockAndRandom.filter((r) => r.object === 'Math'),
      ],
      'no-restricted-syntax': 'off',
    },
  },
)
