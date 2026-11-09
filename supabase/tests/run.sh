#!/bin/bash
# Supabase 마이그레이션 SQL 검증. Docker·Supabase CLI 없이 로컬 Postgres 바이너리(initdb, pg_ctl, psql)만 있으면 된다.
#   사용: supabase/tests/run.sh          (npm run test:sql)
# 임시 클러스터를 ${TMPDIR}/sistech-pg-test 에 만들어 127.0.0.1:5499 로 띄우고, 끝나면 내린다. 사용자의 5432 서버는 건드리지 않는다.
# 매번 새 DB에 shim(Supabase 환경 흉내) → 마이그레이션 → tests.sql 순서로 넣는다.
# 두 번 돈다: 기본 권한 없음(프로젝트 설정 "새 테이블 자동 노출" 꺼짐), 기본 권한 있음(켜짐). 둘 다 통과해야 한다.
set -euo pipefail
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl || true)")}"
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "pg_ctl을 찾지 못했습니다. PostgreSQL 바이너리 경로를 PGBIN 환경변수로 알려 주세요(예: PGBIN=/opt/homebrew/bin)." >&2
  exit 1
fi
PORT="${TEST_PG_PORT:-5499}"
DATA="${TEST_PG_DATA:-${TMPDIR:-/tmp}/sistech-pg-test}"
DATA="${DATA%/}"
DB=sistech_test
PSQL=("$PGBIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres)

if [ ! -f "$DATA/PG_VERSION" ]; then
  "$PGBIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
fi
# 스크래치 경로가 길면 유닉스 소켓을 못 만들므로 TCP(127.0.0.1)만 연다.
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l "$DATA.log" -w start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null' EXIT

MIGRATION="$(ls "$REPO"/supabase/migrations/*.sql | sort)"
CASES="$(node "$S/mission-cases.mjs" "$REPO/public/mission.js")"
# 좌표 반올림 비교 사례(public/coord.js의 roundCoord 결과). 사례 파일이 아직 없는 브랜치에서는 빈 배열로 건너뛴다.
# 파일이 있는데 node가 실패하면 set -e로 멈춘다(빈 배열로 조용히 넘어가지 않게).
if [ -f "$S/coord-cases.mjs" ]; then
  COORD_CASES="$(node "$S/coord-cases.mjs" "$REPO/public/coord.js")"
else
  COORD_CASES='[]'
fi
TOTAL_FAILED=0

for EXPOSED in 0 1; do
  echo "===== 기본 권한 $([ "$EXPOSED" = 1 ] && echo '있음(자동 노출 켜짐)' || echo '없음(자동 노출 꺼짐)') ====="
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
  "${PSQL[@]}" -d postgres -c "drop role if exists rls_probe" >/dev/null 2>&1 || true

  "${PSQL[@]}" -d $DB -v ON_ERROR_STOP=1 -v exposed=$EXPOSED -f "$S/shim.sql" 2>&1 | grep -v 'wal_level\|HINT:  Set wal' || true
  for f in $MIGRATION; do
    "${PSQL[@]}" -d $DB -v ON_ERROR_STOP=1 -1 -f "$f"
  done
  "${PSQL[@]}" -d $DB -v ON_ERROR_STOP=1 -v cases="$CASES" -v coord_cases="$COORD_CASES" -v conn="host=127.0.0.1 port=$PORT dbname=$DB user=postgres" -f "$S/tests.sql"

  FAILED="$("${PSQL[@]}" -d $DB -Atc 'select count(*) from t.results where not pass')"
  TOTAL="$("${PSQL[@]}" -d $DB -Atc 'select count(*) from t.results')"
  echo "결과: $((TOTAL - FAILED))/$TOTAL 통과"
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
done

[ "$TOTAL_FAILED" = "0" ]
