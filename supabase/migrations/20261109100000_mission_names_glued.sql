-- 미션명 풀이에 "포인트 번호 + 미션 번호가 붙은 표기"를 추가한다.
-- 예: 홈포인트_Q1_D_GH_GS CSV의 미션명 "Q1DGHGS0101 ~ 10"은 포인트 01의 미션 01~10, 즉 Q1DGHGS0101 … Q1DGHGS0110(10개)이다.
-- 전에는 첫 번호를 0101(=101)로 읽어 101→10 거꾸로 된 범위로 보고 미션 하나로 처리했다.
-- 규칙: 끝 번호가 첫 번호보다 작은데 첫 번호 자릿수가 더 많으면, 첫 번호 뒷자리(끝 번호 자릿수만큼)만 미션 번호로 보고
--       앞자리는 이름에 붙인다. 미션은 늘 01부터 시작하므로 물결 뒤 숫자가 곧 미션 개수가 된다.
-- 나머지 본문은 20261106000000_init.sql의 함수와 같다(public/mission.js missionNames와 결과가 같아야 하며,
-- supabase/tests/mission-cases.mjs의 사례로 비교한다). create or replace라 기존 권한(authenticated만 실행)은 그대로다.

create or replace function public.mission_names(raw text) returns text[]
language plpgsql immutable parallel safe security invoker
set search_path = public
as $$
declare
  ws constant text := E'\t\n\u000B\f\r                  　﻿';
  line_end constant text := E'\n\r  ';
  tildes constant text := E'~～〜';
  t text := public.js_trim(coalesce(raw, ''));
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
  v_first := first_digits::numeric;
  v_last := last_digits::numeric;
  -- 포인트 번호와 미션 번호가 붙은 표기("Q1DGHGS0101 ~ 10" = 포인트 01, 미션 01~10).
  -- 끝 번호가 첫 번호보다 작은데 첫 번호 자릿수가 더 많으면, 넘치는 앞자리는 포인트 번호라 이름에 붙이고
  -- 뒷자리(끝 번호 자릿수만큼)만 미션 번호로 본다. mission.js의 missionNames와 같은 규칙이다.
  if v_last < v_first and length(first_digits) > length(last_digits) then
    cut := length(first_digits) - length(last_digits);
    prefix := prefix || left(first_digits, cut);
    first_digits := substr(first_digits, cut + 1);
    v_first := first_digits::numeric;
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
