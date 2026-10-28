/*
 * EECS 195 Drone Parameter Checker - core logic (no DOM).
 * Shared by index.html (browser) and tests/run-tests.js (Node).
 *
 * Canonical model: every course requirement is a semantic value in canonical
 * units (e.g. rtl_altitude_m = 15). Each parameter alias (4.6-style or
 * 4.7-style name) is normalized to the canonical value BEFORE comparison.
 * Raw values are never compared across aliases.
 *
 * Source of truth for names, units and enum codes: official ArduPilot
 * parameter definitions (see docs/VERIFICATION.md).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ParamChecker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  const SOURCES = {
    copter471: 'https://autotest.ardupilot.org/Parameters/versioned/Copter/stable-4.7.1/apm.pdef.xml',
    copter463: 'https://autotest.ardupilot.org/Parameters/versioned/Copter/stable-4.6.3/apm.pdef.xml',
    paramDocs: 'https://ardupilot.org/copter/docs/parameters.html',
    retrieved: '2026-10-28'
  };

  // ------------------------------------------------------------------
  // Parsing
  // Accepts Mission Planner (NAME,VALUE), MAVProxy (NAME VALUE),
  // tab-separated, NAME=VALUE, and QGroundControl (vehid compid NAME VALUE type).
  // Comment lines start with # or //. Names are upper-cased. Last duplicate wins
  // and duplicates are reported.
  // ------------------------------------------------------------------
  const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const RE_STD = new RegExp('^([A-Za-z_][A-Za-z0-9_]*)\\s*[,\\t =:]\\s*(' + NUM + ')\\s*(?:[,\\t ].*)?$');
  const RE_QGC = new RegExp('^\\d+\\s+\\d+\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+(' + NUM + ')(?:\\s+\\d+)?\\s*$');

  function parse(text) {
    const params = Object.create(null);
    const duplicates = [];
    const unparsed = [];
    const lines = String(text || '').split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim();
      if (!s || s[0] === '#' || s.startsWith('//')) continue;
      const m = RE_STD.exec(s) || RE_QGC.exec(s);
      if (!m) { unparsed.push({ line: i + 1, text: s.slice(0, 80) }); continue; }
      const name = m[1].toUpperCase();
      const value = Number(m[2]);
      if (!Number.isFinite(value)) { unparsed.push({ line: i + 1, text: s.slice(0, 80) }); continue; }
      if (name in params) duplicates.push({ name, first: params[name], last: value, line: i + 1 });
      params[name] = value;
    }
    return { params, duplicates, unparsed, count: Object.keys(params).length };
  }

  // ------------------------------------------------------------------
  // Schema detection (an INFERENCE from parameter names, never a statement
  // about which firmware is flashed). Markers verified against the 4.6.3 and
  // 4.7.1 definition files: each name below exists in exactly one of them.
  // ------------------------------------------------------------------
  const MARKERS_46 = ['ARMING_CHECK', 'RTL_ALT', 'RTL_CLIMB_MIN', 'RTL_SPEED', 'LAND_SPEED',
    'PILOT_SPEED_UP', 'PILOT_SPEED_DN', 'PILOT_ACCEL_Z', 'WPNAV_SPEED', 'WPNAV_RADIUS',
    'LOIT_SPEED', 'ANGLE_MAX', 'CIRCLE_RADIUS', 'SYSID_THISMAV'];
  const MARKERS_47 = ['ARMING_SKIPCHK', 'RTL_ALT_M', 'RTL_CLIMB_MIN_M', 'LAND_SPD_MS',
    'PILOT_SPD_UP', 'PILOT_SPD_DN', 'WP_SPD', 'WP_RADIUS_M', 'LOIT_SPEED_MS',
    'ATC_ANGLE_MAX', 'CIRCLE_RADIUS_M', 'FENCE_ALT_MAX_TP'];
  // GPS_TYPE was renamed GPS1_TYPE in 4.6; its presence points at a pre-4.6 export.
  const MARKERS_PRE46 = ['GPS_TYPE'];

  function detectSchema(params) {
    const has = (n) => Object.prototype.hasOwnProperty.call(params, n);
    const old = MARKERS_46.filter(has);
    const neu = MARKERS_47.filter(has);
    const pre46 = MARKERS_PRE46.filter(has);
    let label = 'unknown';
    if (old.length && neu.length) label = 'mixed';
    else if (neu.length) label = '4.7-style';
    else if (old.length || pre46.length) label = '4.6-style';
    return { label, old, neu, pre46 };
  }

  // ------------------------------------------------------------------
  // Arming-check semantics.
  // 4.6: ARMING_CHECK  = bitmask of checks to PERFORM. 1 (bit 0 "All") = all.
  // 4.7: ARMING_SKIPCHK = bitmask of checks to SKIP. 0 = skip none. -1 = skip all
  //      non-mandatory checks. Bit numbers below are from the official 4.7.1
  //      definition. Bit 9 is not defined in either firmware.
  // Both are normalized to the same canonical value: the SET of skipped checks.
  // ------------------------------------------------------------------
  const ARMING_BITS = {
    1: 'Barometer', 2: 'Compass', 3: 'GPS lock', 4: 'INS', 5: 'Parameters', 6: 'RC Channels',
    7: 'Board voltage', 8: 'Battery Level', 10: 'Logging Available', 11: 'Hardware safety switch',
    12: 'GPS Configuration', 13: 'System', 14: 'Mission', 15: 'Rangefinder', 16: 'Camera',
    17: 'AuxAuth', 18: 'VisualOdometry', 19: 'FFT'
  };
  const ARMING_BIT_LIST = Object.keys(ARMING_BITS).map(Number);
  const GPS_BITS = [3, 12]; // the only GPS-related arming checks in the official table
  const ALL_INDIVIDUAL_BITS_VALUE = ARMING_BIT_LIST.reduce((a, b) => a + Math.pow(2, b), 0); // 1048062

  function skippedFromSkipchk(v) {
    if (v === -1) return { all: true, bits: ARMING_BIT_LIST.slice() };
    if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) return { invalid: true, bits: [] };
    const bits = ARMING_BIT_LIST.filter((b) => (v / Math.pow(2, b)) % 2 >= 1);
    const undefinedBits = [];
    for (let b = 0; b < 32; b++) if ((v / Math.pow(2, b)) % 2 >= 1 && !(b in ARMING_BITS)) undefinedBits.push(b);
    return { all: false, bits, undefinedBits };
  }
  function skippedFromCheck(v) {
    if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) return { invalid: true, bits: [] };
    if (v % 2 === 1) return { all: false, bits: [] }; // bit 0 "All" set
    if (v === 0) return { all: true, bits: ARMING_BIT_LIST.slice() };
    const bits = ARMING_BIT_LIST.filter((b) => (v / Math.pow(2, b)) % 2 < 1);
    return { all: false, bits };
  }
  function describeSkipped(sk) {
    if (sk.invalid) return 'invalid value';
    if (sk.all) return 'ALL checks skipped';
    if (!sk.bits.length) return 'no checks skipped';
    return 'skips: ' + sk.bits.map((b) => ARMING_BITS[b]).join(', ');
  }
  function sameBits(a, b) {
    if (a.invalid || b.invalid) return false;
    if (a.all !== b.all) return false;
    const x = a.bits.slice().sort().join(','), y = b.bits.slice().sort().join(',');
    return x === y;
  }
  // Values the 10-foot maiden-flight profile accepts as "GPS exceptions only".
  function approvedGpsOnlyValues() {
    const subsets = [[3], [12], [3, 12]];
    return {
      ARMING_SKIPCHK: subsets.map((s) => s.reduce((a, b) => a + Math.pow(2, b), 0)),            // 8, 4096, 4104
      ARMING_CHECK: subsets.map((s) => ALL_INDIVIDUAL_BITS_VALUE - s.reduce((a, b) => a + Math.pow(2, b), 0)) // 1048054, 1043966, 1043958
    };
  }

  // ------------------------------------------------------------------
  // Enum texts (official definitions; identical in 4.6.3 and 4.7.1)
  // ------------------------------------------------------------------
  const ENUM = {
    FS_THR_ENABLE: { 0: 'Disabled', 1: 'Enabled always RTL', 2: 'Enabled Continue with Mission in Auto Mode (removed in 4.0+)', 3: 'Enabled always Land', 4: 'Enabled always SmartRTL or RTL', 5: 'Enabled always SmartRTL or Land', 6: 'Enabled Auto DO_LAND_START/DO_RETURN_PATH_START or RTL', 7: 'Enabled always Brake or Land' },
    FENCE_ACTION: { 0: 'Report Only', 1: 'RTL or Land', 2: 'Always Land', 3: 'SmartRTL or RTL or Land', 4: 'Brake or Land', 5: 'SmartRTL or Land' },
    FENCE_ENABLE: { 0: 'Disabled', 1: 'Enabled' },
    COMPASS_ENABLE: { 0: 'Disabled', 1: 'Enabled' },
    GPS_AUTO_CONFIG: { 0: 'Disables automatic configuration', 1: 'Serial GPSes only', 2: 'DroneCAN as well', 3: 'Clear all configurations not set by ArduPilot (uBlox only)' },
    GPS_TYPE: { 0: 'None', 1: 'AUTO', 2: 'uBlox', 5: 'NMEA', 9: 'DroneCAN', 14: 'MAVLink', 21: 'ExternalAHRS' }
  };
  ENUM.GPS1_TYPE = ENUM.GPS_TYPE;

  function fmtEnum(name, v) {
    const t = ENUM[name] && ENUM[name][v];
    return t ? v + ' (' + t + ')' : String(v);
  }
  function fmtNum(v) {
    return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  }

  // ------------------------------------------------------------------
  // Requirement catalogue.
  // profiles: arc = ARC outdoor, cage20 = 20-foot cage, cage10 = 10-foot maiden.
  // Each profile entry is either {expect: canonicalValue} or {review: 'reason'}
  // (manual review, never auto-pass). Absent profile => requirement not shown.
  // ------------------------------------------------------------------
  const REQUIREMENTS = [
    {
      id: 'arming', label: 'Pre-arm checks', canonical: 'set of skipped checks', kind: 'arming',
      aliases: [
        { name: 'ARMING_SKIPCHK', units: 'skip-bitmask', style: '4.7' },
        { name: 'ARMING_CHECK', units: 'perform-bitmask', style: '4.6' }
      ],
      profiles: {
        arc: { expect: 'none', text: 'No checks skipped (ARMING_SKIPCHK = 0, or ARMING_CHECK = 1)' },
        cage20: { expect: 'none', text: 'No checks skipped (ARMING_SKIPCHK = 0, or ARMING_CHECK = 1)' },
        cage10: { expect: 'gps-only', text: 'No checks skipped, or GPS exceptions only (ARMING_SKIPCHK = 8, 4096 or 4104; ARMING_CHECK = 1048054, 1043966 or 1043958)' }
      },
      note: 'ARMING_SKIPCHK lists checks to SKIP (0 = none). ARMING_CHECK lists checks to PERFORM (1 = all). ARMING_CHECK = 0 disables all checks and is never acceptable. The 10-foot maiden-flight checklist permits GPS-related exceptions only; any other skipped check needs instructor sign-off.'
    },
    {
      id: 'batt_low', label: 'Low battery voltage', canonical: 'V', kind: 'value',
      aliases: [{ name: 'BATT_LOW_VOLT', units: 'V', factor: 1 }],
      profiles: { arc: { expect: 6.1 }, cage20: { expect: 6.1 }, cage10: { expect: 6.1 } },
      note: 'Course value for the class battery. Confirm cell count and chemistry before relying on it.'
    },
    {
      id: 'ek3_glitch', label: 'EKF GPS glitch radius', canonical: 'm', kind: 'value',
      aliases: [{ name: 'EK3_GLITCH_RAD', units: 'm', factor: 1 }],
      profiles: { arc: { expect: 0 }, cage20: { expect: 0 }, cage10: { expect: 0 } },
      note: '0 makes the EKF clip GPS innovations instead of rejecting them (official definition). Course setting.'
    },
    {
      id: 'rtl_alt', label: 'RTL altitude', canonical: 'm', kind: 'value',
      aliases: [
        { name: 'RTL_ALT_M', units: 'm', factor: 1, style: '4.7' },
        { name: 'RTL_ALT', units: 'cm', factor: 0.01, style: '4.6' }
      ],
      profiles: {
        arc: { expect: 15 },
        cage20: { expect: 2 },
        cage10: { review: 'Not required by the 10-foot maiden-flight checklist.' }
      },
      note: 'RTL_ALT is in centimetres (4.6), RTL_ALT_M in metres (4.7). Both are converted to metres before comparison. ARC and the 20-foot cage intentionally differ (15 m vs 2 m).'
    },
    {
      id: 'fence_enable', label: 'Geofence enabled', canonical: 'enum', kind: 'enum',
      aliases: [{ name: 'FENCE_ENABLE', units: 'enum' }],
      profiles: { arc: { expect: 1 }, cage20: { expect: 0 }, cage10: { expect: 0 } },
      note: 'ARC requires the fence ON; both cages require it OFF. This is a course difference, not a firmware naming issue.'
    },
    {
      id: 'fence_alt_max', label: 'Fence maximum altitude', canonical: 'm', kind: 'value',
      aliases: [{ name: 'FENCE_ALT_MAX', units: 'm', factor: 1 }],
      profiles: { arc: { expect: 25 }, cage20: { expect: 25 } },
      note: 'Metres in both firmware generations.'
    },
    {
      id: 'fs_thr', label: 'Radio failsafe action', canonical: 'enum', kind: 'enum',
      aliases: [{ name: 'FS_THR_ENABLE', units: 'enum' }],
      profiles: { arc: { expect: 3 }, cage20: { expect: 3 } },
      note: 'Checklist: Always Land. Code 3 = "Enabled always Land" in the official 4.6.3 and 4.7.1 definitions (verified 2026-10-28). Still test the failsafe physically.'
    },
    {
      id: 'fence_action', label: 'Fence breach action', canonical: 'enum', kind: 'enum',
      aliases: [{ name: 'FENCE_ACTION', units: 'enum' }],
      profiles: { arc: { expect: 2 }, cage20: { expect: 2 } },
      note: 'Checklist: Always Land. Code 2 = "Always Land" in the official 4.6.3 and 4.7.1 definitions (verified 2026-10-28).'
    },
    {
      id: 'compass', label: 'Compass enabled', canonical: 'enum', kind: 'enum',
      aliases: [{ name: 'COMPASS_ENABLE', units: 'enum' }],
      profiles: { arc: { expect: 1 }, cage20: { expect: 1 }, cage10: { review: 'Set 0 only if no compass is installed (maiden-flight checklist).' } },
      note: ''
    },
    {
      id: 'gps_auto', label: 'GPS auto-config', canonical: 'enum', kind: 'enum',
      aliases: [{ name: 'GPS_AUTO_CONFIG', units: 'enum' }],
      profiles: { arc: { expect: 0 }, cage20: { expect: 0 } },
      note: 'Same name in 4.6 and 4.7.'
    },
    {
      id: 'gps_type', label: 'GPS type', canonical: 'enum', kind: 'enum',
      aliases: [
        { name: 'GPS1_TYPE', units: 'enum', style: '4.6+' },
        { name: 'GPS_TYPE', units: 'enum', style: 'pre-4.6' }
      ],
      profiles: { arc: { expect: 1 }, cage20: { expect: 1 }, cage10: { review: 'Set 0 only if no GPS is installed (maiden-flight checklist).' } },
      note: 'GPS_TYPE was renamed GPS1_TYPE in Copter 4.6. 1 = AUTO.'
    }
  ];

  const PROFILES = {
    arc: 'ARC outdoor flight',
    cage20: '20-foot cage',
    cage10: '10-foot maiden flight'
  };

  const TOL = 1e-6;
  const has = (p, n) => Object.prototype.hasOwnProperty.call(p, n);

  function evaluateRequirement(req, profile, params) {
    const rule = req.profiles[profile];
    if (!rule) return null;
    const found = req.aliases.filter((a) => has(params, a.name));
    const row = {
      id: req.id, label: req.label, expected: rule.text || '', note: req.note || '',
      found: found.map((a) => a.name), raw: [], normalized: '', status: 'MISSING', detail: ''
    };

    if (req.kind === 'arming') {
      row.expected = rule.text;
      if (!found.length) { row.detail = 'Neither ARMING_SKIPCHK nor ARMING_CHECK is present.'; return row; }
      const sk = found.map((a) => {
        const v = params[a.name];
        row.raw.push(a.name + ' = ' + fmtNum(v) + ' (' + a.units + ')');
        return a.name === 'ARMING_SKIPCHK' ? skippedFromSkipchk(v) : skippedFromCheck(v);
      });
      if (sk.length > 1 && !sameBits(sk[0], sk[1])) {
        row.status = 'CONFLICT';
        row.normalized = found.map((a, i) => a.name + ': ' + describeSkipped(sk[i])).join(' | ');
        row.detail = 'The two aliases disagree. A stale alias may remain in the exported file; confirm on the aircraft which parameter the installed firmware uses.';
        return row;
      }
      const s = sk[0];
      row.normalized = describeSkipped(s);
      if (s.undefinedBits && s.undefinedBits.length) row.detail = 'Undefined bit(s) set: ' + s.undefinedBits.join(', ') + '. ';
      if (sk.length > 1) row.detail += 'Both aliases present and agree (a stale alias may remain in the file). ';
      if (s.invalid) { row.status = 'FAIL'; row.detail += 'Value is not a valid bitmask.'; return row; }
      const skippedBits = s.bits;
      if (!skippedBits.length) { row.status = 'PASS'; return row; }
      if (rule.expect === 'none') { row.status = 'FAIL'; row.detail += 'Checks are being skipped.'; return row; }
      // cage10: GPS-only exceptions allowed
      if (s.all) { row.status = 'FAIL'; row.detail += 'All checks skipped is never acceptable.'; return row; }
      const nonGps = skippedBits.filter((b) => GPS_BITS.indexOf(b) < 0);
      if (!nonGps.length) { row.status = 'PASS'; row.detail += 'GPS exception(s) only, permitted for the 10-foot maiden flight.'; return row; }
      row.status = 'REVIEW';
      row.detail += 'Skips non-GPS check(s): ' + nonGps.map((b) => ARMING_BITS[b]).join(', ') + '. Not on the approved list; instructor sign-off required.';
      return row;
    }

    // value / enum requirements
    if (rule.review) row.expected = 'Manual review';
    else row.expected = req.kind === 'enum' ? fmtEnum(req.aliases[0].name, rule.expect) : fmtNum(rule.expect) + ' ' + req.canonical;

    if (!found.length) {
      if (rule.review) { row.status = 'REVIEW'; row.detail = 'Not present in file. ' + rule.review; }
      else row.detail = 'Not present in file. Missing parameters are not treated as zero.';
      return row;
    }
    const norm = found.map((a) => {
      const v = params[a.name];
      row.raw.push(a.name + ' = ' + fmtNum(v) + (a.units === 'enum' ? '' : ' ' + a.units));
      return req.kind === 'enum' ? v : v * (a.factor || 1);
    });
    const fmtN = (v) => req.kind === 'enum' ? fmtEnum(req.aliases[0].name, v) : fmtNum(v) + ' ' + req.canonical;
    if (norm.length > 1 && Math.abs(norm[0] - norm[1]) > TOL) {
      row.status = 'CONFLICT';
      row.normalized = found.map((a, i) => a.name + ' -> ' + fmtN(norm[i])).join(' | ');
      row.detail = 'The two aliases disagree after unit conversion. A stale alias may remain in the exported file; confirm on the aircraft which parameter the installed firmware uses.';
      return row;
    }
    row.normalized = fmtN(norm[0]);
    if (norm.length > 1) row.detail = 'Both aliases present and agree (a stale alias may remain in the file). ';
    if (rule.review) { row.status = 'REVIEW'; row.detail += rule.review; return row; }
    row.status = Math.abs(norm[0] - rule.expect) <= TOL ? 'PASS' : 'FAIL';
    return row;
  }

  function firmwareWarning(enteredVersion, schema) {
    const v = String(enteredVersion || '').trim();
    if (!v) return '';
    const m = /^(\d+)\.(\d+)/.exec(v);
    if (!m) return 'Firmware version "' + v + '" not understood (expected e.g. 4.7.1).';
    const major = +m[1], minor = +m[2];
    const is47plus = major > 4 || (major === 4 && minor >= 7);
    if (is47plus && schema.label === '4.6-style') return 'You entered firmware ' + v + ' but the file uses 4.6-style names. The file may be an older export or from a different vehicle.';
    if (!is47plus && schema.label === '4.7-style') return 'You entered firmware ' + v + ' but the file uses 4.7-style names. The file may be from a newer firmware or a different vehicle.';
    if (schema.label === 'mixed') return 'The file mixes 4.6-style and 4.7-style names; verify against firmware ' + v + ' on the aircraft.';
    return '';
  }

  function evaluate(parsed, profile, options) {
    options = options || {};
    if (!PROFILES[profile]) throw new Error('Unknown profile: ' + profile);
    const params = parsed.params;
    const schema = detectSchema(params);
    const rows = REQUIREMENTS.map((r) => evaluateRequirement(r, profile, params)).filter(Boolean);
    const counts = { PASS: 0, FAIL: 0, CONFLICT: 0, MISSING: 0, REVIEW: 0 };
    rows.forEach((r) => { counts[r.status]++; });
    const warnings = [];
    if (schema.label === 'mixed') warnings.push('File contains both 4.6-style (' + schema.old.join(', ') + ') and 4.7-style (' + schema.neu.join(', ') + ') names. Each alias is checked independently; conflicts are flagged.');
    if (schema.pre46.length) warnings.push('Contains ' + schema.pre46.join(', ') + ', a name replaced in Copter 4.6; this may be an old export.');
    if (parsed.duplicates.length) warnings.push('Duplicate parameter lines (last value used): ' + parsed.duplicates.map((d) => d.name + ' (line ' + d.line + ')').join(', ') + '.');
    if (parsed.unparsed.length) warnings.push(parsed.unparsed.length + ' line(s) could not be parsed, e.g. line ' + parsed.unparsed[0].line + ': "' + parsed.unparsed[0].text + '".');
    if (parsed.count === 0) warnings.push('No parameters were parsed. Is this a .param file?');
    const fw = firmwareWarning(options.firmwareVersion, schema);
    if (fw) warnings.push(fw);
    const problems = counts.FAIL + counts.CONFLICT + counts.MISSING;
    const verdict = problems > 0 ? 'NOT READY' : (counts.REVIEW > 0 ? 'NO AUTOMATIC FAILURES, MANUAL REVIEW NEEDED' : 'ALL AUTOMATIC CHECKS PASSED');
    return {
      profile, profileName: PROFILES[profile], schema, rows, counts, warnings, verdict,
      firmwareVersion: String(options.firmwareVersion || '').trim(), checkerVersion: VERSION
    };
  }

  function toCSV(result, fileName) {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const meta = [
      ['EECS 195 Drone Parameter Checker', 'v' + result.checkerVersion],
      ['File', fileName || ''],
      ['Profile', result.profileName],
      ['Detected schema (inferred from names)', result.schema.label],
      ['Firmware version (entered by user, unverified)', result.firmwareVersion || ''],
      ['Verdict', result.verdict],
      ['Generated', new Date().toISOString()],
      []
    ];
    const head = ['Requirement', 'Parameter(s) found', 'Raw value(s)', 'Normalized value', 'Expected', 'Result', 'Details', 'Notes'];
    const body = result.rows.map((r) => [r.label, r.found.join(' / ') || '-', r.raw.join(' / ') || '-', r.normalized || '-', r.expected, r.status, r.detail, r.note]);
    const warn = result.warnings.length ? [[], ['Warnings'], ...result.warnings.map((w) => [w])] : [];
    return [...meta, head, ...body, ...warn].map((a) => a.map(q).join(',')).join('\r\n') + '\r\n';
  }

  return {
    VERSION, SOURCES, PROFILES, REQUIREMENTS, ENUM, ARMING_BITS, GPS_BITS, ALL_INDIVIDUAL_BITS_VALUE,
    MARKERS_46, MARKERS_47, MARKERS_PRE46,
    parse, detectSchema, evaluate, toCSV, firmwareWarning, approvedGpsOnlyValues,
    _internal: { skippedFromSkipchk, skippedFromCheck, describeSkipped }
  };
});
