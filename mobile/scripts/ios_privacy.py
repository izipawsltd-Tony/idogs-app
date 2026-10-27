"""Configure and verify camera/photo purpose strings in generated and built apps."""
import argparse
import plistlib
from pathlib import Path

PURPOSES = {
    "NSCameraUsageDescription": "iDogs uses your camera to photograph dog documents for scanning and to add dog profile photos.",
    "NSPhotoLibraryUsageDescription": "iDogs lets you choose existing photos of dogs and documents to add to your dog records or scan with your permission.",
}


def configure(path, check=False):
    path = Path(path)
    with path.open("rb") as source:
        data = plistlib.load(source)
    if not isinstance(data, dict):
        raise ValueError("iOS Info.plist must be a dictionary")
    if check:
        for key, purpose in PURPOSES.items():
            if data.get(key) != purpose:
                raise ValueError(f"Missing or incorrect iOS purpose string: {key}")
    else:
        data.update(PURPOSES)
        with path.open("wb") as destination:
            plistlib.dump(data, destination, sort_keys=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("plist")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    configure(args.plist, args.check)
    print("iOS camera and photo purpose strings verified" if args.check else "iOS camera and photo purpose strings configured")
