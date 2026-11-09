# e2e — 헤드리스 화면 점검

헤드리스 Chrome(CDP)으로 실제 화면(`public/`)을 열어 확인합니다. 가짜 supabase-js(`fake-supabase.js`)와 가짜 카카오맵 SDK(`fake-kakao.js`)를 페이지보다 먼저 심고, 진짜 카카오 SDK·지도 타일·jsdelivr는 막습니다. 외부 네트워크와 Secrets가 필요 없습니다.

## 실행

```bash
E2E_PORT=4198 node e2e/run-all.mjs          # 전체(개발 서버를 띄우고 끝나면 내림)
E2E_PORT=4198 node e2e/run-one.mjs ux-memo  # 하나 또는 몇 개만
```

- 포트 4100은 사람이 쓰는 개발 서버라 쓰지 않습니다(4100이면 바로 멈춥니다).
- Node 22.13 이상, Chrome이 필요합니다. `CHROME_BIN`이 있으면 그 실행 파일을, 없으면 macOS 기본 위치 또는 `google-chrome`을 씁니다.
- `CI=true`(GitHub Actions)이면 `--no-sandbox`를 붙입니다. 더 붙일 옵션은 `E2E_CHROME_FLAGS="--옵션 --옵션"`.
- 다른 작업 폴더(worktree 등)를 점검하려면 `E2E_PROJECT=/그/폴더`. 기본은 이 폴더의 한 단계 위(저장소 뿌리)입니다.
- 결과: `results/<시나리오>.json`·`.log`(git에 올리지 않음), 스크린샷 `shots/`(저장소 `.gitignore`가 무시함, A-2 재현 화면 `a2-repro-*.png`만 올려 둠).
- 리눅스 CI에 한글 글꼴(예: `fonts-noto-cjk`)이 없으면 글자 폭이 달라져 `shots`의 머리글 크기 검사가 어긋날 수 있습니다.

## 시나리오

| 파일 | 확인하는 것 |
| --- | --- |
| `boot-login` | config.js 없음·Supabase 설정 빈 칸 안내, supabase-js 불러오기(자체 호스팅 우선·CDN 차단), 로그인·로그아웃 |
| `missions` | 미션 진행(배지·입력·완료 규칙·충돌·새로고침 유지) |
| `regress` | 처음 화면, 상태 분류·검색과 시군 접힘, 메모 아이콘 |
| `multi-import` / `import` | 여러 CSV 끌어다 놓기·파일 고르기, 파일별 결과, 갱신·미션명 변경, 행 오류 |
| `features` | 내보내기, 미션 저장 인자·충돌, 실시간 반영(바뀐 장소만), 세션 만료 |
| `login-id` | 한글 아이디 로그인, 로그인·로그아웃 기록 |
| `accounts` | 계정 관리(목록·만들기·재설정·오류 문구·권한) |
| `shots` | 390·1280 화면 넘침·머리글 높이 |
| `ux-worker` | 미션 기록 이름은 읽기 전용, 늘 로그인 아이디(C4 우선순위)로 저장, 다른 사람 기록을 고칠 때 안내, 충돌·다시 그리기에서도 유지 |
| `ux-scroll` | 계정 관리·긴 상세 정보를 열어도 문서 가로·세로 스크롤 없음(390·1280·가로 844) |
| `ux-memo` | 메모 1초 자동 저장, 즉시 저장(change·pagehide·숨김), 상태 표시, 실패·충돌(C1)·옛 서버·시간 초과 |
| `ux-sync` | 목록 불러오는 중·실패·[다시 시도], 응답 시간 제한, 저장 중 취소, 미션 충돌 두 갈래, 실시간 부분 갱신(C2·C3) |
| `ux-perf` | 1,200곳: 접힌 시군 줄 없음, 검색 디바운스·IME, 자동 펼침 100곳 제한, 바뀐 핀만 갱신 |
| `ux-map` | 지도 실패 안내·다시 불러오기·online 자동 재시도, 오프라인 띠, 새 버전 띠(C8) |
| `ux-a11y` | 누르는 자리 44px, 삭제 확인 문구, 가로 화면 지도 접기, 제목 초점, 알림 칸, 상태 기호, 계정 표 role |
| `ux-accounts` | 비밀번호 [보기], 길이 규칙·서버 문구, 다른 계정 재설정 확인, 본인 재설정 뒤 로그인 안내 |
| `ux-import` | 가져오기 전 확인(C7: 경고·근접 중복·미션명 변경), 옛 csv.js에서도 동작 |
| `ux-export` | [내보내기] 메뉴(C11): 장소 / 미션 기록 두 항목, 키보드(↓·Esc)·바깥 누르기로 닫기, 머리글 높이 그대로, 파일명·미션 기록 머리글·행, 옛 csv.js면 메뉴 없이 바로 장소 내보내기 |
| `ux-review` | 코드 검토에서 나온 경로: 원격 메모를 덮어쓰지 않음, 늦게 온 옛 받기 결과가 방금 저장한 값을 되돌리지 않음, 로그아웃·새로고침·탭 닫기·본인 비밀번호 변경 전 메모 저장, 다시 로그인 시 멈춤 없음, 끊긴 저장 재시도, 조합 상태 해제 |

`launch(name, { csvShim: 'legacy' })`는 브라우저가 받는 `csv.js`에서 `toMissionCsv`를 감춥니다(파일은 그대로, 옛 csv.js 흉내).

`probe-a2.mjs`·`probe-header.mjs`는 run-all에 넣지 않는 진단 스크립트입니다.

## 가짜 서버(`fake-supabase.js`)

메모리 DB를 localStorage에 두고, 진짜 Supabase처럼 바뀐 행마다 실시간 알림(postgres_changes)을 보냅니다. 점검 스크립트는 `window.__fake`로 데이터를 넣거나(`seed`, `importRows`, `remoteChange`), 실패를 만들고(`failNext({ name })`, `conflictNext`, `fnFailNext`), 서버 판을 바꿉니다(`noGetPlaces`, `legacyMemo`, `softDelete`, `snapshotAtCall`). 자세한 목록은 파일 머리 주석에 있습니다.
