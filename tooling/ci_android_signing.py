#!/usr/bin/env python3
"""Restore Android signing secrets without printing their contents.

No secrets: allow a disposable debug signature for Actions artifacts only.
Partial configuration, or a publication without a key: fail before building.
"""

import base64
import hashlib
import os
from pathlib import Path
import subprocess
import sys

SECRET_NAMES = (
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
)


def signing_mode(env, publish):
    present = [bool(env.get(name)) for name in SECRET_NAMES]
    if all(present):
        return "release"
    if any(present) or publish:
        missing = ", ".join(name for name, exists in zip(SECRET_NAMES, present) if not exists)
        raise ValueError(f"缺少 Android 签名 Secrets：{missing}；见 docs/android-release.md")
    return "debug"


def property_value(value):
    # java.util.Properties uses ISO-8859-1 and treats backslashes/whitespace specially.
    encoded = []
    for char in value:
        if char in "\\ :=#!":
            encoded.append("\\" + char)
        elif char in "\n\r\t\f":
            encoded.append({"\n": "\\n", "\r": "\\r", "\t": "\\t", "\f": "\\f"}[char])
        elif not 32 <= ord(char) <= 126:
            units = char.encode("utf-16-be")
            encoded.extend(f"\\u{int.from_bytes(units[i:i + 2], 'big'):04x}" for i in range(0, len(units), 2))
        else:
            encoded.append(char)
    return "".join(encoded)


def main():
    mode = signing_mode(os.environ, os.environ.get("PUBLISH_RELEASE") == "true")
    if mode == "release":
        directory = Path(os.environ["RUNNER_TEMP"]) / "android-signing"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        keystore = directory / "release.jks"
        try:
            content = base64.b64decode("".join(os.environ[SECRET_NAMES[0]].split()), validate=True)
        except ValueError:
            raise ValueError("ANDROID_KEYSTORE_BASE64 不是有效的 base64") from None
        if not content:
            raise ValueError("签名 keystore 为空")
        keystore.write_bytes(content)
        keystore.chmod(0o600)
        cert = subprocess.run(
            ["keytool", "-exportcert", "-keystore", str(keystore),
             "-storepass:env", "ANDROID_KEYSTORE_PASSWORD", "-alias", os.environ["ANDROID_KEY_ALIAS"]],
            capture_output=True,
        )
        if cert.returncode:
            raise ValueError("无法读取签名证书，请检查 keystore、密码和 alias")
        (directory / "certificate.sha256").write_text(hashlib.sha256(cert.stdout).hexdigest())
        props = {
            "storeFile": str(keystore),
            "storePassword": os.environ["ANDROID_KEYSTORE_PASSWORD"],
            "keyAlias": os.environ["ANDROID_KEY_ALIAS"],
            "keyPassword": os.environ["ANDROID_KEY_PASSWORD"],
        }
        path = Path(__file__).resolve().parent.parent / "app/android/key.properties"
        path.write_text("".join(f"{key}={property_value(value)}\n" for key, value in props.items()), encoding="ascii")
        path.chmod(0o600)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"mode={mode}\n")
    print("使用固定发布签名" if mode == "release" else "未配置发布签名：仅生成 Actions 测试包，不发布 Release")


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        sys.exit(str(error))
