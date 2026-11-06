import unittest

from ci_android_signing import SECRET_NAMES, property_value, signing_mode


class SigningPolicyTest(unittest.TestCase):
    def test_unsigned_configuration_is_only_allowed_for_artifacts(self):
        self.assertEqual(signing_mode({}, False), "debug")
        with self.assertRaisesRegex(ValueError, "ANDROID_KEYSTORE_BASE64"):
            signing_mode({}, True)

    def test_partial_configuration_never_silently_uses_debug_key(self):
        for name in SECRET_NAMES:
            with self.subTest(name=name), self.assertRaises(ValueError):
                signing_mode({name: "configured"}, False)

    def test_complete_configuration_can_publish(self):
        self.assertEqual(signing_mode(dict.fromkeys(SECRET_NAMES, "configured"), True), "release")

    def test_missing_secret_error_does_not_disclose_other_secrets(self):
        with self.assertRaises(ValueError) as result:
            signing_mode({SECRET_NAMES[0]: "private-keystore-contents"}, True)
        self.assertNotIn("private-keystore-contents", str(result.exception))

    def test_passwords_survive_java_properties_metacharacters(self):
        self.assertEqual(property_value(" p:a=s\\word\n\t"), "\\ p\\:a\\=s\\\\word\\n\\t")
        self.assertEqual(property_value("密钥🔑"), "\\u5bc6\\u94a5\\ud83d\\udd11")


if __name__ == "__main__":
    unittest.main()
