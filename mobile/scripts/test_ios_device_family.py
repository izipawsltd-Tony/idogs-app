import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from ios_device_family import make_iphone_only, is_iphone_only, plist_is_iphone_only  # noqa: E402

TEMPLATE = '''
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t};
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
'''


class DeviceFamilyTest(unittest.TestCase):
    def test_stock_template_is_universal(self):
        self.assertFalse(is_iphone_only(TEMPLATE))

    def test_rewrites_every_configuration(self):
        out = make_iphone_only(TEMPLATE)
        self.assertTrue(is_iphone_only(out))
        self.assertEqual(out.count('TARGETED_DEVICE_FAMILY = 1;'), 2)
        self.assertNotIn('"1,2"', out)
        self.assertIn('SWIFT_VERSION = 5.0;', out)

    def test_idempotent(self):
        once = make_iphone_only(TEMPLATE)
        self.assertEqual(make_iphone_only(once), once)

    def test_missing_setting_fails_closed(self):
        with self.assertRaises(ValueError):
            make_iphone_only('SWIFT_VERSION = 5.0;')
        self.assertFalse(is_iphone_only('SWIFT_VERSION = 5.0;'))

    def test_plist(self):
        self.assertTrue(plist_is_iphone_only({'UIDeviceFamily': [1]}))
        self.assertFalse(plist_is_iphone_only({'UIDeviceFamily': [1, 2]}))
        self.assertFalse(plist_is_iphone_only({}))


if __name__ == '__main__':
    unittest.main()
