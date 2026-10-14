'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'media-redirect.js'), 'utf8');
const { rewrite } = require('./media-redirect.js');
const argument = 'enabled=true&host=cn-hk-eq-01-04.bilivideo.com';
const signed = '/upgcxcode/77/88/123456.m4s?deadline=123&platform=ipad&os=akam&gen=playurlv3&sign=A%2Bb%3D%3D';

function run(request, arg = argument) {
  const calls = [];
  vm.runInNewContext(source, { $request: request, $argument: arg, $done: value => calls.push(value) });
  assert.equal(calls.length, 1);
  return calls[0];
}

test('iPad media request changes destination and Host, retaining exact signed bytes and Range', () => {
  const request = { method: 'GET', url: 'http://184.27.185.82' + signed,
    headers: { hOsT: '184.27.185.82', Range: 'bytes=0-131071', 'User-Agent': 'BiliApp' } };
  const expected = 'http://cn-hk-eq-01-04.bilivideo.com' + signed;
  const result = rewrite(request, argument);
  assert.equal(result.url, expected);
  assert.deepEqual(result.headers, { Range: 'bytes=0-131071', 'User-Agent': 'BiliApp', Host: 'cn-hk-eq-01-04.bilivideo.com' });
  assert.equal(request.headers.hOsT, '184.27.185.82');
  assert.equal(run(request).url, expected);
});

test('observed cosovbv variant is covered', () => {
  const request = { method: 'GET', url: 'http://185.163.0.1' + signed.replace('os=akam', 'os=cosovbv'), headers: {} };
  assert.equal(rewrite(request, argument).headers.Host, 'cn-hk-eq-01-04.bilivideo.com');
});

test('unrelated and unsafe requests continue unchanged', () => {
  const base = { method: 'GET', url: 'http://184.27.185.82' + signed, headers: { Host: '184.27.185.82' } };
  const cases = [
    [{ ...base, method: 'POST' }, argument],
    [{ ...base, url: base.url.replace('platform=ipad', 'platform=web') }, argument],
    [{ ...base, url: base.url.replace('gen=playurlv3', 'gen=other') }, argument],
    [{ ...base, url: base.url.replace('os=akam', 'os=other') }, argument],
    [{ ...base, url: base.url.replace('.m4s?', '.mp4?') }, argument],
    [{ ...base, url: base.url.replace('184.27.185.82', '192.168.1.1') }, argument],
    [{ ...base, url: base.url.replace('184.27.185.82', 'evil.example') }, argument],
    [base, 'enabled=false&host=cn-hk-eq-01-04.bilivideo.com'],
    [base, 'enabled=true&host=evil.example'],
    [base, 'enabled=true&host=cn-hk-eq-01-04.bilivideo.com:80'],
  ];
  for (const [request, arg] of cases) {
    assert.equal(rewrite(request, arg), null);
    assert.equal(Object.keys(run(request, arg)).length, 0);
  }
});
