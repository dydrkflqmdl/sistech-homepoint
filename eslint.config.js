// ESLint 설정(flat config). 실수 잡기용 최소 규칙만 켠다: 정의 안 된 이름, 안 쓰는 변수, 빈 블록.
// 실행: npm run lint
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  // 밑줄로 시작하는 이름은 일부러 안 쓰는 값(자리 채우기)으로 본다. catch (e) 의 e 는 안 써도 된다.
  // const { a, ...rest } = o 처럼 나머지를 얻으려고 뺀 칸(a)도 허용한다.
  'no-unused-vars': [
    'error',
    { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
  ],
  // 빈 블록 금지. 왜 비웠는지 주석이 있으면 허용된다(ESLint 기본 동작). 빈 catch 도 같다: catch { /* 이유 */ }
  'no-empty': 'error',
};

export default [
  {
    ignores: [
      'node_modules/**', 'dist/**', 'public/vendor/**', 'public/config.js', 'supabase/.temp/**', 'e2e/shots/**', '**/*.ts',
      'android/**/build/**', 'android/.gradle/**', 'android/e2e/shots/**',
    ],
  },
  {
    // 브라우저에서 도는 화면 코드
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, kakao: 'readonly' },
    },
    rules,
  },
  {
    // Edge Function 로직(Deno 에서 돌지만 Deno 전용 API 는 index.ts 에만 있다)
    files: ['supabase/functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, Deno: 'readonly' },
    },
    rules,
  },
  {
    // 안드로이드 앱이 사이트 페이지에 심는 스크립트(모듈이 아닌 일반 스크립트)
    files: ['android/app/src/main/assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules,
  },
  {
    // Node 스크립트·테스트·설정
    files: ['scripts/**/*.{js,mjs}', 'test/**/*.js', 'supabase/tests/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules,
  },
  {
    // 헤드리스 E2E·안드로이드 에뮬레이터 점검: Node 에서 돌고, 페이지 안에서 실행할 함수도 함께 들어 있다.
    files: ['e2e/**/*.{js,mjs}', 'android/e2e/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules,
  },
];
