#!/usr/bin/env python3
"""Make the generated Capacitor iOS project iPhone-only.

The stock Capacitor template targets iPhone and iPad (TARGETED_DEVICE_FAMILY
= "1,2"). iDogs 1.0 ships for iPhone only, so App Store Connect does not
require 13-inch iPad screenshots and the app is not offered as an iPad app.

Usage:
  ios_device_family.py <project.pbxproj>                 rewrite to "1"
  ios_device_family.py <project.pbxproj> --check         fail unless every setting is "1"
  ios_device_family.py --check-plist <built Info.plist>  fail unless UIDeviceFamily == [1]
"""
import plistlib
import re
import sys

SETTING = re.compile(r'TARGETED_DEVICE_FAMILY = ("?)([0-9, ]+)\1;')


def make_iphone_only(text):
    found = SETTING.findall(text)
    if not found:
        raise ValueError('TARGETED_DEVICE_FAMILY not found in project')
    return SETTING.sub('TARGETED_DEVICE_FAMILY = 1;', text)


def is_iphone_only(text):
    values = [v.replace(' ', '') for _, v in SETTING.findall(text)]
    return bool(values) and all(v == '1' for v in values)


def plist_is_iphone_only(data):
    return data.get('UIDeviceFamily') == [1]


def main(argv):
    if len(argv) == 3 and argv[1] == '--check-plist':
        with open(argv[2], 'rb') as f:
            data = plistlib.load(f)
        if not plist_is_iphone_only(data):
            print(f"UIDeviceFamily is {data.get('UIDeviceFamily')!r}, expected [1]", file=sys.stderr)
            return 1
        print('iOS built app is iPhone-only (UIDeviceFamily [1])')
        return 0
    if len(argv) not in (2, 3) or (len(argv) == 3 and argv[2] != '--check'):
        print(__doc__, file=sys.stderr)
        return 2
    path = argv[1]
    with open(path, encoding='utf-8') as f:
        text = f.read()
    if len(argv) == 3:
        if not is_iphone_only(text):
            print('TARGETED_DEVICE_FAMILY is not iPhone-only', file=sys.stderr)
            return 1
        print('iOS project is iPhone-only (TARGETED_DEVICE_FAMILY = 1)')
        return 0
    with open(path, 'w', encoding='utf-8') as f:
        f.write(make_iphone_only(text))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
