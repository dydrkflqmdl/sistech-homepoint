-- 미션명 풀이 규칙 보강(계약 C6). public/mission.js의 missionNames와 결과가 글자 단위로 같아야 하며,
-- supabase/tests/mission-cases.mjs의 사례로 비교한다. create or replace라 기존 권한(authenticated만 실행)은 그대로다.
--  1. 붙은 표기("Q1DGHGS0101 ~ 10")는 첫 번호에서 잘라낸 뒷자리가 정확히 1일 때만 쓴다.
--     전에는 "Q1_A_10 ~ 9"(10개), "Q1_A_12 ~ 5"(4개), "Q1DGHGS0100 ~ 10"(11개)까지 펼쳤다. 이제 모두 미션 하나다.
--  2. 물결 뒤에 숫자 말고 글자가 있으면 그 글자(앞뒤 공백 제외)가 물결 앞 이름의 끝부분과 같아야 범위다.
--     "Q1_A_TA_GH__01_01 ~ _02"(2개), "Q1_B_BE_TB__03_01~Q1_B_BE_TB__03_10"(10개)은 그대로,
--     "Q1_A_TA_GH__01_01 ~ Q1_A_TA_GH__02_05"는 미션 하나다(전에는 01_01~01_05 5개).
--  3. 물결에 ∼(U+223C)를 더하고, 전각 숫자 ０-９는 반각으로 바꿔 읽는다(결과 이름도 반각).
--  4. 번호 숫자 묶음이 15자리를 넘으면 범위로 보지 않는다.
-- 나머지(500개 상한, 공백 집합, 줄 끝 문자 규칙)는 20261109100000_mission_names_glued.sql과 같다.
--
-- 좌표 반올림 round_coord(round(x::numeric, 7))는 바꾸지 않는다. Postgres는 double을 numeric으로 바꿀 때 유효숫자 15자리
-- 십진수를 쓰고 round는 0에서 먼 쪽으로 반올림하므로(35.12345685 → 35.1234569), public/coord.js의 roundCoord를
-- 같은 십진 규칙으로 고쳐 맞췄다(전에는 Math.round(n * 1e7) / 1e7이라 35.1234568이 나왔다).

create or replace function public.mission_names(raw text) returns text[]
language plpgsql immutable parallel safe security invoker
set search_path = public
as $$
declare
  ws constant text := E'\t\n\u000B\f\r                  　﻿';
  line_end constant text := E'\n\r  ';
  tildes constant text := E'~～〜∼';
  -- 전각 숫자는 반각으로 바꿔 읽는다(결과 이름도 반각).
  t text := translate(public.js_trim(coalesce(raw, '')), '０１２３４５６７８９', '0123456789');
  c text[];
  n int;
  p int;          -- 첫 번호가 시작하는 자리
  e int;          -- 첫 번호가 끝나는 자리
  q int;          -- 물결 자리
  w int;          -- 물결 뒤 공백을 지난 자리
  d int;          -- 마지막 번호가 시작하는 자리
  f int;          -- 문자열 끝에 붙은 숫자 묶음이 시작하는 자리
  k int;
  matched boolean := false;
  ok boolean;
  prefix text;
  first_digits text;
  last_digits text;
  v_first numeric;
  v_last numeric;
  num text;
  cut int;        -- 붙은 표기에서 이름으로 넘기는 첫 번호 앞자리 수
  mid text;       -- 물결 뒤 공백과 마지막 번호 사이 글자(앞뒤 공백 제외)
  result text[] := '{}';
begin
  if t = '' then
    return '{}';
  end if;
  c := regexp_split_to_array(t, '');
  n := array_length(c, 1);

  -- 앞뒤 공백을 뗐으므로 끝의 \s*는 빈 문자열이고, 맨 끝 글자는 숫자여야 한다.
  if not (ascii(c[n]) between 48 and 57) then
    return array[t];
  end if;
  f := n;
  while f > 1 and ascii(c[f - 1]) between 48 and 57 loop
    f := f - 1;
  end loop;

  -- (.*?)가 게으르므로 앞에서부터 첫 번호 자리를 하나씩 해 본다. 앞부분에 줄 끝 문자가 끼면 더 볼 것이 없다.
  -- (FOR p IN 1..n은 루프 안에서만 쓰는 새 변수를 만들어 끝난 뒤 p가 남지 않으므로 LOOP로 돈다.)
  p := 0;
  loop
    p := p + 1;
    exit when p > n;
    exit when p > 1 and position(c[p - 1] in line_end) > 0;
    continue when not (ascii(c[p]) between 48 and 57);
    -- (\d+)는 숫자 묶음 전체여야 한다(짧게 끊으면 다음 글자가 숫자라 \s*[~]에 맞지 않는다).
    e := p;
    while e < n and ascii(c[e + 1]) between 48 and 57 loop
      e := e + 1;
    end loop;
    q := e + 1;
    while q <= n and position(c[q] in ws) > 0 loop
      q := q + 1;
    end loop;
    continue when q >= n or position(c[q] in tildes) = 0;
    -- 마지막 번호는 물결 뒤에서 문자열 끝까지 이어지는 숫자 묶음이다.
    d := greatest(f, q + 1);
    w := q + 1;
    while w < d and position(c[w] in ws) > 0 loop
      w := w + 1;
    end loop;
    -- 물결 뒤 공백과 마지막 번호 사이(.*?)에는 줄 끝 문자가 올 수 없다.
    ok := true;
    for k in w..d - 1 loop
      if position(c[k] in line_end) > 0 then
        ok := false;
        exit;
      end if;
    end loop;
    if ok then
      matched := true;
      exit;
    end if;
  end loop;

  if not matched then
    return array[t];
  end if;

  prefix := array_to_string(c[1:p - 1], '');
  first_digits := array_to_string(c[p:e], '');
  last_digits := array_to_string(c[d:n], '');
  -- 번호가 15자리를 넘으면 범위로 보지 않는다(JS Number 정밀도 한계에 맞춘다).
  if length(first_digits) > 15 or length(last_digits) > 15 then
    return array[t];
  end if;
  v_first := first_digits::numeric;
  v_last := last_digits::numeric;
  -- 포인트 번호와 미션 번호가 붙은 표기("Q1DGHGS0101 ~ 10" = 포인트 01, 미션 01~10).
  -- 끝 번호가 첫 번호보다 작고 자릿수가 적은데 첫 번호 뒷자리(끝 번호 자릿수만큼)가 정확히 1이면, 넘치는 앞자리는
  -- 포인트 번호라 이름에 붙이고 뒷자리만 미션 번호로 본다. 뒷자리가 1이 아니면("Q1_A_10 ~ 9") 손대지 않는다(미션 하나).
  -- mission.js의 missionNames와 같은 규칙이다.
  if v_last < v_first and length(first_digits) > length(last_digits) then
    cut := length(first_digits) - length(last_digits);
    if substr(first_digits, cut + 1)::numeric = 1 then
      prefix := prefix || left(first_digits, cut);
      first_digits := substr(first_digits, cut + 1);
      v_first := 1;
    end if;
  end if;
  -- 물결 뒤 글자("_34", "Q1_B_BE_TB__03_10"의 "Q1_B_BE_TB__03_")는 (포인트 번호까지 붙인) 이름의 끝부분이어야 한다.
  mid := public.js_trim(array_to_string(c[w:d - 1], ''));
  if right(prefix, length(mid)) <> mid then
    return array[t];
  end if;
  if v_last < v_first or v_last - v_first >= 500 then
    return array[t];
  end if;
  for k in 0..(v_last - v_first)::int loop
    num := (v_first + k)::text;
    -- padStart와 같게, 이미 자릿수가 넉넉하면 자르지 않는다(lpad는 자른다).
    if length(num) < length(first_digits) then
      num := lpad(num, length(first_digits), '0');
    end if;
    result := result || (prefix || num);
  end loop;
  return result;
end
$$;
