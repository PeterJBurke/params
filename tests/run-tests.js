'use strict';
// Run with: node tests/run-tests.js   (Node 18+)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../checker.js');

const FX = path.join(__dirname, 'fixtures');
const fixture = (n) => C.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const byId = (res) => Object.fromEntries(res.rows.map((r) => [r.id, r]));
const statuses = (res) => Object.fromEntries(res.rows.map((r) => [r.id, r.status]));

test('parses Mission Planner, MAVProxy, QGC and CRLF formats', () => {
  assert.equal(fixture('arc-4.7-pass.param').count, 17);
  assert.equal(fixture('mavproxy-format.parm').count, 11);
  const q = fixture('qgc-format.params');
  assert.equal(q.count, 11);
  assert.equal(q.params.RTL_ALT_M, 15);
  assert.equal(q.unparsed.length, 0, 'QGC header comments must not count as unparsed');
  assert.deepEqual({ ...fixture('crlf.param').params }, { ARMING_SKIPCHK: 0, RTL_ALT_M: 15 });
});

test('duplicate keys: last wins and is reported; junk lines reported, not fatal', () => {
  const p = fixture('duplicates-and-junk.param');
  assert.equal(p.params.RTL_ALT_M, 15);
  assert.equal(p.duplicates.length, 1);
  assert.equal(p.duplicates[0].name, 'RTL_ALT_M');
  assert.equal(p.unparsed.length, 2);
  const r = C.evaluate(p, 'arc');
  assert.ok(r.warnings.some((w) => /Duplicate/.test(w)));
  assert.ok(r.warnings.some((w) => /could not be parsed/.test(w)));
});

test('schema detection is name-based and labelled', () => {
  assert.equal(C.detectSchema(fixture('arc-4.7-pass.param').params).label, '4.7-style');
  assert.equal(C.detectSchema(fixture('arc-4.6-pass.param').params).label, '4.6-style');
  assert.equal(C.detectSchema(fixture('mixed-agree.param').params).label, 'mixed');
  assert.equal(C.detectSchema(fixture('missing.param').params).label, 'unknown');
  const s = C.detectSchema(fixture('cage20-4.6-pass.param').params);
  assert.deepEqual(s.pre46, ['GPS_TYPE']);
});

test('ARC profile: 4.7-style file passes everything', () => {
  const r = C.evaluate(fixture('arc-4.7-pass.param'), 'arc');
  assert.equal(r.counts.PASS, r.rows.length, JSON.stringify(statuses(r)));
  assert.equal(r.verdict, 'ALL AUTOMATIC CHECKS PASSED');
  const b = byId(r);
  assert.match(b.rtl_alt.raw[0], /RTL_ALT_M = 15 m/);
  assert.equal(b.rtl_alt.normalized, '15 m');
  assert.equal(b.fs_thr.normalized, '3 (Enabled always Land)');
  assert.equal(b.fence_action.normalized, '2 (Always Land)');
  assert.equal(b.arming.normalized, 'no checks skipped');
});

test('ARC profile: 4.6-style file passes everything after unit conversion', () => {
  const r = C.evaluate(fixture('arc-4.6-pass.param'), 'arc');
  assert.equal(r.counts.PASS, r.rows.length, JSON.stringify(statuses(r)));
  const b = byId(r);
  assert.match(b.rtl_alt.raw[0], /RTL_ALT = 1500 cm/);
  assert.equal(b.rtl_alt.normalized, '15 m');
  assert.match(b.arming.raw[0], /ARMING_CHECK = 1/);
});

test('20-foot cage: RTL 2 m and fence disabled, in both nomenclatures', () => {
  for (const f of ['cage20-4.7-pass.param', 'cage20-4.6-pass.param']) {
    const r = C.evaluate(fixture(f), 'cage20');
    assert.equal(r.counts.PASS, r.rows.length, f + ' ' + JSON.stringify(statuses(r)));
    const b = byId(r);
    assert.equal(b.rtl_alt.normalized, '2 m');
    assert.equal(b.fence_enable.normalized, '0 (Disabled)');
  }
});

test('profile differences are preserved: an ARC-correct file fails the 20-foot cage and vice versa', () => {
  const arcFile = fixture('arc-4.7-pass.param');
  const s1 = statuses(C.evaluate(arcFile, 'cage20'));
  assert.equal(s1.rtl_alt, 'FAIL');
  assert.equal(s1.fence_enable, 'FAIL');
  const s2 = statuses(C.evaluate(fixture('cage20-4.6-pass.param'), 'arc'));
  assert.equal(s2.rtl_alt, 'FAIL');
  assert.equal(s2.fence_enable, 'FAIL');
});

test('raw values are never compared across aliases: RTL_ALT_M=1500 is a FAIL, not a pass', () => {
  const r = byId(C.evaluate(fixture('wrong-values.param'), 'arc'));
  assert.equal(r.rtl_alt.status, 'FAIL');
  assert.equal(r.rtl_alt.normalized, '1500 m');
});

test('wrong values fail with enum text shown', () => {
  const r = C.evaluate(fixture('wrong-values.param'), 'arc');
  const s = statuses(r);
  for (const id of ['arming', 'batt_low', 'ek3_glitch', 'rtl_alt', 'fence_enable', 'fence_alt_max', 'fs_thr', 'fence_action', 'compass', 'gps_auto', 'gps_type']) {
    assert.equal(s[id], 'FAIL', id);
  }
  const b = byId(r);
  assert.equal(b.fs_thr.normalized, '1 (Enabled always RTL)');
  assert.equal(b.fence_action.normalized, '1 (RTL or Land)');
  assert.equal(b.arming.normalized, 'ALL checks skipped');
  assert.equal(r.verdict, 'NOT READY');
});

test('ARMING_CHECK=0 is never accepted as enabling checks, in any profile', () => {
  const p = C.parse('ARMING_CHECK,0\n');
  for (const prof of ['arc', 'cage20', 'cage10']) assert.equal(byId(C.evaluate(p, prof)).arming.status, 'FAIL', prof);
});

test('ARMING_SKIPCHK=-1 (skip all) is never accepted', () => {
  const p = fixture('skip-all.param');
  for (const prof of ['arc', 'cage20', 'cage10']) assert.equal(byId(C.evaluate(p, prof)).arming.status, 'FAIL', prof);
});

test('missing parameters are MISSING, not zero, and review items are REVIEW', () => {
  const r = C.evaluate(fixture('missing.param'), 'arc');
  const s = statuses(r);
  assert.equal(s.batt_low, 'PASS');
  assert.equal(s.arming, 'MISSING');
  assert.equal(s.rtl_alt, 'MISSING');
  assert.equal(s.fence_enable, 'MISSING');
  assert.equal(r.verdict, 'NOT READY');
  const s10 = statuses(C.evaluate(fixture('missing.param'), 'cage10'));
  assert.equal(s10.rtl_alt, 'REVIEW');
  assert.equal(s10.compass, 'REVIEW');
  assert.equal(s10.gps_type, 'REVIEW');
});

test('conflicting aliases are CONFLICT even when one alias matches', () => {
  const r = C.evaluate(fixture('conflict.param'), 'arc');
  const b = byId(r);
  assert.equal(b.rtl_alt.status, 'CONFLICT');      // RTL_ALT=1500 (15 m, matches) vs RTL_ALT_M=2
  assert.equal(b.arming.status, 'CONFLICT');       // ARMING_CHECK=1 (none) vs ARMING_SKIPCHK=8 (GPS lock)
  assert.equal(b.gps_type.status, 'CONFLICT');     // GPS1_TYPE=1 vs GPS_TYPE=2
  assert.match(b.rtl_alt.normalized, /RTL_ALT_M -> 2 m/);
  assert.match(b.rtl_alt.normalized, /RTL_ALT -> 15 m/);
  assert.equal(r.schema.label, 'mixed');
  assert.ok(r.warnings.some((w) => /both 4.6-style/.test(w)));
  assert.equal(r.verdict, 'NOT READY');
});

test('both aliases present and agreeing pass, with a stale-alias note', () => {
  const r = C.evaluate(fixture('mixed-agree.param'), 'arc');
  assert.equal(r.counts.PASS, r.rows.length, JSON.stringify(statuses(r)));
  const b = byId(r);
  assert.match(b.rtl_alt.detail, /stale alias/);
  assert.match(b.arming.detail, /stale alias/);
});

test('10-foot maiden: GPS-only arming exceptions pass, others need review, all-checks still passes', () => {
  const ok = C.approvedGpsOnlyValues();
  assert.deepEqual(ok.ARMING_SKIPCHK, [8, 4096, 4104]);
  assert.deepEqual(ok.ARMING_CHECK, [1048054, 1043966, 1043958]);
  for (const v of ok.ARMING_SKIPCHK) {
    const b = byId(C.evaluate(C.parse('ARMING_SKIPCHK,' + v + '\n'), 'cage10'));
    assert.equal(b.arming.status, 'PASS', 'SKIPCHK ' + v);
    assert.match(b.arming.detail, /GPS exception/);
  }
  for (const v of ok.ARMING_CHECK) {
    assert.equal(byId(C.evaluate(C.parse('ARMING_CHECK,' + v + '\n'), 'cage10')).arming.status, 'PASS', 'CHECK ' + v);
  }
  assert.equal(byId(C.evaluate(fixture('cage10-gps-skip.param'), 'cage10')).arming.status, 'PASS');
  assert.equal(byId(C.evaluate(fixture('cage10-4.6-gps-skip.param'), 'cage10')).arming.status, 'PASS');
  assert.equal(byId(C.evaluate(C.parse('ARMING_SKIPCHK,0\n'), 'cage10')).arming.status, 'PASS');
  // Skipping the compass is NOT a GPS exception
  const sc = byId(C.evaluate(fixture('skip-compass.param'), 'cage10')).arming;
  assert.equal(sc.status, 'REVIEW');
  assert.match(sc.detail, /Compass/);
  // Mixed GPS + compass => review too
  assert.equal(byId(C.evaluate(C.parse('ARMING_SKIPCHK,12\n'), 'cage10')).arming.status, 'REVIEW');
  // ARMING_CHECK with the "All" bit set alongside others still means all checks
  assert.equal(byId(C.evaluate(C.parse('ARMING_CHECK,73\n'), 'cage10')).arming.status, 'PASS');
});

test('the same GPS exceptions FAIL in ARC and the 20-foot cage', () => {
  for (const prof of ['arc', 'cage20']) {
    assert.equal(byId(C.evaluate(fixture('cage10-gps-skip.param'), prof)).arming.status, 'FAIL', prof);
  }
});

test('10-foot maiden never shows a pass for RTL, compass or GPS type', () => {
  const r = C.evaluate(fixture('arc-4.7-pass.param'), 'cage10');
  const s = statuses(r);
  assert.equal(s.rtl_alt, 'REVIEW');
  assert.equal(s.compass, 'REVIEW');
  assert.equal(s.gps_type, 'REVIEW');
  assert.equal(s.fence_enable, 'FAIL'); // ARC file has fence on; maiden flight requires off
  assert.ok(!('fs_thr' in s) && !('fence_action' in s) && !('fence_alt_max' in s) && !('gps_auto' in s), 'not in the 10-foot checklist');
});

test('firmware version entered by the user only produces warnings, never changes results', () => {
  const p = fixture('arc-4.6-pass.param');
  const a = C.evaluate(p, 'arc');
  const b = C.evaluate(p, 'arc', { firmwareVersion: '4.7.1' });
  assert.deepEqual(statuses(a), statuses(b));
  assert.ok(b.warnings.some((w) => /4\.6-style names/.test(w)));
  assert.equal(C.firmwareWarning('4.6.3', C.detectSchema(p.params)), '');
  assert.match(C.firmwareWarning('banana', C.detectSchema(p.params)), /not understood/);
  assert.match(C.firmwareWarning('4.6.3', C.detectSchema(fixture('arc-4.7-pass.param').params)), /4\.7-style names/);
});

test('CSV export contains metadata, every row and the warnings', () => {
  const r = C.evaluate(fixture('conflict.param'), 'arc', { firmwareVersion: '4.7.1' });
  const csv = C.toCSV(r, 'conflict.param');
  assert.match(csv, /"Profile","ARC outdoor flight"/);
  assert.match(csv, /"Detected schema \(inferred from names\)","mixed"/);
  assert.match(csv, /"RTL altitude"/);
  assert.match(csv, /"CONFLICT"/);
  assert.match(csv, /"Warnings"/);
  assert.equal(csv.split('\r\n').filter((l) => /","(PASS|FAIL|CONFLICT|MISSING|REVIEW)","/.test(l)).length, r.rows.length);
});

test('no requirement can ever auto-pass when the profile says review', () => {
  for (const req of C.REQUIREMENTS) {
    for (const [prof, rule] of Object.entries(req.profiles)) {
      if (!rule.review) continue;
      // feed the "ideal" ARC file and make sure the row is REVIEW regardless
      const st = byId(C.evaluate(fixture('arc-4.7-pass.param'), prof))[req.id].status;
      assert.equal(st, 'REVIEW', req.id + ' in ' + prof);
    }
  }
});

test('official enum codes used by the checker are the documented ones', () => {
  assert.equal(C.ENUM.FS_THR_ENABLE[3], 'Enabled always Land');
  assert.equal(C.ENUM.FENCE_ACTION[2], 'Always Land');
  assert.equal(C.ARMING_BITS[3], 'GPS lock');
  assert.equal(C.ARMING_BITS[12], 'GPS Configuration');
  assert.deepEqual(C.GPS_BITS, [3, 12]);
  assert.equal(C.ALL_INDIVIDUAL_BITS_VALUE, 1048062);
});
