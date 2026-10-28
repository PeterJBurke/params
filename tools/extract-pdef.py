#!/usr/bin/env python3
"""Extract the parameter definitions the checker relies on from an official
ArduPilot apm.pdef.xml file into a small JSON record for docs/sources/.

Usage:
  curl -o /tmp/copter-4.7.1.pdef.xml \
    https://autotest.ardupilot.org/Parameters/versioned/Copter/stable-4.7.1/apm.pdef.xml
  python3 -I tools/extract-pdef.py /tmp/copter-4.7.1.pdef.xml 4.7.1 > docs/sources/copter-4.7.1-relevant.json
"""
import json, sys, xml.etree.ElementTree as ET
from datetime import date

NAMES = ['ARMING_CHECK', 'ARMING_SKIPCHK', 'RTL_ALT', 'RTL_ALT_M', 'FS_THR_ENABLE', 'FENCE_ACTION',
         'FENCE_ENABLE', 'FENCE_ALT_MAX', 'GPS_TYPE', 'GPS1_TYPE', 'GPS_AUTO_CONFIG', 'COMPASS_ENABLE',
         'BATT_LOW_VOLT', 'EK3_GLITCH_RAD', 'LAND_SPEED', 'LAND_SPD_MS', 'PILOT_SPEED_UP', 'PILOT_SPD_UP',
         'WPNAV_SPEED', 'WP_SPD', 'LOIT_SPEED', 'LOIT_SPEED_MS', 'RTL_CLIMB_MIN', 'RTL_CLIMB_MIN_M',
         'ANGLE_MAX', 'ATC_ANGLE_MAX', 'CIRCLE_RADIUS', 'CIRCLE_RADIUS_M', 'WPNAV_RADIUS', 'WP_RADIUS_M',
         'PILOT_SPEED_DN', 'PILOT_SPD_DN', 'PILOT_ACCEL_Z', 'RTL_SPEED', 'SYSID_THISMAV', 'FENCE_ALT_MAX_TP']

def main(path, version):
    root = ET.parse(path).getroot()
    out = {'firmware': 'ArduCopter ' + version, 'source_file': path.split('/')[-1],
           'extracted': date.today().isoformat(), 'parameters': {}}
    for p in root.iter('param'):
        n = p.get('name', '').split(':')[-1]
        if n not in NAMES:
            continue
        rec = {'humanName': p.get('humanName'), 'documentation': (p.get('documentation') or '').strip()}
        for f in p.findall('field'):
            rec[f.get('name')] = (f.text or '').strip()
        vals = p.findall('values/value')
        if vals:
            rec['values'] = {v.get('code'): (v.text or '').strip() for v in vals}
        out['parameters'][n] = rec
    out['absent'] = sorted(set(NAMES) - set(out['parameters']))
    json.dump(out, sys.stdout, indent=1, sort_keys=False)
    sys.stdout.write('\n')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
