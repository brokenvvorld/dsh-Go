import 'dart:convert';
import 'dart:io';

import 'package:dsh_app/l10n/l10n.dart';
import 'package:dsh_app/ui/settings/openai_capabilities_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../engine_settings/support.dart';

void main() {
  testWidgets('capability page reads the Host schema, changes enabled state and displays cloud disclosure', (
    tester,
  ) async {
    final host = FakeSettingsHost(
      describe: (jsonDecode(File('test/openai/fixtures/settings.json').readAsStringSync()) as Map)
          .cast<String, Object?>(),
    );
    final client = await fakeClient(host);
    await pumpPage(
      tester,
      const OpenAICapabilitiesPage(),
      overrides: engineOverrides(client),
      fonts: true,
      height: 1400,
    );
    final l10n = lookupL10n(AppLocale.zhCN);
    expect(find.text(l10n.openaiCapabilitiesTitle), findsWidgets);
    expect(find.text(l10n.openaiSharedKey), findsOneWidget);
    expect(find.text(l10n.openaiVoiceDisclosure), findsOneWidget);
    expect(tester.takeException(), isNull);
    await expectLater(find.byType(OpenAICapabilitiesPage), matchesGoldenFile('goldens/capabilities.png'));
    await tester.tap(find.byType(Switch).first);
    await flush(tester);
    expect(host.mutates().last['ns'], 'dsh-go-openai');
    expect((host.mutates().last['ops'] as List).single['value'], false);
  });

  testWidgets('older Host explains runtime update instead of showing a working toggle', (tester) async {
    final host = FakeSettingsHost(describe: {'writable': true, 'namespaces': <Object?>[]});
    await pumpPage(tester, const OpenAICapabilitiesPage(), overrides: engineOverrides(await fakeClient(host)));
    expect(find.text(lookupL10n(AppLocale.zhCN).openaiRuntimeMissing), findsOneWidget);
    expect(find.byType(Switch), findsNothing);
  });
}
