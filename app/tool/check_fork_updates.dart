// Pure Dart check: release routing has no widget or font dependencies.
// Run with the same -D defines used by the APK build.
import 'dart:io';

import 'package:dsh_app/update/update_config.dart';

void require(bool condition, String message) {
  if (!condition) throw StateError(message);
}

void main() {
  const repo = String.fromEnvironment('DSH_UPDATE_REPO');
  require(repo.isNotEmpty, 'Pass -DDSH_UPDATE_REPO=owner/repo');
  final base = 'https://github.com/$repo/releases';
  final sources = defaultUpdateSources();
  require(githubLatestApi.toString() == 'https://api.github.com/repos/$repo/releases/latest', 'Wrong API repository');
  require(githubReleasesPage.toString() == '$base/latest', 'Wrong release page');
  require(githubLatestAsset('update.json').toString() == '$base/latest/download/update.json', 'Wrong manifest URL');
  final apk = githubReleaseAsset('v1.0.12', 'dsh-go-1.0.12-arm64.apk');
  require(apk.toString() == '$base/download/v1.0.12/dsh-go-1.0.12-arm64.apk', 'Wrong APK URL');
  require(sources.feed == null && sources.channel == null, 'Fork must not use an upstream update feed');
  require(sources.mirrors.every((mirror) => mirror.id != 'dshgo'), 'Upstream mirror must be disabled');
  require(sources.downloadUrls([apk]).first.url == apk, 'APK download must start at the fork');
  for (final endpoint in sources.metadataEndpoints()) {
    require(endpoint.url.toString().contains(repo), 'Metadata request escaped the fork');
    require(!endpoint.url.toString().contains('dshtui.com'), 'Metadata request still uses the upstream bucket');
  }
  stdout.writeln('Fork update URLs verified: $repo');
}
