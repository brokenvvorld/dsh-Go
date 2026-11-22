"""Keep original app background paths out when upstream code is merged."""
from pathlib import Path
import re
import unittest
from xml.etree import ElementTree

APP = Path(__file__).resolve().parents[1] / "app"
NATIVE = APP / "android" / "app" / "src" / "main"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def sources(root, suffix, exclude=()):
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(root.rglob(f"*{suffix}"))
        if not path.name.endswith(exclude)
    )


class AppDistributionBoundariesTest(unittest.TestCase):
    def test_no_original_usage_report_or_self_update_in_app_sources(self):
        dart = sources(APP / "lib", ".dart", exclude=(".g.dart",))
        android = sources(NATIVE, ".kt")
        for match in (
            r"/api/usage/v[1-9]",
            r"\bdsh/(?:usage|update)\b",
            r"\b(?:usageStatsProvider|UpdateLaunchCheck|AppUpdateTiles)\b",
            r"\b(?:UsagePlugin|UpdatePlugin|ApkInstaller)\b",
        ):
            with self.subTest(pattern=match):
                self.assertIsNone(re.search(match, dart + "\n" + android))

    def test_app_cannot_request_package_install(self):
        manifest = ElementTree.parse(NATIVE / "AndroidManifest.xml")
        permissions = {
            entry.attrib.get(ANDROID + "name")
            for entry in manifest.getroot()
            if entry.tag.startswith("uses-permission")
        }
        self.assertNotIn("android.permission.REQUEST_INSTALL_PACKAGES", permissions)


if __name__ == "__main__":
    unittest.main()
