'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'accelerator.js'), 'utf8');
const { rewrite } = require('./accelerator.js');

const PREF = 'enabled=true&preferred=pref.example.com';
const U = (host, q = 'e=abc&sign=A%2Bb==&deadline=1') => `https://${host}/v/x.m4s?${q}`;

// Run the script the way Surge does; returns { calls, arg }.
function run(body, argument = PREF, extra = {}) {
  const calls = [];
  const ctx = { $response: { status: 200, body, ...extra }, $argument: argument, $done: (r) => calls.push(r) };
  vm.runInNewContext(src, ctx);
  return calls;
}
// $done results come from a vm realm, so deepStrictEqual({}) fails on prototype identity.
function assertEmptyDone(v, msg) {
  assert.ok(v !== null && typeof v === 'object', msg);
  assert.strictEqual(Object.keys(v).length, 0, msg);
  assert.strictEqual(Object.getOwnPropertyNames(v).length, 0, msg);
}
const body = (data, code = 0) => JSON.stringify({ code, message: '0', data });

test('promotes preferred backup in dash video and audio, keeps all as fallback', () => {
  const base = U('other.example.com'), pref = U('pref.example.com'), mid = U('mid.example.com');
  const b = body({ dash: {
    video: [{ id: 80, baseUrl: base, base_url: base, backupUrl: [mid, pref], backup_url: [mid, pref] }],
    audio: [{ id: 1, base_url: base, backup_url: [pref] }],
  } });
  const calls = run(b);
  assert.strictEqual(calls.length, 1);
  const out = JSON.parse(calls[0].body);
  const v = out.data.dash.video[0];
  assert.strictEqual(v.baseUrl, pref);
  assert.strictEqual(v.base_url, pref);
  assert.deepStrictEqual(v.backupUrl, [base, mid]);
  assert.deepStrictEqual(v.backup_url, [base, mid]);
  const a = out.data.dash.audio[0];
  assert.strictEqual(a.base_url, pref);
  assert.deepStrictEqual(a.backup_url, [base]);
});

test('durl and PGC result.video_info structures', () => {
  const base = U('other.example.com'), pref = U('pref.example.com');
  const d = run(body({ durl: [{ url: base, backup_url: [pref] }] }));
  const o = JSON.parse(d[0].body);
  assert.strictEqual(o.data.durl[0].url, pref);
  assert.deepStrictEqual(o.data.durl[0].backup_url, [base]);
  const p = run(JSON.stringify({ code: 0, result: { video_info: { dash: { video: [{ baseUrl: base, backupUrl: [pref] }] } } } }));
  assert.strictEqual(JSON.parse(p[0].body).result.video_info.dash.video[0].baseUrl, pref);
});

test('signed URL bytes are preserved exactly, rest of body untouched (big ints)', () => {
  const pref = 'https://pref.example.com/v/x.m4s?e=a%2Fb&sign=ZZ==&os=upos&x=\\u0026';
  const prefDecoded = JSON.parse(`"${pref}"`);
  const base = U('other.example.com');
  const text = `{"code":0,"data":{"cid":9007199254740993,"dash":{"video":[{"baseUrl":"${base}","backupUrl":["${pref}"]}]}}}`;
  const out = run(text)[0].body;
  assert.ok(out.includes('"cid":9007199254740993'));
  assert.ok(out.includes(`"baseUrl":"${pref}"`), 'raw token reused');
  const o = JSON.parse(out);
  assert.strictEqual(o.data.dash.video[0].baseUrl, prefDecoded);
  assert.deepStrictEqual(o.data.dash.video[0].backupUrl, [base]);
});

test('duplicates are collapsed, unique backups all kept', () => {
  const base = U('other.example.com'), pref = U('pref.example.com'), mid = U('mid.example.com');
  const out = JSON.parse(run(body({ dash: { video: [{ baseUrl: base, backupUrl: [mid, mid, base, pref, pref] }] } }))[0].body);
  assert.strictEqual(out.data.dash.video[0].baseUrl, pref);
  assert.deepStrictEqual(out.data.dash.video[0].backupUrl, [base, mid]);
});

test('preferred order, suffix match, port and case', () => {
  const a = U('a.cdn.example.com:8082'), b = U('B.example.com'), c = U('c.other.net');
  const arg = 'enabled=true&preferred=b.example.com|.cdn.example.com';
  const out = JSON.parse(run(body({ dash: { audio: [{ baseUrl: c, backupUrl: [a, b] }] } }), arg)[0].body);
  assert.strictEqual(out.data.dash.audio[0].baseUrl, b);
  assert.deepStrictEqual(out.data.dash.audio[0].backupUrl, [a, c]);
});

test('fails open: disabled, no preferred, no match, already first, no backup', () => {
  const base = U('other.example.com'), pref = U('pref.example.com');
  const mk = (s) => body({ dash: { video: [s] } });
  const swap = mk({ baseUrl: base, backupUrl: [pref] });
  for (const [b, arg] of [
    [swap, 'enabled=false&preferred=pref.example.com'],
    [swap, 'enabled=true&preferred='],
    [swap, 'enabled=true&preferred={{{PreferredHosts}}}'],
    [swap, 'enabled=true&preferred=none.example.com'],
    [mk({ baseUrl: pref, backupUrl: [base] }), PREF],
    [mk({ baseUrl: base, backupUrl: [] }), PREF],
    [mk({ baseUrl: base }), PREF],
    [mk({ baseUrl: base, backupUrl: null }), PREF],
  ]) {
    const calls = run(b, arg);
    assert.strictEqual(calls.length, 1);
    assertEmptyDone(calls[0]);
  }
});

test('fails open: conflicts, invalid json, business error, unknown structure', () => {
  const base = U('other.example.com'), pref = U('pref.example.com');
  const cases = [
    body({ dash: { video: [{ baseUrl: base, base_url: pref, backupUrl: [pref] }] } }), // alias conflict
    body({ dash: { video: [{ baseUrl: base, backupUrl: [pref], backup_url: [base] }] } }),
    body({ dash: { video: [{ baseUrl: base, backupUrl: ['//pref.example.com/x'] }] } }), // not full URL
    body({ dash: { video: [{ baseUrl: base, backupUrl: [1] }] } }),
    body({ dash: { video: [{ baseUrl: base, backupUrl: [pref] }] } }, -404),
    body({ dash: { video: [{ baseUrl: base, backupUrl: [pref] }] } }, '0'),
    '{"code":0,"data":{"dash":{"video":[{"baseUrl":"' + base + '","backupUrl":["' + pref + '"]}]}',
    '{"code":0,"code":0,"data":{}}',
    '<html>not json</html>',
    '',
    JSON.stringify({ code: 0, data: { other: { video: [{ baseUrl: base, backupUrl: [pref] }] } } }),
    JSON.stringify([{ code: 0 }]),
  ];
  for (const c of cases) {
    const calls = run(c);
    assert.strictEqual(calls.length, 1);
    assertEmptyDone(calls[0], c.slice(0, 60));
  }
  assertEmptyDone(run(body({ dash: { video: [{ baseUrl: base, backupUrl: [pref] }] } }), PREF, { status: 500 })[0]);
  assert.strictEqual(run(undefined, PREF, { body: undefined }).length, 1);
});

test('only streams in target positions change; one bad stream does not block others', () => {
  const base = U('other.example.com'), pref = U('pref.example.com');
  const out = JSON.parse(run(body({ dash: { video: [
    { baseUrl: base, backupUrl: 'oops' },
    { baseUrl: base, backupUrl: [pref] },
  ] } }))[0].body);
  assert.strictEqual(out.data.dash.video[0].baseUrl, base);
  assert.strictEqual(out.data.dash.video[1].baseUrl, pref);
});

test('rewrite is pure and exports are usable', () => {
  assert.strictEqual(rewrite('nope', PREF), null);
});
