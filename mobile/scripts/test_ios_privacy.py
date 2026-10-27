import plistlib
import tempfile
import unittest
from pathlib import Path
from ios_privacy import configure, PURPOSES


class IOSPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "Info.plist"

    def write(self, data, fmt=plistlib.FMT_XML):
        self.path.write_bytes(plistlib.dumps(data, fmt=fmt))

    def test_fresh_generated_plist_is_rejected_until_configured(self):
        original = {"CFBundleIdentifier": "au.com.idogs.app", "CFBundleVersion": "90", "Nested": {"Keep": True}}
        self.write(original)
        with self.assertRaises(ValueError):
            configure(self.path, check=True)
        configure(self.path)
        configure(self.path, check=True)
        data = plistlib.loads(self.path.read_bytes())
        for key, value in original.items():
            self.assertEqual(data[key], value)
        first = self.path.read_bytes()
        configure(self.path)
        self.assertEqual(self.path.read_bytes(), first)

    def test_exported_binary_plist_checks_both_purposes_without_modifying_it(self):
        self.write({**PURPOSES, "CFBundleVersion": "91"}, plistlib.FMT_BINARY)
        before = self.path.read_bytes()
        configure(self.path, check=True)
        self.assertEqual(self.path.read_bytes(), before)
        for key in PURPOSES:
            for value in [None, "", False, "A generic old description"]:
                data = dict(PURPOSES)
                data[key] = value if value is not None else ""
                self.write(data, plistlib.FMT_BINARY)
                with self.assertRaises(ValueError):
                    configure(self.path, check=True)

    def test_malformed_root_cannot_be_silently_replaced(self):
        self.write(["not an app plist"])
        with self.assertRaises(ValueError):
            configure(self.path)


if __name__ == "__main__":
    unittest.main()
