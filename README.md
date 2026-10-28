# EECS 195 Drone Parameter Checker

**Live site: <https://peterjburke.github.io/params/>**

A single-page, browser-only tool for UCI EECS 195 / ECPS 295. Students drop the
`.param` file they saved from Mission Planner and get **GO** or **NO GO** for the
ARC outdoor flight checklist. The page is a copy of the original Fall 2025
checker embedded in the course Google Site (saved verbatim in
`docs/original-google-sites-checker-2026-10-28.html`): same title, drop zone,
and five-column table (Parameter, Units, Your Value, Correct Value, Check) with
the same eight rows, using **ArduCopter 4.7 parameter names only**
(`ARMING_SKIPCHK`, `RTL_ALT_M`), as the footer states. A 4.6-style file shows
"Not Found" for those two rows. The instructor chose this on 2026-10-28 ("do not
have two versions, assume ArduPilot 4.7"). The 4.6 alias handling, unit
conversion and conflict detection remain in `checker.js` and its tests but the
page strips the 4.6 names before evaluating.
Nothing is uploaded; the page works offline once loaded. Results export to CSV.

The page checks the ARC profile only. The two cage profiles are still defined
and tested in `checker.js` (see the table below) but have no UI, by the
instructor's choice (2026-10-28: "simple go / no go, only ARC").

The three GPS/compass rows the handoff's prototype added (`COMPASS_ENABLE`,
`GPS_AUTO_CONFIG`, `GPS1_TYPE`) are still checked in `checker.js` and its tests
but are not shown on the page, to match the original. Add their ids
(`compass`, `gps_auto`, `gps_type`) to the `ROWS` list in `index.html` to show them.

| Profile | RTL altitude | Geofence | Pre-arm checks |
|---|---|---|---|
| ARC outdoor flight | 15 m | enabled, 25 m ceiling, breach = Always Land | all |
| 20-foot cage | 2 m | disabled (ceiling still set to 25 m) | all |
| 10-foot maiden flight | not required (review) | disabled | all, or GPS-only exceptions |

## Why 4.6 vs 4.7 matters

ArduCopter 4.7 renamed several parameters and changed their units. The checker
treats every requirement as a canonical value in canonical units and converts
each alias to it before comparing. Raw numbers are never compared across aliases.

| Requirement | 4.6-style | 4.7-style | Normalization |
|---|---|---|---|
| All pre-arm checks | `ARMING_CHECK = 1` (checks to perform; 1 = all) | `ARMING_SKIPCHK = 0` (checks to skip; 0 = none) | both become "set of skipped checks". `ARMING_CHECK = 0` is always a FAIL. |
| RTL altitude | `RTL_ALT` in **cm** (1500, 200) | `RTL_ALT_M` in **m** (15, 2) | cm ÷ 100 |
| GPS type | `GPS_TYPE` (pre-4.6 name) | `GPS1_TYPE` (4.6 and later) | same enum |

If a file contains both names of a pair, each is normalized and compared
independently. If they agree, the row passes with a "stale alias may remain in
the file" note. If they disagree, the row is **CONFLICT** even when one of the two
matches, because the file cannot tell you which parameter the installed firmware
is actually using.

The "detected schema" line (4.6-style / 4.7-style / mixed / unknown) is an
inference from parameter names. It is never presented as the installed firmware
version. There is an optional box to enter the version read from the aircraft;
it only adds a warning when it disagrees with the names in the file.

## What was verified against official ArduPilot definitions

See `docs/VERIFICATION.md` for the full record. In short, from the official
Copter 4.6.3 and 4.7.1 parameter definition files (retrieved 2026-10-28):

- `FS_THR_ENABLE = 3` is "Enabled always Land" and `FENCE_ACTION = 2` is
  "Always Land" in both releases, so these two checklist items are now automatic
  checks instead of manual review.
- `ARMING_SKIPCHK` is a skip bitmask; bit 3 = GPS lock, bit 12 = GPS
  Configuration are the only GPS-related checks. -1 skips all non-mandatory
  checks and is rejected in every profile.
- `RTL_ALT` (cm) exists only in 4.6; `RTL_ALT_M` (m) only in 4.7.
  `ARMING_CHECK` exists only in 4.6; `ARMING_SKIPCHK` only in 4.7.

### 10-foot maiden-flight arming policy (instructor decision, encoded in `checker.js`)

The maiden-flight checklist allows GPS-related arming exceptions. The checker
accepts, as PASS with a note, exactly these values and nothing else:

| Nomenclature | Skip GPS lock only | Skip GPS Configuration only | Skip both |
|---|---|---|---|
| `ARMING_SKIPCHK` (4.7) | 8 | 4096 | 4104 |
| `ARMING_CHECK` (4.6, all individual bits set except the GPS ones) | 1048054 | 1043966 | 1043958 |

`0` / `1` (no checks skipped) also passes. Any other non-zero bitmask is
**REVIEW** with the list of skipped checks spelled out; skip-all is **FAIL**.
To change the policy edit `GPS_BITS` or the `cage10` rule of the `arming`
requirement in `checker.js`, then run the tests.

## Changing the requirements

All checklist values live in the `REQUIREMENTS` array near the top of
`checker.js`. Each requirement has aliases (name, units, conversion factor to
the canonical unit) and a per-profile rule: `{ expect: value }` for an automatic
check or `{ review: 'reason' }` for a manual-review row. A profile that is left
out hides the row for that profile. Edit, run `node tests/run-tests.js`, commit,
push. GitHub Pages republishes `main` within a minute or two.

## Tests

```
node tests/run-tests.js
```

Node 18 or newer, no dependencies. Fixtures in `tests/fixtures/` cover 4.6-style
and 4.7-style files for each profile, missing parameters, conflicting and
agreeing aliases, wrong values (including the `RTL_ALT_M = 1500` trap and
`ARMING_CHECK = 0`), skip-all, non-GPS skips, QGroundControl and MAVProxy
formats, duplicate keys, junk lines and CRLF line endings. The GitHub Actions
workflow runs the same suite on every push.

**Not yet done:** a hands-on check of the page on a phone. The layout switches
to stacked cards below 700 px wide, but nobody has tapped through it on a real
device yet.

## Deployment

- Repository: <https://github.com/PeterJBurke/params>
- GitHub Pages: deploy from branch `main`, folder `/ (root)`. No build step.
- Files: `index.html` (page and UI glue), `checker.js` (all logic, shared with
  the tests), `tests/`, `docs/`, `tools/extract-pdef.py` (regenerates the
  `docs/sources/*.json` provenance records from an official `apm.pdef.xml`).

## Limitations

This is a configuration checker, not an airworthiness tool. It cannot see the
installed firmware, wiring, calibration, battery state, fence geometry or how
failsafes behave in the air. The course's physical preflight checklist and
supervised failsafe tests remain mandatory.

## Licence

MIT. See `LICENSE`.
