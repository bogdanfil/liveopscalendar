const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source.slice(0, source.indexOf('function normalize(')), context);
const parseRange = vm.runInContext('parseRange', context);
const cycleYear = vm.runInContext('cycleYear', context);
const date = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

test('LTD full-year range preserves its explicit dates and 20-day duration', () => {
  const range = parseRange('01.02.2027 - 20.02.2027 ');
  assert.equal(date(range.start), '2027-02-01');
  assert.equal(date(range.end), '2027-02-20');
  assert.equal(Math.round((range.end - range.start) / 86400000) + 1, 20);
});

test('short ranges retain planning-cycle inference', () => {
  const range = parseRange('1.09 - 31.10');
  assert.equal(date(range.start), `${cycleYear}-09-01`);
  assert.equal(date(range.end), `${cycleYear}-10-31`);
  const winter = parseRange('20.12 - 06.01');
  assert.equal(date(winter.end), `${cycleYear + 1}-01-06`);
});

test('one-sided explicit years infer the year across December–January', () => {
  for (const value of ['20.12.2026 - 06.01', '20.12 - 06.01.2027']) {
    const range = parseRange(value);
    assert.equal(date(range.start), '2026-12-20');
    assert.equal(date(range.end), '2027-01-06');
  }
});

test('pasted spaces and typographic dashes are accepted', () => {
  for (const suffix of ['\u00a0', '&#x20;', '&nbsp;', '&#32;']) {
    assert.equal(date(parseRange(`01.02.2027 – 20.02.2027${suffix}`).end), '2027-02-20');
  }
  assert.equal(date(parseRange('01.02.2027 — 20.02.2027').end), '2027-02-20');
});

test('invalid dates, malformed years and reversed explicit ranges are rejected', () => {
  for (const value of ['', '-', '31.02.2027 - 05.03.2027', '29.02.2027 - 01.03.2027', '01.13 - 02.13', '01.02.2027 - 20.02.2026', '01.02.20270 - 20.02.2027']) {
    assert.equal(parseRange(value), null, value);
  }
  assert.equal(date(parseRange('29.02.2028 - 01.03.2028').start), '2028-02-29');
});
