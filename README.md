# HOME POINT NAVI (홈포인트 네비)

CSV로 받은 장소(홈포인트)를 지도에 저장하고, 장소마다 메모와 미션 진행을 관리하는 웹 사이트입니다. 장소를 누르면 카카오맵으로 넘겨 바로 길안내를 시작합니다. 휴대폰 브라우저에서 쓰는 것을 기준으로 만들었습니다.

화면 파일은 GitHub Pages(정적 호스팅)에 올리고, 데이터·로그인·실시간 반영은 Supabase가 맡습니다. 직접 운영하는 서버는 없습니다.

```
휴대폰 / PC 브라우저
  │
  ├─ 화면 파일(HTML·CSS·JS) ──▶ GitHub Pages     (정적 파일만, 데이터 없음)
  ├─ 로그인 · 데이터 · 실시간 ──▶ Supabase        (Postgres + Auth + Realtime)
  └─ 지도 그리기 ─────────────▶ 카카오맵 SDK

main 브랜치에 푸시 ──▶ GitHub Actions ──▶ 테스트 → DB 마이그레이션 → Pages 배포
```

## 사용 흐름

1. 로그인: 주소로 들어가면 아이디·비밀번호 로그인 화면이 나옵니다. 아이디는 한글(예: 손두병)입니다. 계정은 관리자가 화면의 "계정 관리"에서 만들어 준 것만 쓸 수 있습니다.
2. CSV 가져오기: 상단 "CSV 가져오기" 버튼을 누르거나 화면에 파일을 끌어다 놓습니다.
3. 확인: 지도에 핀이 찍히고, 아래(PC는 왼쪽) 목록에 CSV 순서대로 표시됩니다.
4. 선택: 목록이나 핀을 누르면 상세 정보가 열리고 지도가 그 위치로 이동합니다.
5. 관리: 상세 정보에서 메모를 남기고 미션별 기록을 저장합니다. 색은 고를 수 없고 미션 진행 상태에 따라 자동으로 정해집니다.
6. 길안내: "카카오맵 길찾기"를 누르면 카카오맵 앱의 자동차 길찾기가 목적지가 들어간 상태로 열립니다.

## 기능

- 로그인 / 로그아웃: 로그인한 사용자만 장소를 보고 고칠 수 있습니다. 로그인 상태는 브라우저에 유지되고, 로그아웃은 이 기기에서만 적용됩니다. 로그인이 만료되거나 권한이 없으면 안내 문구와 함께 로그인 화면으로 돌아갑니다.
- 한글 아이디 로그인: 이메일 대신 `손두병`처럼 한글·영문·숫자·밑줄 1~16자 아이디로 로그인합니다. 내부적으로는 아이디를 가짜 이메일 주소로 바꿔 Supabase Auth에 넘깁니다.
- 계정 관리(관리자만): 관리자 계정으로 로그인하면 상단에 "계정 관리" 버튼이 보입니다. 계정 목록(아이디, 만든 날, 마지막 로그인)을 보고, 새 계정을 만들고, 비밀번호를 재설정합니다. 관리자가 아닌 계정에는 버튼이 없고, 버튼 없이 직접 호출해도 서버가 거절합니다. 비밀번호 재설정은 그 계정을 모든 기기에서 로그아웃시킵니다(본인 것도 마찬가지).
- 로그인 기록: 모든 아이디의 로그인·로그아웃(아이디, 시각, 기기, IP)이 DB에 남습니다. 화면에는 보이지 않고, 관리자가 Supabase 대시보드 Table Editor의 `login_logs` 표에서만 봅니다.
- 실시간 반영: 다른 기기에서 장소나 미션 기록을 바꾸면 새로고침 없이 화면에 반영됩니다(Supabase Realtime). 탭으로 돌아올 때도(마지막 조회 후 5초가 지났으면) 목록을 한 번 더 새로 받아 놓친 변경을 메웁니다.
- CSV 가져오기: EUC-KR(엑셀 저장)과 UTF-8 모두 읽습니다. 파일은 브라우저에서 읽고, 장소 목록만 DB로 보냅니다. 같은 이름·같은 좌표의 장소는 중복 저장하지 않고, 잘못된 행은 몇 번째 줄이 왜 빠졌는지 보여 줍니다. 파일 크기는 10MB까지입니다.
  - 여러 파일을 한 번에 선택하거나 끌어다 놓을 수 있습니다. 고른 순서대로 하나씩 가져오고, 파일별 결과와 합계를 보여 줍니다. 한 파일이 잘못돼도 나머지는 계속 가져옵니다.
  - 가져오는 중에는 다른 파일을 받지 않습니다.
  - 머리글의 괄호 안 쉼표(`주소(팜맵 필지 기준, 인근)`)가 있어도 쉼표·탭 구분을 올바르게 판정합니다.
- 장소 목록은 시군별로 묶여 보이고 처음에는 모두 접혀 있습니다. 머리글(예: `태안 2미션`)을 누르면 펼쳐지고, 머리글에는 상태별(미진행·진행 중·완료) 장소 수가 점으로 표시됩니다. 장소를 고르거나 검색하면 해당 그룹이 자동으로 펼쳐지고(상태 분류는 접힌 채 걸러집니다), 제목을 누르거나 상태 분류를 바꾸면 다시 모두 접힙니다. 기준은 항상 "모두 접힌 상태"이며 새로고침 후에도 접힌 채 시작합니다.
- 색상(자동): 장소 색은 손으로 고르지 않습니다. 완료한 미션이 하나도 없으면 빨강(미진행), 일부만 완료하면 주황(진행 중), 전부 완료하면 초록(완료)으로 자동으로 바뀝니다. 미션이 없는 장소는 빨강입니다. 지도 핀, 목록, 필터에 바로 반영됩니다.
- 미션: CSV에 미션명이 있으면 장소 상세 정보의 메모 아래에 미션을 하나씩 펼쳐 보여 줍니다. `Q1_A_TA_SW__01_01 ~ _34` → `Q1_A_TA_SW__01_01`부터 `_34`까지 34개.
- 미션 진행: 장소 상세 정보의 미션 제목이 `미션 1/34`(완료/전체)로 표시됩니다. 미션을 누르면 바로 아래에 완료 체크, 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 적는 칸이 펼쳐지고 "저장"을 눌러야 저장됩니다("취소"는 입력을 버립니다). 이미 저장한 미션은 기록을 보여 주고 "수정" 버튼으로 다시 고칩니다. 완료한 미션은 목록에서 초록색으로 표시됩니다.
  - 완료에 체크한 채 저장하려면 이름, 비행시간, 사용한 배터리 번호, 마지막 배터리 남은 용량을 모두 적어야 합니다(화면과 DB 양쪽에서 막습니다). 완료를 체크하지 않은 기록은 일부만 적어도 저장됩니다.
  - 마지막 배터리 남은 용량은 0~100 숫자만 적습니다. 저장은 숫자로 하고 화면에서 `45%`처럼 `%`를 붙여 보여 줍니다.
  - 여러 기기에서 같은 미션을 고칠 때, 다른 기기가 먼저 저장했으면 덮어쓰지 않고 "다른 기기에서 먼저 바뀐 기록입니다"라고 알린 뒤 최신 저장값을 보여 줍니다. 확인하고 다시 저장을 누르면 저장됩니다.
  - 입력 중에 다른 미션·장소를 누르거나 Esc를 누르면 저장하지 않은 내용을 버릴지 묻습니다. 저장 중에는 입력 칸이 잠깁니다.
- 장소 목록과 상세 정보의 이름 옆에는 `미션 1/34 ┃ 남은 미션 개수 33` 배지가 붙습니다(완료/전체, 구분선 뒤는 남은 개수). 지도 메모 말풍선 앞에는 `1/34`(완료/전체)가 붙고, 메모가 없어도 미션이 있으면 진행도만 표시됩니다.
- 메모: 메모가 있는 장소는 지도 핀 위에 말풍선으로 메모 내용이 표시됩니다(두 줄까지). 지도를 많이 축소하면 글씨가 겹치지 않도록 선택한 장소의 메모만 보입니다.
- 지도 배경: 지도 오른쪽 위 버튼으로 지도 / 위성 / 하이브리드(위성+지명)를 바꾸고, 필지 버튼으로 지적편집도(필지 경계)를 겹쳐 봅니다. 마지막으로 고른 설정은 브라우저에 기억됩니다.
- 검색·필터: 이름, 주소, 전화번호, 메모로 검색하고 미진행·진행 중·완료 상태별로 골라 봅니다.
- 길안내: 카카오맵 길찾기(휴대폰에서는 카카오맵 앱의 자동차 길찾기), 카카오맵에서 보기.
- 내보내기: 저장된 장소를 CSV로 내려받습니다. 같은 형식이라 다시 가져올 수 있습니다. 상태(미진행/진행 중/완료)와 완료/전체 미션 수 열이 함께 나갑니다. 다시 가져올 때 이 두 열은 무시됩니다. 엑셀에서 수식으로 실행되지 않도록 `=`, `+`, `-`, `@`로 시작하는 글 칸 앞에는 `'`를 붙여 내보내고, 다시 가져올 때 뗍니다.
- 삭제: 장소 상세 정보 맨 아래 "이 장소 삭제".

## 기술 구성

| 구분 | 내용 |
| --- | --- |
| 화면 | 프레임워크 없는 HTML·CSS·JavaScript(ES 모듈). 정적 파일이라 GitHub Pages에서 그대로 서비스합니다. |
| 호스팅 | GitHub Pages. 배포 때 `scripts/build.mjs`가 `dist/`를 만듭니다. |
| 데이터 | Supabase Postgres. 화면은 `supabase-js`로 RPC 함수를 부릅니다. |
| 로그인 | Supabase Auth 이메일·비밀번호. 화면에서는 한글 아이디를 받아 가짜 이메일 주소(`xn--….@sistech.local`)로 바꿔 씁니다. 가입 화면은 없고 관리자가 계정을 만듭니다. |
| 계정 관리 | Supabase Edge Function `admin-users`. 화면이 로그인 토큰과 함께 부르면 함수가 Supabase 안에서 토큰과 관리자 표시를 검사한 뒤 Admin API로 계정을 만듭니다. service_role 키는 Supabase가 함수 실행 환경에 자동으로 넣어 주므로 우리 쪽 어디에도 저장하지 않습니다. |
| 실시간 | Supabase Realtime(`places`, `missions` 표의 변경을 구독) |
| 지도 | 카카오맵 JavaScript SDK(일반·위성·하이브리드·지적편집도). developers.kakao.com에서 무료 JavaScript 키를 받습니다. |
| 길안내 | 카카오맵 URL(별도 키 불필요) |
| 배포 | GitHub Actions(`.github/workflows/deploy.yml`) |
| 실행 환경 | Node.js 22.13 이상(로컬 개발 서버·빌드·테스트용) |

## 폴더 구조

```
public/                  GitHub Pages에 올라가는 화면 파일
  index.html             화면 뼈대
  app.js                 지도, 목록, 상세 정보, 로그인, 가져오기 화면
  api.js                 Supabase 연결(로그인, RPC 호출, 실시간 구독, 계정 관리 함수 호출)
  login-id.js            한글 아이디 ↔ 로그인 이메일 변환
  csv.js                 CSV 읽기(인코딩 판별, 열 인식, 이름 규칙), 내보내기
  kakao.js               카카오맵 연결
  coord.js               좌표 처리
  mission.js             미션명 풀이·진행도 계산
  palette.js             상태 색상표
  styles.css             스타일(휴대폰 → PC 순으로 반응형)
  config.js              빌드·실행 때 자동 생성(깃 제외)
scripts/
  dev.mjs                로컬 개발 서버(config.js 생성 + public/ 서빙)
  build.mjs              배포용 빌드(public/ → dist/, config.js 생성, 캐시 스탬프)
  write-config.mjs       환경변수 → config.js 생성기
  create-users.mjs       한글 아이디 계정 일괄 생성·관리자 지정(Supabase Admin API, 비상용)
  login-email.mjs        아이디 → 로그인 이메일 변환 출력
supabase/
  config.toml            Supabase 프로젝트 설정(Edge Function 설정 포함)
  functions/admin-users/ 계정 관리 Edge Function(index.ts 진입점, handler.js 처리 로직)
  migrations/            DB 구조 변경 이력(테이블, 권한, 함수, 관리자 지정)
  tests/                 마이그레이션 검증(run.sh, tests.sql 등)
test/                    자동 테스트(CSV 읽기, 미션명, 색상표, 빌드 스탬프, 아이디 변환, 계정 관리 함수)
samples/                 예시 CSV
.github/workflows/       자동 배포 워크플로
.env.example             로컬 설정 예시
```

## 로컬 실행

```bash
npm install
cp .env.example .env   # 아래 값을 채웁니다
npm start
```

`.env`에 넣을 값입니다. 실제 값은 깃에 올리지 않습니다(`.env`는 `.gitignore`에 있습니다).

| 변수 | 설명 |
| --- | --- |
| `PORT` | 개발 서버 포트. 4100으로 두세요. 카카오 개발자 콘솔에 `http://localhost:4100`이 등록되어 있어 포트를 바꾸면 지도가 뜨지 않습니다. |
| `KAKAO_JS_KEY` | 카카오맵 JavaScript 키. 비어 있으면 지도가 뜨지 않습니다(목록·미션 기능은 동작). |
| `SUPABASE_URL` | Supabase 프로젝트 URL. 필수. |
| `SUPABASE_ANON_KEY` | Supabase anon(공개) 키. 필수. |

- `npm start`(또는 `npm run dev`)를 실행하면 `public/config.js`가 `.env` 값으로 자동 생성되고, `http://localhost:4100`에서 `public/`을 정적으로 서빙합니다. 같은 와이파이의 휴대폰용 주소도 함께 출력됩니다(단, 카카오 콘솔에 등록하지 않은 주소에서는 지도가 뜨지 않습니다).
- `SUPABASE_URL` 또는 `SUPABASE_ANON_KEY`가 비어 있으면 어느 값이 비었는지 알려 주고 종료합니다.
- 서버가 매 요청마다 파일을 새로 읽으므로 화면 파일을 고치고 브라우저를 새로고침하면 바로 반영됩니다. `.env`를 바꿨다면 다시 켜세요.
- 로컬에서도 데이터는 Supabase에 있는 것을 그대로 씁니다(별도 로컬 DB 없음). 테스트 데이터를 쓰려면 별도 Supabase 프로젝트를 만들어 그 값을 `.env`에 넣으세요.
- 포트가 이미 쓰이고 있으면 "N번 포트를 이미 다른 프로그램이 쓰고 있습니다"를 출력하고 종료합니다.

## 테스트

```bash
npm test          # CSV 읽기, 미션명 풀이, 상태 색상표, 빌드(캐시 스탬프·APP_BUILD·version.json), supabase-js 번들, 아이디 변환, 계정 관리 함수 처리 로직
npm run lint      # ESLint: 정의 안 된 이름(no-undef), 안 쓰는 변수(no-unused-vars), 빈 블록(no-empty)
npm run test:sql  # Supabase 마이그레이션(테이블·권한·함수·관리자 지정) 검증
npm run vendor    # public/vendor/supabase-js.js 다시 만들기(supabase-js 버전을 바꿀 때만)
```

- `npm test`는 Node 내장 테스트 러너를 씁니다. 네트워크나 Supabase 연결이 필요 없습니다. 계정 관리 Edge Function은 처리 로직(`handler.js`)을 Deno 없이 가짜 Admin API로 검사합니다.
- `npm run lint`는 `eslint.config.js`의 최소 규칙만 검사합니다. 빈 블록은 왜 비웠는지 주석이 있으면 허용됩니다(`catch { /* 무시하는 이유 */ }`). `const { a, ...rest } = o`처럼 나머지를 얻으려고 뺀 이름과 `_`로 시작하는 이름은 안 써도 됩니다.
- `npm run test:sql`은 이 컴퓨터에 설치된 PostgreSQL 바이너리(`initdb`, `pg_ctl`, `psql`)로 임시 클러스터를 5499 포트에 띄우고, Supabase 환경을 흉내 낸 뒤 마이그레이션과 `supabase/tests/tests.sql`을 실행합니다. 끝나면 임시 클러스터를 내리므로 평소 쓰는 5432 서버는 건드리지 않습니다. Docker나 Supabase CLI는 필요 없습니다.
  - `pg_ctl`이 PATH에 없으면 `PGBIN` 환경변수로 경로를 알려 주세요(예: `PGBIN=/opt/homebrew/bin npm run test:sql`). 포트·임시 폴더는 `TEST_PG_PORT`, `TEST_PG_DATA`로 바꿉니다.
  - 새 테이블 자동 노출 설정이 꺼진 경우와 켜진 경우를 둘 다 돌려 어느 쪽에서도 권한이 새지 않는지 확인합니다.
  - 미션명 풀이는 `public/mission.js`와 SQL 함수의 결과가 같은지 비교합니다.
- `npm run vendor`는 devDependency로 받은 `@supabase/supabase-js`(2.119.0)를 esbuild로 묶어 `public/vendor/supabase-js.js`(ESM, `createClient`만 내보냄, 다른 파일을 부르지 않음)를 만들고 sha256을 `public/vendor/supabase-js.sha256`에 적습니다. 생성물은 커밋합니다. 화면이 CDN 대신 이 파일을 불러오게 해 CDN 장애에 흔들리지 않게 하려는 것입니다. 버전을 바꾸려면 `package.json`의 devDependency와 `scripts/vendor.mjs`의 `VERSION`을 함께 바꾸고 `npm install` → `npm run vendor` → 화면 전체(로그인·저장·실시간·계정 관리) 확인 순서로 합니다. `npm run vendor -- --check`는 파일을 바꾸지 않고 커밋된 번들이 다시 묶은 결과와 같은지만 봅니다.

### CI(GitHub Actions `테스트` 잡)에서 도는 것

| 순서 | 단계 | 명령 | 비고 |
| --- | --- | --- | --- |
| 1 | 단위 테스트 | `npm test` | |
| 2 | 린트 | `npm run lint` | |
| 3 | 번들 확인 | `node scripts/vendor.mjs --check` | `public/vendor/`를 손으로 고쳤거나 버전이 어긋나면 실패 |
| 4 | SQL 테스트 | `PGBIN=/usr/lib/postgresql/16/bin npm run test:sql` | 러너(ubuntu-latest)에 깔린 PostgreSQL 16 사용(운영은 17, 이 테스트가 쓰는 기능은 같음) |
| 5 | Edge Function 타입 검사 | `deno check --no-lock supabase/functions/admin-users/index.ts` | Deno 2.9.6 |
| 6 | 헤드리스 E2E | `CHROME_BIN=$(which google-chrome) E2E_PORT=4198 node e2e/run-all.mjs` | `e2e/run-all.mjs`가 저장소에 있을 때만. 실패하면 `e2e/shots/`를 아티팩트로 14일 보관 |

어느 하나라도 실패하면 마이그레이션과 배포는 실행되지 않습니다.

## Supabase 프로젝트 준비

처음 한 번만 하면 됩니다. 순서대로 확인하세요.

1. supabase.com에서 새 프로젝트를 만듭니다.
   - Region: Seoul(Northeast Asia)
   - Data API: 켬
   - "Automatically expose new tables"(새 테이블 자동 노출): 끔. 마이그레이션이 로그인한 사용자에게만 권한을 줍니다.
   - "Enable automatic RLS": 켬
   - 프로젝트를 만들 때 정하는 데이터베이스 비밀번호는 따로 적어 두세요(배포 Secrets에 씁니다).
2. Authentication → Sign In / Providers → Email에서 가입 허용(Allow new users to sign up)을 끕니다. 가입 화면이 없으니 외부 사람이 계정을 만들 수 없게 하는 설정입니다.
3. 관리자 계정을 하나 만듭니다. 나머지 계정은 배포 뒤 관리자가 화면의 "계정 관리"에서 만들면 되므로 처음에는 하나면 됩니다.
   - 대시보드에서 손으로: `npm run login-email -- 김용문`으로 변환된 이메일 주소를 뽑아, Authentication → Users → "Add user"에 그 주소와 비밀번호를 입력합니다. 이메일 인증 없이 바로 쓰도록 Auto Confirm User를 체크하세요.
   - 또는 스크립트로: Project Settings → API Keys에서 service_role 키를 복사해 `.env`의 `SUPABASE_SERVICE_ROLE_KEY`에 넣고(`SUPABASE_URL`도 채워져 있어야 합니다) 실행합니다. 이미 있는 아이디는 "이미 있음"으로 건너뛰고, 기존 계정의 비밀번호를 바꾸려면 `--reset-password`를 붙입니다. 다 쓰면 `.env`의 키 값은 비웁니다.

     ```bash
     npm run users -- --password <비밀번호> 김용문
     ```

   - 아이디 규칙: 한글·영문·숫자·밑줄 1~16자. 같은 아이디는 언제나 같은 주소가 되므로 로그인 화면에 아이디만 적으면 됩니다.
   - 비밀번호 최소 길이는 Supabase 설정(Authentication → Sign In / Providers → Email의 최소 길이, 기본 6자)을 따릅니다.
   - 주소는 가짜(`@sistech.local`)라 메일이 가지 않습니다. 그래서 비밀번호 찾기 메일은 쓸 수 없고, 비밀번호를 잊으면 관리자가 화면의 "계정 관리"에서 재설정합니다. 관리자 본인이 잊었으면 대시보드 Users에서 바꾸거나 `npm run users -- --password <새 비밀번호> --reset-password 김용문`을 씁니다.
4. 관리자를 지정합니다. 관리자 표시는 Supabase 사용자 정보의 `app_metadata.role = "admin"`이며, 브라우저에서는 바꿀 수 없고 아래 방법으로만 넣습니다.
   - 자동: 마이그레이션 `20261106170000_admin_role.sql`이 배포 때 김용문(`xn--4k0bz9vb1i@sistech.local`)에 관리자 표시를 넣습니다. 그 계정이 아직 없거나 DB 권한이 모자라면 배포를 멈추지 않고 알림만 남기므로, 아래 방법 중 하나로 직접 넣습니다.
   - 스크립트: `.env`에 service_role 키를 넣고 `npm run users -- --admin 김용문`(다른 사람을 관리자로 추가할 때도 같은 명령).
   - SQL Editor: `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}' where email = '<변환된 이메일>';`
   - 관리자 표시를 넣은 뒤에는 그 계정이 다시 로그인해야 "계정 관리" 버튼이 보입니다(로그인 정보가 갱신될 때 반영).
5. 아래 값을 확인해 둡니다.

| 값 | 위치 | 쓰는 곳 |
| --- | --- | --- |
| Project URL | Project Settings → API (또는 Connect 화면) | `SUPABASE_URL` |
| anon / publishable 키 | Project Settings → API Keys | `SUPABASE_ANON_KEY` |
| Project ID(Reference ID) | Project Settings → General | `SUPABASE_PROJECT_ID` |
| Access Token | 계정 메뉴 → Account Settings → Access Tokens에서 새로 발급 | `SUPABASE_ACCESS_TOKEN` |
| 데이터베이스 비밀번호 | 프로젝트 만들 때 정한 값. 잊었으면 Project Settings → Database에서 재설정 | `SUPABASE_DB_PASSWORD` |

> 경고: service_role 키와 secret 키는 비상용 스크립트(`npm run users`)를 돌릴 때만 로컬 `.env`에 넣고, 다 쓰면 값을 비웁니다. GitHub Secrets, `config.js`, 코드, 채팅에는 절대 넣지 마세요. 이 키는 RLS를 건너뛰는 관리자 키라 화면에 한 번이라도 들어가면 누구나 모든 데이터를 지울 수 있습니다. 화면에는 anon(공개) 키만 씁니다. 평소 계정 관리는 화면의 "계정 관리"로 하며, 그때 쓰이는 키는 Supabase가 Edge Function 안에만 넣어 두는 것이라 우리 손을 거치지 않습니다.

## 배포 (GitHub Actions)

`main` 브랜치에 푸시하면 자동으로 배포됩니다. 수동 실행(Actions → 배포 → Run workflow)도 됩니다. 워크플로 파일은 `.github/workflows/deploy.yml`(배포)과 `.github/workflows/weekly.yml`(주간 점검) 두 개입니다.

### 1. 저장소 설정

- Settings → Pages → Build and deployment → Source를 "GitHub Actions"로 바꿉니다.
- GitHub Free 요금제는 공개(public) 저장소에서만 Pages를 쓸 수 있습니다. 비공개 저장소는 유료 요금제가 필요합니다. 저장소가 공개여도 화면 파일에는 비밀이 없지만(아래 보안 구조 참고), 코드와 Actions 실행 기록·아티팩트가 공개된다는 점은 알고 계세요.
- Settings → Secrets and variables → Actions → New repository secret에서 아래 7개를 등록합니다.

| Secret 이름 | 용도 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI 로그인용 토큰. 마이그레이션·백업 단계에서만 씁니다. |
| `SUPABASE_DB_PASSWORD` | 데이터베이스 비밀번호. 마이그레이션·백업 단계에서만 씁니다. |
| `SUPABASE_PROJECT_ID` | 연결할 Supabase 프로젝트(Reference ID). |
| `SUPABASE_URL` | Project URL. 빌드 때 `config.js`에 들어가고, 가입 차단 확인·휴면 방지에도 씁니다. |
| `SUPABASE_ANON_KEY` | anon(공개) 키. 빌드 때 `config.js`에 들어가고, 가입 차단 확인·휴면 방지에도 씁니다. |
| `KAKAO_JS_KEY` | 카카오맵 JavaScript 키. 빌드 때 `config.js`에 들어갑니다. |
| `BACKUP_PASSPHRASE` | 주간 백업 암호화 비밀번호(20자 이상 무작위 권장). 없으면 백업이 실패하고 이슈가 열립니다. 잃어버리면 백업을 풀 수 없으니 비밀번호 관리자에 따로 보관하세요. |

- 권장(선택): Settings → Environments에서 `production` 환경을 만들고 Required reviewers(승인자)나 Deployment branches(main만)를 걸면, 마이그레이션 잡에 `environment: production`을 한 줄 추가해 DB를 바꾸기 전에 승인을 받게 할 수 있습니다. 이때 DB용 Secret 3개(`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`)를 저장소 Secret 대신 환경 Secret으로 옮기면 다른 워크플로가 쓸 수 없게 됩니다(그러면 `weekly.yml`의 백업 잡에도 같은 줄이 필요). 지금은 적용하지 않았습니다.
- 실패 알림: 배포나 주간 점검이 실패하면 워크플로가 저장소에 이슈(`[배포 실패] …`, `[주간 점검 실패] …`)를 엽니다. 같은 제목의 이슈가 열려 있으면 댓글만 답니다. 이슈 알림을 받으려면 저장소 오른쪽 위 Watch → All Activity(또는 Custom → Issues)를 켜 두세요. GitHub 앱(휴대폰)의 알림도 같이 옵니다.
- 액션 버전: 워크플로의 `uses:`는 모두 커밋 SHA로 고정하고 뒤에 `# v7.0.1` 같은 주석을 붙였습니다(태그가 옮겨져도 바뀌지 않게). `.github/dependabot.yml`이 매주 월요일 새 버전을 확인해 PR을 올리니, 테스트가 통과하면 합치면 됩니다. Supabase CLI도 `3.0.0`으로 고정했습니다. 올릴 때는 [CLI 릴리스 노트](https://github.com/supabase/cli/releases)의 Breaking changes를 확인하고 두 워크플로의 `version:`을 함께 바꿉니다.

### 2. 카카오 개발자 콘솔

developers.kakao.com → 내 애플리케이션 → 플랫폼 키 → Web의 사이트 도메인에 배포 주소를 추가합니다. 사용자 지정 도메인을 쓰면 그 주소(현재 `https://sistech.dpdns.org`), 아니면 `https://<계정>.github.io`입니다. 도메인은 주소의 출처(origin)만 적습니다. `/저장소이름` 경로는 붙이지 않습니다. 등록하지 않으면 배포 사이트에서 지도가 뜨지 않습니다. 제품 설정 → 카카오맵 → 사용 설정이 켜져 있어야 합니다. 도메인이 만료될 때를 대비해 `https://<계정>.github.io`도 미리 함께 등록해 두세요(아래 장애 대응 표).

### 3. 워크플로 흐름

```
테스트(npm ci → npm test → lint → 번들 확인 → SQL 테스트 → deno check → E2E[있을 때])
  └▶ DB 마이그레이션·함수 배포
       ├ 가입 차단 확인(auth/v1/settings 의 disable_signup 이 true 가 아니면 중단)
       ├ 바뀐 부분 확인(마지막 성공 배포 커밋과 비교)
       ├ supabase/migrations/** 또는 config.toml 이 바뀜 → supabase db push --remote --yes
       └ supabase/functions/** 또는 config.toml 이 바뀜 → supabase functions deploy admin-users
            └▶ 페이지 배포(build.mjs <커밋 해시 7자리> → dist 업로드 → Pages → version.json 확인)
                 └▶ (어디서든 실패하면) 실패 알림 이슈
```

- 테스트가 실패하면 DB와 사이트 모두 그대로입니다.
- **DB와 Edge Function은 페이지보다 먼저 바뀝니다.** 마이그레이션이 성공한 뒤 페이지 배포가 실패하면, 잠시 동안 새 DB 위에서 옛 화면이 돕니다. 그래서 마이그레이션은 **추가만** 하게 씁니다.
  - 새 표·새 칸(기본값 있음)·새 함수 추가: 옛 화면이 모르는 것이라 그대로 동작합니다.
  - 칸·함수의 이름 바꾸기, 지우기, 인자 바꾸기: 옛 화면이 깨집니다. 꼭 필요하면 두 번에 나눕니다. ① 새 것을 추가하고 화면이 새 것을 쓰게 배포 → ② 다음 배포에서 옛 것을 지웁니다.
  - 이미 적용된 마이그레이션 파일은 고치지 말고 새 파일을 추가하세요. `db push`는 아직 적용되지 않은 파일만 적용합니다.
- 비교 기준은 "이 워크플로가 마지막으로 성공한 커밋"입니다. 마이그레이션이 실패한 채 다른 커밋을 push해도, 다음 실행에서 그 마이그레이션까지 다시 적용합니다. 성공한 배포 기록을 못 찾거나 수동 실행이면 둘 다 실행합니다.
- 가입 차단 확인: Supabase에서 가입이 켜져 있으면(공개 anon 키로 누구나 계정을 만들 수 있는 상태) 마이그레이션도 배포도 하지 않습니다.
- 빌드는 `public/`을 `dist/`로 복사하고, Secrets 값으로 `config.js`를 새로 만들고, 다음을 붙입니다.
  - HTML·JS가 부르는 파일 뒤에 `?v=<커밋 해시>`. 배포할 때마다 주소가 달라져 브라우저가 옛 파일을 쓰지 않습니다. 스탬프를 붙일 수 없는 상대 import(예: ``import(`./${이름}.js`)``)가 남으면 빌드가 실패합니다.
  - `config.js`만은 `?v=<커밋 해시>-<내용 해시 8자>`. Secrets만 바꾸고 같은 커밋을 다시 배포(Run workflow)해도 새 값이 바로 내려갑니다.
  - `config.js` 끝의 `window.APP_BUILD = "<커밋 해시>"`와 `dist/version.json`(`{"build":"<커밋 해시>"}`). 화면이 지금 몇 번 배포인지 알 수 있고, 배포 마지막 단계가 사이트의 `version.json`이 이번 커밋을 가리키는지 5분까지 기다리며 확인합니다.
- 같은 배포가 겹치면 차례로 실행합니다. 진행 중인 배포는 끊지 않습니다.
- 배포 주소는 워크플로 실행 화면의 "페이지 배포" 단계 또는 Settings → Pages에서 볼 수 있습니다.

### 4. 실패했을 때·되돌리기

- 일시적인 실패(네트워크, Supabase 점검 등): Actions → 실패한 실행 → 오른쪽 위 **Re-run jobs → Re-run failed jobs**. 성공한 잡은 다시 돌지 않고 실패한 잡과 그 뒤 잡만 돕니다. 마이그레이션은 이미 적용된 것을 건너뛰므로 다시 돌려도 안전합니다.
- 실패 단계별 상태

| 멈춘 단계 | DB·함수 | 사이트 |
| --- | --- | --- |
| 테스트 | 그대로 | 그대로 |
| 가입 차단 확인 | 그대로 | 그대로 |
| 마이그레이션 적용 | 실패한 파일은 파일 단위 트랜잭션이라 통째로 취소되고, 그 앞 파일은 적용된 채 남음 | 그대로 |
| Edge Function 배포 | 마이그레이션은 적용됨, 함수는 옛 것 | 그대로 |
| 페이지 배포 | 새 것 | 옛 것(추가만 하는 마이그레이션이면 문제없음) |
| 배포 확인(version.json) | 새 것 | 대개 새 것. 도메인·Pages 설정 확인 |

- 되돌리기: 문제가 생긴 커밋을 `git revert <커밋>`으로 되돌리고 push하면 이전 화면과 이전 함수가 다시 배포됩니다. **마이그레이션은 되돌려지지 않습니다**(`db push`는 앞으로만 적용). DB 구조를 되돌려야 하면 되돌리는 마이그레이션을 새 파일로 추가하세요. 데이터를 되돌려야 하면 주간 백업(아래)에서 복원합니다.

### 5. 주간 점검(휴면 방지·백업)

`.github/workflows/weekly.yml`이 매주 월·목 새벽 3시 17분(KST)에 돕니다. Actions → 주간 점검 → Run workflow로 언제든 수동 실행할 수 있습니다.

- 휴면 방지: anon 키로 `rest/v1/places`(권한이 없어 401이 정상)와 `auth/v1/settings`를 부릅니다. 응답이 5xx이거나 연결이 안 되면(일시정지 의심), 또는 가입이 켜져 있으면 실패로 보고 이슈를 엽니다.
- 백업: `supabase db dump`로 `roles.sql`, `schema.sql`(우리 스키마 구조), `data.sql`(데이터, `auth.users`의 비밀번호 해시·로그인 기록 포함)을 받아 `BACKUP_PASSPHRASE`로 암호화(`openssl` AES-256, PBKDF2)한 뒤 Actions 아티팩트 `db-backup-<번호>`로 **90일** 보관합니다. 실제 DB에 접속하므로 이것도 휴면 방지가 됩니다.
  - 공개 저장소의 아티팩트는 GitHub에 로그인한 누구나 받을 수 있습니다. 그래서 암호화하지 않은 백업은 올리지 않고, 백업 파일은 절대 저장소에 커밋하지 않습니다.
  - 받기: Actions → 주간 점검 → 원하는 실행 → Artifacts에서 내려받아 압축을 풉니다(`.tar.gz.enc` 하나가 나옴).
  - 풀기: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in sistech-db-<날짜>.tar.gz.enc -out backup.tar.gz` → 비밀번호 입력 → `tar xzf backup.tar.gz`. macOS 기본 `openssl`로도 됩니다.
  - 복원(새 프로젝트 또는 비운 DB에): 새 프로젝트를 만들고 마이그레이션을 먼저 적용한 뒤(배포 워크플로 수동 실행), SQL Editor 대신 `psql`로 데이터를 넣습니다. 연결 문자열은 대시보드 Connect → Session pooler에서 복사합니다.

    ```bash
    psql "<연결 문자열>" -c 'SET session_replication_role = replica' -f data.sql
    ```

    `data.sql`에는 auth 스키마 데이터도 들어 있어 계정·비밀번호가 함께 돌아옵니다. 이미 있는 행과 겹치면 오류가 나므로 빈 DB에 넣으세요. `schema.sql`은 마이그레이션과 같은 구조를 확인하는 참고용입니다.
- **GitHub은 공개 저장소에 60일 동안 커밋 등 활동이 없으면 예약(schedule) 실행을 자동으로 멈춥니다.** 멈추면 저장소 Actions 화면에 경고가 뜨고 메일이 옵니다. Actions → 주간 점검 → "Enable workflow"를 누르면 다시 켜집니다. 두 달 넘게 코드를 고치지 않을 것 같으면 달력에 확인 일정을 넣어 두세요.

## DB 구조

테이블은 3개입니다. 모두 행 수준 보안(RLS)이 켜져 있고, 로그인한 사용자(`authenticated`)만 읽고 쓸 수 있습니다. 로그인하지 않은 사용자(`anon`)의 권한은 모두 거두었습니다.

| 표 | 내용 |
| --- | --- |
| `places` | 장소. 이름, 시군, 주소, 전화번호, 메모, 미션명, 위도, 경도. 같은 이름·같은 좌표는 한 번만 저장합니다(유일 제약). 글 칸은 각각 길이 제한이 있고 메모는 2000자까지입니다. 색 칸은 없습니다. |
| `missions` | 미션별 진행 기록. 완료 여부, 이름, 비행시간, 배터리 번호, 배터리 남은 용량(0~100), 저장 횟수(`version`). 장소와 미션명 조합당 한 줄이고, 처음 손댈 때 만들어지며, 장소를 지우면 함께 지워집니다. 완료로 저장하려면 네 칸이 모두 채워져야 하는 규칙이 표 제약으로도 걸려 있습니다. |
| `login_logs` | 로그인·로그아웃 기록. 시각, 아이디, 기기, IP. Supabase 세션 생성 트리거와 화면의 함수 호출로 이중 기록하고, 15초 안의 중복은 하나로 합칩니다. 읽기 정책이 없어 화면·API로는 아무도 읽지 못하고, 대시보드 Table Editor에서만 봅니다. 계정을 지워도 기록은 남습니다. |

화면은 표를 직접 만지지 않고 아래 함수(RPC)를 부릅니다. 함수는 모두 호출한 사용자의 권한으로 실행됩니다(`security invoker`). 그래서 RLS가 그대로 적용되고, 로그인하지 않으면 실행할 수 없습니다.

| 함수 | 입력 | 반환 | 오류·규칙 |
| --- | --- | --- | --- |
| `list_places()` | 없음 | 장소 배열(번호순). 각 장소에 `missions`(기록이 있는 미션만)와 미션 기록의 `version` 포함. 미션명은 CSV 그대로이고 펼치기는 화면이 합니다. | 없음 |
| `import_places(rows)` | CSV에서 읽은 장소 배열(이름, 시군, 주소, 전화, 메모, 미션명, 위도, 경도, `addressGiven`) | `{ imported, duplicates, updated, missionChanged }` | 한 트랜잭션입니다. 형식·좌표 오류가 있으면 몇 번째 장소인지 알리고 전부 되돌립니다. 같은 이름·좌표는 건너뛰고(`duplicates`), 시군·주소·미션명이 비어 있지 않고 다르면 그 칸만 바꿉니다(`updated`). 전화·메모·미션 기록은 그대로입니다. |
| `save_mission(place_id, mission, fields, base_version)` | 장소 번호, 미션명, 바꿀 칸 `{ done, worker, flightTime, batteryNo, batteryLeft }` 중 일부, 화면이 마지막으로 본 `version`(기록이 없었으면 null) | `{ status: "ok", record }` 또는 `{ status: "conflict", record }` | 기록이 없으면 새로 만들고(version 1) 있으면 들어온 칸만 바꾸며 version을 1 올립니다. 검사 순서는 장소 없음, 없는 미션, 형식, 버전 충돌, 남은 용량·완료 조건입니다. |
| `update_memo(place_id, memo)` | 장소 번호, 메모 | 바뀐 장소 1건(`list_places` 원소와 같은 모양) | 메모는 문자열이어야 하고 2000자로 자릅니다. 장소가 없으면 오류. |
| `delete_place(place_id)` | 장소 번호 | 지웠으면 true | 미션 기록도 함께 지워집니다. |
| `log_login(p_user_agent)` | 기기 정보 문자열(비우면 요청 헤더의 User-Agent) | `{ logged }` | 로그인 직후 화면이 부릅니다. 현재 사용자의 로그인 기록을 남기고, 세션 트리거가 15초 안에 이미 남겼으면 `logged: false`로 건너뜁니다. IP는 요청 헤더에서 채웁니다. |
| `log_logout()` | 없음 | `{ logged }` | 로그아웃 직전 화면이 부릅니다. 로그아웃 기록을 남기고 2초 안 중복은 건너뜁니다. |

오류 규칙

- 화면에 보여 줄 오류는 오류 코드 `P0001`과 한국어 메시지로 올라오고, 화면은 메시지를 그대로 보여 줍니다(예: `장소를 찾을 수 없습니다.`, `이 장소에 없는 미션입니다.`).
- 버전 충돌은 오류가 아니라 `status: "conflict"` 응답입니다. 같은 장소의 미션 저장은 장소 행을 잠가 줄 세우기 때문에, 동시에 두 기기가 저장하면 뒤에 온 쪽이 충돌로 판정되고 최신 기록을 돌려받습니다. 충돌이 나도 덮어쓰지 않습니다.
- 마지막 배터리 남은 용량은 0~100 숫자 문자열만 저장합니다.
- 좌표는 소수점 7자리(약 1cm)로 맞춰 저장해서 중복 판정이 부동소수 오차에 흔들리지 않습니다.
- 시각은 UTC ISO 8601 문자열로 내려줍니다.
- 실시간 구독 대상은 `places`, `missions` 두 표입니다.

### 계정 관리 함수 (Edge Function `admin-users`)

계정 만들기는 service_role 키가 있어야 해서 DB 함수가 아니라 Supabase Edge Function(`supabase/functions/admin-users/`)으로 둡니다. 화면은 `supabase-js`의 `functions.invoke('admin-users', { body })`로 부르고, 로그인 토큰은 자동으로 함께 갑니다.

- 권한: 함수가 Supabase 안에서 토큰을 검증하고(`auth.getUser`) 그 사용자의 `app_metadata.role`이 `admin`일 때만 처리합니다. 토큰이 없거나 틀리면 401, 관리자가 아니면 403입니다. 화면 버튼을 숨기는 것과 별개로 서버에서 막습니다.
- 요청(POST JSON): `{ action, login_id?, password?, user_id? }`

| action | 입력 | 성공 응답 | 오류 |
| --- | --- | --- | --- |
| `list` | 없음 | `{ ok: true, users: [{ id, login_id, email, created_at, last_sign_in_at, is_admin }] }` | — |
| `create` | `login_id`(아이디 규칙), `password`(6자 이상) | `{ ok: true, user }` | 400 규칙 위반, 409 이미 있는 아이디 |
| `reset_password` | `user_id`, `password` | `{ ok: true }` | 400 규칙 위반, 404 없는 계정 |

- 실패 응답은 해당 상태 코드와 `{ ok: false, error: "한국어 메시지" }`이고 화면은 메시지를 그대로 보여 줍니다.
- 아이디 → 이메일 변환 규칙은 `public/login-id.js`와 같습니다(함수 쪽에 같은 규칙을 두고, 두 결과가 같은지 테스트로 묶어 둡니다).
- 비밀번호 재설정은 Supabase가 그 계정의 세션을 모두 끊으므로 재설정된 사람은 다시 로그인해야 합니다.

## CSV 형식

첫 줄은 머리글입니다. 열 순서는 상관없고, 아래 이름 중 하나면 알아봅니다. 대소문자와 공백은 무시하고, 머리글의 괄호 안 설명도 무시합니다(`주소(팜맵 필지 기준)` → 주소). CSV 읽기는 브라우저(`public/csv.js`)에서 하고, 읽은 장소만 DB로 보냅니다.

| 항목 | 필수 | 인식하는 머리글 |
| --- | --- | --- |
| 이름 | 필수 | 이름, 홈 이름, 홈포인트, 장소명, 상호, 업체명, name |
| 위도 | 필수 | 위도, lat, latitude, y |
| 경도 | 필수 | 경도, lng, lon, longitude, x |
| 주소 | | 주소, 도로명주소, 지번주소, 소재지, address |
| 전화번호 | | 전화번호, 연락처, phone, tel |
| 시군 | | 시군, 시/군, 시군구, 지역, district, city |
| 메모 | | 메모, 설명, 비고, memo |
| 미션명 | | 미션명, 미션, mission |

- 홈포인트 이름 규칙: 영문·숫자를 `_`로 이은 코드는 맨 뒤 번호와 그 앞 영문만 이름으로 씁니다. `A_TA_GH_16` → `GH_16`, `Q1_A_TA_SW_01` → `SW_01`. 한글 이름은 그대로입니다.
- 미션명 규칙: `물결(~) 앞 이름의 맨 뒤 번호`부터 `미션명 맨 끝 숫자`까지 펼치고, 번호 자릿수는 첫 미션(01)에 맞춥니다. `Q1_A_TA_SW__01_01 ~ _34` → `Q1_A_TA_SW__01_01` … `Q1_A_TA_SW__01_34`(34개). 물결이 없으면 미션 하나로 보고, 끝 번호가 시작보다 작거나 500개를 넘으면 펼치지 않고 그대로 보여 줍니다.
- 포인트 번호와 미션 번호가 붙은 표기도 읽습니다: `Q1DGHGS0101 ~ 10`은 포인트 01의 미션 01~10, 즉 `Q1DGHGS0101` … `Q1DGHGS0110`(10개)입니다. 미션은 늘 01부터 시작하므로 물결 뒤 숫자가 미션 개수이고, 물결 앞 번호에서 그 자릿수만큼만 미션 번호로 봅니다.
- 시군 열은 별도 칸에 저장되어 목록 그룹의 기준이 됩니다. 주소에는 시군을 붙이지 않습니다(주소 앞에 같은 시군이 붙어 있으면 읽을 때 뗍니다). 상세 카드에서는 시군을 작은 표시로 주소 앞에 보여 줍니다.
- 한 파일 안에 같은 이름·좌표 행이 둘 이상이면 뒤 행은 "N행과 같은 장소" 오류로 건너뜁니다.
- 인코딩: UTF-8(BOM 유무), EUC-KR, UTF-16(BOM)을 읽습니다. 판정이 안 되는 파일은 "파일 인코딩을 알 수 없습니다" 오류를 냅니다.
- 좌표는 숫자(예: 36.766667)만 받습니다. `0x10`, `1e1` 같은 표기와 `0,0`은 오류 행으로 처리합니다.
- 위도·경도 열이 뒤바뀐 파일(위도 칸에 127.xx)은 자동으로 바로잡습니다.
- 머리글 괄호 안의 쉼표가 따옴표로 감싸져 있지 않아도 읽습니다. `주소(팜맵 필지 기준, 인근)`처럼 두 칸으로 나뉜 머리글을 다시 한 칸으로 붙여서 뒤 열이 밀리지 않게 합니다.
- 이미 저장된 장소(같은 이름·같은 좌표)를 다시 가져올 때 CSV의 주소나 미션명이 저장된 것과 다르면 그 값만 CSV 내용으로 바꿉니다. 메모와 미션 기록은 그대로이고, CSV 칸이 비어 있으면 저장된 값을 지우지 않습니다.
- 가져오기 결과의 `missionChanged`는 미션명이 바뀐 기존 장소 수입니다. 미션명이 바뀌면 이전 미션의 기록은 화면에서 보이지 않습니다(DB에는 남음).
- 위 표에 없는 열은 읽지 않습니다. 홈포인트 CSV의 시기, 읍면, 작업자, 소티(완료/전체), 카카오맵 길안내 열은 저장되지 않습니다.
- 내보내기 열은 `이름,시군,주소,전화번호,위도,경도,상태,완료/전체,메모,미션명`입니다. 엑셀에서 바로 열리도록 UTF-8 BOM을 붙입니다. 미션 기록(완료·이름·비행시간·배터리)은 CSV에 포함되지 않습니다.

```csv
홈 이름(계획),미션명,시기,시군,읍면,주소(팜맵 필지 기준, 인근),위도,경도,작업자,소티(완료/전체),카카오맵 길안내
Q1_A_TA_SW_01,Q1_A_TA_SW__01_01 ~ _34,Q1,태안,소원면,소원면 송현리 인근,36.766667,126.149826,,0/34,"https://map.kakao.com/link/to/Q1_A_TA_SW_01,36.766667,126.149826"
```

## 길안내 동작

| 버튼 | 휴대폰 | PC |
| --- | --- | --- |
| 카카오맵 길찾기 | 카카오맵 앱의 자동차 길찾기가 목적지가 들어간 상태로 열립니다. 앱이 없으면 카카오맵 웹 길찾기로 이동합니다. | 카카오맵 웹 길찾기를 새 탭으로 엽니다. |
| 카카오맵에서 보기 | 카카오맵에 장소를 표시합니다. | 같음 |

카카오내비 연결은 쓰지 않기로 해서 넣지 않았습니다. 카카오내비는 URL로 열 수 없고 카카오 JavaScript SDK와 앱 키가 있어야 합니다.

## 지도

지도는 카카오맵 JavaScript SDK로 그립니다. 코드는 `public/kakao.js`와 `public/app.js`의 지도 영역에 있습니다.

- 키: 카카오 개발자 콘솔(developers.kakao.com › 플랫폼 키 › Web)의 JavaScript 키를 로컬은 `.env`의 `KAKAO_JS_KEY`, 배포는 GitHub Secret `KAKAO_JS_KEY`에 넣습니다. 빌드 때 `config.js`에 들어가 화면이 읽습니다. 키가 비어 있으면 지도 자리에 안내 문구가 뜹니다(목록·미션 기능은 그대로 동작).
- 도메인 등록: 키는 콘솔의 Web 플랫폼 › 사이트 도메인에 등록한 주소에서만 동작합니다. 로컬 개발용 `http://localhost:4100`과 배포 주소(현재 `https://sistech.dpdns.org`)가 등록되어 있어야 합니다. 다른 주소(포트)로 열면 지도 자리에 "이 주소가 등록되어 있는지 확인" 안내가 뜹니다.
- 비용: 카카오맵 JavaScript API는 무료이며 지도 로드 기준 하루 30만 건 한도입니다.
- 이전 이력: OpenStreetMap 공용 타일 서버는 자동화 테스트 트래픽만으로 이용 정책 위반으로 차단됐고, CARTO는 키가 필요해져서, OpenFreeMap을 거쳐 카카오맵으로 정했습니다. Leaflet·MapLibre 의존성은 제거했습니다.
- 자동 검증(헤드리스 브라우저)은 카카오 서버를 부르지 않도록 가짜 SDK를 주입해서 돌립니다. 실제 지도 확인은 등록된 주소에서 페이지를 한 번 여는 것으로 합니다.

## 보안 구조

- 공개되어도 되는 값: `SUPABASE_ANON_KEY`(anon 키)와 `KAKAO_JS_KEY`는 브라우저에 내려가는 공개용 키입니다. `config.js`로 화면에 들어가므로 누구나 볼 수 있다고 전제합니다.
  - anon 키로는 데이터를 못 봅니다. 표의 권한은 로그인한 사용자에게만 열려 있고 RLS가 켜져 있어서, 로그인하지 않은 요청은 거절됩니다. 함수 실행 권한도 로그인한 사용자에게만 있습니다.
  - 카카오 JavaScript 키는 콘솔에 등록한 도메인에서만 동작하도록 제한됩니다.
- 로그인 필수: 가입 기능을 꺼 두었고 계정은 관리자가 화면의 "계정 관리"에서 만듭니다. 계정이 있는 사람은 모든 장소를 보고 고치고 지울 수 있습니다(장소 데이터에는 권한 구분이 없습니다).
- 관리자: `app_metadata.role = "admin"` 표시가 있는 계정만 계정 관리 함수를 쓸 수 있습니다. 이 표시는 Supabase가 관리하는 값이라 사용자가 화면이나 API로 바꿀 수 없고, 마이그레이션·`npm run users -- --admin`·SQL Editor로만 넣습니다. 함수는 토큰을 서버에서 검증하므로 버튼을 억지로 눌러도 관리자가 아니면 거절됩니다.
- 진짜 비밀: `SUPABASE_ACCESS_TOKEN`과 `SUPABASE_DB_PASSWORD`는 GitHub Actions 안의 마이그레이션 단계에서만 쓰입니다. 화면 파일(`dist/`)에는 들어가지 않고, 깃에도 올리지 않습니다.
- service_role 키는 두 곳에서만 쓰입니다. 하나는 Supabase가 Edge Function 실행 환경에 자동으로 넣어 주는 것(우리는 저장하지 않음), 다른 하나는 비상용 스크립트를 돌릴 때 내 컴퓨터의 `.env`(깃 제외, 쓰고 나면 비움)입니다. 화면 파일, `config.js`, GitHub Secrets, 배포 과정에는 들어가지 않으며 스크립트도 키를 출력하지 않습니다.
- 로그인이 만료되거나 권한 오류가 나면 화면이 로그인 화면으로 돌아가 이전 데이터를 지웁니다.

## 운영 주의

- Supabase 무료 플랜은 일주일 정도 활동이 없으면 프로젝트가 일시정지됩니다. 주간 점검 워크플로가 월·목에 접속해 이를 막습니다. 그래도 정지되면(주간 점검 실패 이슈가 열림) 아래 장애 대응 표대로 복구합니다. 정지돼도 데이터는 지워지지 않습니다(정지가 90일 넘게 이어지면 복구할 수 없게 될 수 있으니 바로 복구하세요).
- GitHub Pages는 파일을 최대 10분 정도 캐시합니다. 배포 직후 옛 화면이 보이면 잠시 뒤 새로고침하세요. 파일 주소에 커밋 해시를 붙여 두어 대부분은 바로 바뀝니다. 지금 사이트가 몇 번 배포인지는 `https://sistech.dpdns.org/version.json`으로 확인합니다.
- 기존 Express + SQLite 서버의 데이터(`data/places.db`)는 자동으로 옮겨지지 않습니다. 옛 서버에서 CSV로 내보낸 뒤 새 사이트에서 다시 가져오세요. 단, 메모는 CSV에 포함되어 다시 가져와지지만 미션 기록(완료·이름·비행시간·배터리)은 CSV에 없어서 옮겨지지 않습니다. 필요하면 옛 DB 파일을 따로 보관하세요.
- 백업: Supabase 무료 플랜은 자동 백업이 없어서 주간 점검 워크플로가 암호화한 DB 덤프를 90일 보관합니다(배포 절 5). 중요한 작업 전에는 Actions → 주간 점검 → Run workflow로 즉시 백업을 하나 더 만들어 두세요. 화면의 "내보내기" CSV는 장소 목록만 담고 미션 기록은 없으므로 백업을 대신하지 못합니다.
- 초기화: 대시보드의 Table Editor나 SQL Editor에서 `places` 표를 비우면 됩니다(`missions`는 함께 지워집니다).
- 휴대폰 실기기에서 카카오맵 앱이 열리는지는 아직 확인하지 않았습니다.

### 모니터링(어디를 보면 되나)

| 볼 것 | 위치 |
| --- | --- |
| 배포·주간 점검 결과 | GitHub 저장소 Actions 탭. 실패하면 Issues 탭에 이슈가 열림(Watch 설정 필요) |
| 지금 배포된 버전 | `https://sistech.dpdns.org/version.json` 또는 브라우저 콘솔에서 `APP_BUILD` |
| Supabase 상태(정지 여부·사용량) | Supabase 대시보드 프로젝트 첫 화면, Organization → Usage |
| Edge Function(`admin-users`) 로그 | Supabase 대시보드 → Edge Functions → admin-users → Logs / Invocations |
| DB·Auth·API 로그 | Supabase 대시보드 → Logs(Postgres, Auth, API Gateway). 무료 플랜은 짧은 기간만 보관 |
| DB 크기 | SQL Editor에서 `select pg_size_pretty(pg_database_size(current_database()));` |
| 로그인 기록 | Table Editor → `login_logs`(화면에는 없음) |
| Supabase 전체 장애 | status.supabase.com, GitHub은 githubstatus.com |

### 장애 대응

| 증상 | 확인 | 조치 |
| --- | --- | --- |
| 사이트는 뜨는데 로그인·데이터가 안 됨, 주간 점검 실패 이슈 | Supabase 대시보드에 "Paused" 표시 | 프로젝트 화면의 **Restore project**(몇 분 걸림) → Actions → 주간 점검 → Run workflow로 확인 → 이슈 닫기 |
| 관리자 비밀번호 분실 | — | 다른 관리자가 화면 "계정 관리"에서 재설정. 관리자가 한 명뿐이면 `.env`에 service_role 키를 넣고 `npm run users -- --password <새 비밀번호> --reset-password 김용문`(관리자 표시가 빠졌으면 `npm run users -- --admin 김용문`), 다 쓰면 키를 비움. 또는 대시보드 Authentication → Users에서 직접 변경. 관리자를 두 명 이상 지정해 두면 안전합니다 |
| 배포 실패 이슈 | Actions의 실패한 실행에서 빨간 단계 로그 | 일시적이면 Re-run failed jobs. 코드 문제면 고쳐서 push하거나 `git revert` 후 push(배포 절 4). 가입 차단 확인 실패면 Supabase Authentication → Sign In / Providers에서 가입 허용을 끄고 Re-run |
| 배포 확인(version.json) 실패 | Settings → Pages의 Custom domain 상태(DNS check), 브라우저로 `/version.json` 열기 | 도메인 DNS·HTTPS 인증서 문제면 Pages 설정에서 다시 확인(Check again) |
| 도메인(`sistech.dpdns.org`) 만료·DNS 장애 | 도메인 등록처 대시보드의 만료일 | 갱신. 급하면 Settings → Pages에서 사용자 지정 도메인을 지우고 `https://<계정>.github.io/<저장소>/`로 접속(카카오 콘솔에 `https://<계정>.github.io`를 미리 등록해 두어야 지도가 뜸) |
| 지도만 안 뜸 | 브라우저 콘솔의 카카오 오류, 카카오 콘솔 사용량 | 도메인 등록 확인, 일일 한도 초과면 다음 날 풀림 |
| 계정 관리 버튼이 오류 | Edge Function 로그(위 표) | 함수 코드 문제면 고쳐서 push(함수 파일이 바뀌면 자동 배포). 수동으로 다시 올리려면 Actions → 배포 → Run workflow |
| DB가 무료 한도(500MB)에 가까움 | DB 크기 쿼리 | 대부분 `login_logs`일 가능성. 아래 보존 기준대로 지움 |
| 데이터를 잘못 지움 | 주간 백업 실행 기록 | 배포 절 5의 풀기·복원 절차. 백업 이후 변경은 사라지므로 최근 백업 시각을 먼저 확인 |

- 로그인 기록 보존: `login_logs`는 자동으로 지워지지 않습니다. 1년이 지난 기록은 SQL Editor에서 `delete from public.login_logs where occurred_at < now() - interval '1 year';`로 정리하세요(지우기 전에 백업을 하나 만들어 두면 안전). 기록에는 IP와 기기 정보가 들어 있으므로 필요 이상 오래 두지 않는 것이 좋습니다.

### 비용(무료 한도)

지금 구성은 모두 무료 요금제 안에서 돕니다. 한도는 바뀔 수 있으니 각 서비스의 요금 안내를 가끔 확인하세요(2026-11 기준 대략치).

| 서비스 | 무료 한도(대략) | 이 프로젝트에서 |
| --- | --- | --- |
| Supabase Free | DB 500MB, 월 활성 사용자 5만, 데이터 전송(egress) 월 5GB, Edge Function 호출 월 50만, 실시간 동시 접속 200, 무료 프로젝트 2개, 1주 비활성 시 정지, 자동 백업 없음 | 장소·미션 기록은 수 MB 수준. 로그인 기록이 가장 빨리 늘어남 |
| GitHub Actions | 공개 저장소의 표준 러너는 무료 | 배포 1회 약 2~4분, 주간 점검 주 2회 |
| GitHub Pages | 사이트 1GB, 월 전송량 100GB(권장치) | 수백 KB |
| Actions 아티팩트 | 공개 저장소는 무료, 보관 기간은 지정한 대로 | 백업 90일, E2E 실패 화면 14일 |
| 카카오맵 JavaScript API | 일일 호출 한도 있음(카카오 개발자 콘솔 → 앱 → 사용량에서 확인) | 현장 인원 규모에서는 여유 |
| 도메인 `dpdns.org` | 무료 도메인, 기간마다 갱신 필요 | 만료일을 달력에 적어 두기 |

## 알려진 한계

- 장소 데이터에는 권한 차이가 없습니다. 계정이 있는 사람은 모두 같은 일을 할 수 있고, 관리자 표시는 계정 관리에만 쓰입니다.
- 계정 삭제는 화면에 없습니다. 필요하면 Supabase 대시보드 Authentication → Users에서 지웁니다(로그인 기록은 남습니다).
- CSV를 다시 가져와 미션 범위가 줄어들면(예: `~ _40` → `~ _34`) 범위 밖 미션의 기록은 DB에 남지만 화면에는 보이지 않고 진행도에도 세지 않습니다.
- 이름은 분기(Q1, Q2 …)를 떼고 저장합니다. 다음 분기 CSV에 같은 이름·같은 좌표의 홈포인트가 있으면 새 장소로 추가되지 않고 미션명만 새 분기 것으로 바뀝니다.
- 서로 다른 지역 코드가 같은 짧은 이름(SW_01)이 되면 목록에서 구분되지 않습니다(이름 규칙상 의도).
- 홈포인트 CSV의 작업자, 소티(완료/전체) 정보는 저장하지 않습니다.
- 마이그레이션은 앞으로만 적용됩니다. 배포를 `git revert`로 되돌려도 DB 구조는 그대로라서, 마이그레이션은 추가만 하는 방식으로 씁니다(배포 절 3·4).
- 주간 백업은 주 2회라 백업 사이의 변경은 잃을 수 있습니다. 백업은 GitHub 아티팩트(90일)에만 있으므로 오래 보관할 것은 내려받아 따로 두세요.
- GitHub 예약 실행은 몇 분~수십 분 늦게 돌거나 드물게 건너뛰어질 수 있습니다. 주 2회로 돌려 여유를 두었습니다.

## 이력

- 초기: Express + SQLite 서버, CSV 가져오기·내보내기, 장소 목록과 메모, 카카오맵 길안내.
- 지도: OpenStreetMap 타일이 차단돼 OpenFreeMap을 거쳐 카카오맵으로 정함. 지도·위성·하이브리드·필지 배경.
- 미션: 미션명 펼치기, 미션별 기록, 기기 간 충돌 감지(`version`), 상태 색상 자동화, 시군별 접이식 목록.
- 2026-11-06 전환: Express + SQLite 서버를 없애고 GitHub Pages(정적) + Supabase(Postgres·Auth·Realtime) 구조로 바꿈. 로그인 필수와 실시간 반영을 추가하고, CSV 읽기를 브라우저로 옮기고, API를 DB 함수 5개로 대체. GitHub Actions로 테스트 → 마이그레이션 → 배포를 자동화.
- 2026-11-06 계정: 한글 아이디 로그인, 로그인 기록(DB에만), 관리자 전용 계정 관리(Edge Function `admin-users`, 관리자 표시는 `app_metadata.role`). 사이트 주소를 `https://sistech.dpdns.org`로 변경.
- 2026-11-06 이름: 서비스 이름을 "SISTECH 관리 페이지(홈포인트 지도)"에서 **HOME POINT NAVI(홈포인트 네비)**로 변경. 브라우저 탭 제목은 "HOME POINT NAVI | 시스테크", 머리글과 로그인 카드의 제목 아래에 작게 "by SISTECH". 사이트 주소, 로그인 이메일 도메인(`sistech.local`), 저장소 이름 같은 내부 식별자는 그대로.
- 2026-11-09 미션명: 포인트 번호와 미션 번호가 붙은 `Q1DGHGS0101 ~ 10` 표기를 10개 미션으로 풀도록 화면(`mission.js`)과 DB 함수(`mission_names`)를 함께 수정. 전에는 범위가 거꾸로라고 보고 미션 하나로 처리했음.
- 2026-11-09 운영: 워크플로 액션을 커밋 SHA로 고정하고 Supabase CLI를 3.0.0으로 고정, Dependabot 주간 갱신. CI에 lint·SQL 테스트·Deno 타입 검사·E2E(있을 때)·supabase-js 번들 확인 추가. 마이그레이션·함수는 바뀐 경우에만 적용하고(마지막 성공 배포와 비교), 가입 차단 확인·배포 후 `version.json` 확인·실패 시 이슈 알림 추가. 주간 점검 워크플로(휴면 방지, 암호화 백업 90일). 빌드에 `APP_BUILD`·`version.json`, `config.js` 내용 해시 스탬프, 스탬프 누락 검사 추가. supabase-js를 `public/vendor/`에 자체 호스팅용으로 번들. README에 실패·되돌리기 절차, 장애 대응, 모니터링, 비용 표 추가.
