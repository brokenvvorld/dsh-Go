"""The runtime overlay loads OpenAI alongside the existing bridge."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('rtbuild', Path(__file__).resolve().parents[1] / 'lib/rtbuild.py')
rtbuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rtbuild)


class OpenAIBundle(unittest.TestCase):
    def test_overlay_preserves_bridge_and_registers_openai_once(self):
        entries = rtbuild.overlay_entries({}, with_bridge=True, with_openai=True)
        patch = entries[rtbuild.DSH_WEB_PATCH.lstrip('/')].read().decode()
        self.assertIn('id: dsh-go-bridge', patch)
        self.assertIn(rtbuild.bridge_shared_rows(), patch)
        self.assertEqual(patch.count('id: dsh-go-openai'), 1)
        self.assertIn('name: /opt/dsh/node_modules/dsh-go-openai/lib/index.js', patch)

    def test_runtime_without_openai_does_not_insert_missing_module(self):
        entries = rtbuild.overlay_entries({}, with_bridge=True)
        self.assertNotIn('dsh-go-openai', entries[rtbuild.DSH_WEB_PATCH.lstrip('/')].read().decode())


if __name__ == '__main__':
    unittest.main()
