// write-config: anon 자리에 비밀 키가 들어오면 config.js 를 쓰지 않고 멈추는지 검사한다(가짜 키만 씀).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertPublicAnonKey, writeConfig } from '../scripts/write-config.mjs';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fakeJwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.fake-signature`;

const ANON = fakeJwt({ iss: 'supabase', ref: 'testref', role: 'anon' });
const SERVICE = fakeJwt({ iss: 'supabase', ref: 'testref', role: 'service_role' });
const SECRET = 'sb_secret_FAKEFAKEFAKEFAKE';

test('anon JWT 와 publishable 키는 통과', () => {
  assert.doesNotThrow(() => assertPublicAnonKey(ANON));
  assert.doesNotThrow(() => assertPublicAnonKey(`  ${ANON}\n`));
  assert.doesNotThrow(() => assertPublicAnonKey('sb_publishable_FAKEFAKE'));
});

test('service_role JWT, sb_secret_ 키, role 이 anon 이 아닌 JWT 는 거부하고 키 값을 메시지에 넣지 않는다', () => {
  for (const key of [SERVICE, SECRET, fakeJwt({ role: 'authenticated' }), fakeJwt({}), 'eyJ.broken.jwt']) {
    assert.throws(
      () => assertPublicAnonKey(key),
      (err) => {
        assert.match(err.message, /SUPABASE_ANON_KEY/);
        assert.ok(!err.message.includes(key), '키 값이 메시지에 나오면 안 된다');
        return true;
      },
      key.slice(0, 12),
    );
  }
  assert.throws(() => assertPublicAnonKey(SERVICE), /비밀 키/);
  assert.throws(() => assertPublicAnonKey(SECRET), /비밀 키/);
});

test('writeConfig 는 비밀 키면 파일을 만들지 않고, anon 키면 만든다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-config-'));
  try {
    const out = path.join(dir, 'config.js');
    const env = { SUPABASE_URL: 'https://example.supabase.co', KAKAO_JS_KEY: 'kakao' };
    assert.throws(() => writeConfig(out, { ...env, SUPABASE_ANON_KEY: SERVICE }), /비밀 키/);
    assert.throws(() => writeConfig(out, { ...env, SUPABASE_ANON_KEY: SECRET }), /비밀 키/);
    assert.equal(fs.existsSync(out), false);
    writeConfig(out, { ...env, SUPABASE_ANON_KEY: ANON });
    assert.match(fs.readFileSync(out, 'utf8'), /supabaseAnonKey/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
