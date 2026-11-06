"""Exercise the real resolver without network or executing downloaded binaries."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = (ROOT / 'runtime/build-runtime.sh').read_text().rsplit('main "$@"', 1)[0]


class VendoredTermuxTest(unittest.TestCase):
    def resolve(self, arch, corrupt=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            name = f'proot_5.1.107.98_{arch}.deb'
            vendor = root / 'vendor/termux'
            vendor.mkdir(parents=True)
            target = vendor / name
            shutil.copyfile(ROOT / 'runtime/vendor/termux' / name, target)
            if corrupt:
                target.write_bytes(b'corrupt')
            script = SCRIPT + '''
HERE="$TEST_ROOT"
CACHE="$TEST_ROOT/cache"
fetch() { die "unexpected network request"; }
termux_deb proot 5.1.107.98 "$TEST_ARCH"
'''
            entry = root / 'resolve.sh'
            entry.write_text(script)
            result = subprocess.run(['bash', str(entry)], capture_output=True, text=True,
                                    env={**os.environ, 'TEST_ROOT': folder, 'TEST_ARCH': arch})
            if not corrupt:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(Path(result.stdout).read_bytes(), target.read_bytes())
            return result

    def test_both_original_packages_resolve_offline(self):
        for arch in ('aarch64', 'x86_64'):
            with self.subTest(arch=arch):
                self.resolve(arch)

    def test_tampered_package_is_rejected(self):
        result = self.resolve('aarch64', corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('vendored package hash mismatch', result.stderr)


if __name__ == '__main__':
    unittest.main()
