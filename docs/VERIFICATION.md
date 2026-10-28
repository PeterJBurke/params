# Verification record

Retrieved 2026-10-28 from the ArduPilot autotest server, which publishes the
parameter definitions generated from each tagged firmware release:

| Firmware | Source URL | SHA-256 (see `sources/SHA256SUMS-upstream.txt`) |
|---|---|---|
| ArduCopter 4.7.1 (stable) | <https://autotest.ardupilot.org/Parameters/versioned/Copter/stable-4.7.1/apm.pdef.xml> | recorded |
| ArduCopter 4.6.3 (stable) | <https://autotest.ardupilot.org/Parameters/versioned/Copter/stable-4.6.3/apm.pdef.xml> | recorded |
| Human-readable list | <https://ardupilot.org/copter/docs/parameters.html> | n/a |

The extracts of the parameters the checker depends on are committed as
`sources/copter-4.7.1-relevant.json` and `sources/copter-4.6.3-relevant.json`
(produced by `tools/extract-pdef.py`). Re-run the extractor when a new stable
release ships and diff the JSON.

## Enum codes used as automatic checks

| Parameter | Code | Text in 4.6.3 | Text in 4.7.1 | Course meaning |
|---|---|---|---|---|
| `FS_THR_ENABLE` | 3 | Enabled always Land | Enabled always Land | "Radio failsafe: Always Land" |
| `FENCE_ACTION` | 2 | Always Land | Always Land | "Fence breach: Always Land" |
| `FENCE_ENABLE` | 0 / 1 | Disabled / Enabled | Disabled / Enabled | off for cages, on for ARC |
| `COMPASS_ENABLE` | 1 | Enabled | Enabled | |
| `GPS_AUTO_CONFIG` | 0 | Disables automatic configuration | Disables automatic configuration | |
| `GPS1_TYPE` / `GPS_TYPE` | 1 | AUTO | AUTO | |

Full enum tables for `FS_THR_ENABLE` (0 to 7) and `FENCE_ACTION` (0 to 5) are in
the JSON extracts. Only the two Always-Land codes are accepted as PASS.

## Units

| Parameter | 4.6.3 | 4.7.1 |
|---|---|---|
| `RTL_ALT` | cm, range 30 to 300000 | absent |
| `RTL_ALT_M` | absent | m, range 0.30 to 3000 |
| `FENCE_ALT_MAX` | m | m (frame selectable via new `FENCE_ALT_MAX_TP`) |
| `BATT_LOW_VOLT` | V | V |
| `EK3_GLITCH_RAD` | m, documented range 10 to 100; 0 means "clip instead of reject" | same |

## Arming checks

4.6.3 `ARMING_CHECK`, "Arm Checks to Perform (bitmask)":
bit 0 All, 1 Barometer, 2 Compass, 3 GPS lock, 4 INS, 5 Parameters, 6 RC
Channels, 7 Board voltage, 8 Battery Level, 10 Logging Available, 11 Hardware
safety switch, 12 GPS Configuration, 13 System, 14 Mission, 15 Rangefinder,
16 Camera, 17 AuxAuth, 18 VisualOdometry, 19 FFT. Default 1 (all).

4.7.1 `ARMING_SKIPCHK`, "Arm Checks to Skip (bitmask)": same bit numbers 1 to
19, no bit 0. Default 0 (skip none). The official text: "In extreme
circumstances, a value of -1 can be used to skip all non-mandatory current and
future checks."

Bit 9 is not defined in either release. GPS-related bits are 3 and 12 only.
Derived values (also asserted by the tests):

- all individual bits 1 to 19 except 9: 1048062 (equivalent to `ARMING_CHECK = 1`)
- `ARMING_SKIPCHK` GPS-only skips: 8, 4096, 4104
- `ARMING_CHECK` GPS-only skips: 1048054, 1043966, 1043958

## Renames used for schema detection

Each name exists in exactly one of the two definition files:

| 4.6.3 only | 4.7.1 only |
|---|---|
| `ARMING_CHECK` | `ARMING_SKIPCHK` |
| `RTL_ALT` | `RTL_ALT_M` |
| `RTL_CLIMB_MIN` | `RTL_CLIMB_MIN_M` |
| `LAND_SPEED` | `LAND_SPD_MS` |
| `PILOT_SPEED_UP` / `PILOT_SPEED_DN` | `PILOT_SPD_UP` / `PILOT_SPD_DN` |
| `WPNAV_SPEED` | `WP_SPD` |
| `WPNAV_RADIUS` | `WP_RADIUS_M` |
| `LOIT_SPEED` | `LOIT_SPEED_MS` (the handoff's `LOIT_SPD_MS` does not exist) |
| `ANGLE_MAX` | `ATC_ANGLE_MAX` |
| `CIRCLE_RADIUS` | `CIRCLE_RADIUS_M` |
| `RTL_SPEED`, `PILOT_ACCEL_Z`, `SYSID_THISMAV` | `FENCE_ALT_MAX_TP` |

`GPS_TYPE` appears in both files only as a documentation stub ("Renamed in 4.6
and later to GPS1_TYPE"); a real export containing it is from before 4.6.
`GPS_AUTO_CONFIG` keeps its name in 4.7.1.

## What is NOT verified here

- The course checklist values themselves (6.1 V, 25 m, 0 m glitch radius, the
  profile table) come from the instructor's handoff document, not from ArduPilot.
- Which firmware is on any given aircraft. The page says so on every result.
