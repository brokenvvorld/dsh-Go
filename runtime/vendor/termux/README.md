# 固定的 Termux PRoot 包 / Pinned Termux PRoot packages

Termux 的滚动仓库已经移除本项目固定使用的 PRoot 5.1.107.98。本目录保留官方构建的原始 `.deb`，供全新机器打包；不升级 PRoot，也不修改已有 SHA-256 pin。`runtime/build-runtime.sh` 在使用前校验文件，损坏时直接失败。

Termux's rolling repository no longer indexes the pinned PRoot 5.1.107.98. These are the unmodified official packages. The runtime builder checks them against its existing SHA-256 pins before use; it does not silently upgrade PRoot.

- 官方构建 / Official build: https://github.com/termux/termux-packages/actions/runs/39199950210
- 构建配方 / Build recipe: https://github.com/termux/termux-packages/tree/9aedff9c28af3ca93c42eb2c3074221893232ae9/packages/proot
- 对应源码 / Corresponding source: https://github.com/termux/proot/tree/v5.1.107.98
- 源码归档 / Source archive: https://github.com/termux/proot/archive/refs/tags/v5.1.107.98.zip
- 源码 SHA-256 / Source SHA-256: `9de61bddd6f5016d065e2755b72ff4747290e5f992562f031785b107b51d02ba`
- 许可证 / License: GPL-2.0. The runtime build downloads the pinned source archive and includes its COPYING in the APK; see [THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).

| Package | Original Actions artifact | SHA-256 |
|---|---|---|
| `proot_5.1.107.98_aarch64.deb` | `12163314230` | `29de40efea4daa2a6168b617915206511c63e8d46bf5f4b07d48723441ef7f3b` |
| `proot_5.1.107.98_x86_64.deb` | `12164090536` | `1c31ad7e1046f4d418fef19b6dfaa9a14801d2047ade6ad0375b3f5501e3e227` |

文件取自各 artifact ZIP 内的 `debs-<arch>-<commit>.tar`，按文件名提取后独立核对上表哈希。
Files were extracted from the artifact ZIP's `debs-<arch>-<commit>.tar` and independently checked against the pins above.
