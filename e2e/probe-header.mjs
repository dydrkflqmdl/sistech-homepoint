// 390 폭 머리글 넘침 원인 측정(run-all에는 넣지 않는 진단 스크립트): node e2e/run-one.mjs probe-header [이메일]
import { launch, prepare, q1Rows } from './lib.mjs';
const b = await launch('probe', { viewport: [390, 844, true] });
const email = process.argv[2] ?? 'very.long.admin.account@sistech-example.co.kr';
await prepare(b, { rows: await q1Rows(), email });
console.log(JSON.stringify(await b.ev(`(() => { const w = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), e.scrollWidth]; };
  return { inner: innerWidth, docScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(document.documentElement).overflow,
    app: w('.app'), topbar: w('.topbar'), h1: w('.topbar h1'), actions: w('.actions'), account: w('.account'), name: w('#user-name'), logout: w('#logout-button'), layout: w('.layout'), panel: w('.panel'), search: w('#search'),
    appCols: getComputedStyle(document.querySelector('.app')).gridTemplateColumns }; })()`)));
await b.close();
