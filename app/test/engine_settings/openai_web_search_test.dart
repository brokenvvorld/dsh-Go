import 'dart:convert';
import 'dart:io';

import 'package:dsh_app/l10n/l10n.dart';
import 'package:dsh_app/ui/engine_settings/web_search_page.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';

FakeSettingsHost searchHost() {
  final host = FakeSettingsHost();
  final openai = FakeSettingsHost(
    describe: (jsonDecode(File('test/openai/fixtures/settings.json').readAsStringSync()) as Map)
        .cast<String, Object?>(),
  );
  host.namespaces.addAll(openai.namespaces);
  host.namespaces['web']!.base = {'searchProvider': 'openai', 'fetchProvider': 'http'};
  return host;
}

void main() {
  testWidgets('OpenAI search shows the shared key and does not ask for a DeepSeek key', (tester) async {
    final host = searchHost();
    await pumpPage(
      tester,
      const WebSearchSettingsPage(),
      overrides: engineOverrides(await fakeClient(host)),
      fonts: true,
    );
    final l10n = lookupL10n(AppLocale.zhCN);
    expect(find.text(l10n.openaiSharedKey), findsOneWidget);
    expect(find.text(l10n.openaiSearchHint), findsOneWidget);
    expect(find.text('DeepSeek 搜索'), findsNothing);
    expect(find.text('新版搜索 API'), findsNothing);
    expect(tester.takeException(), isNull);
    await expectLater(find.byType(WebSearchSettingsPage), matchesGoldenFile('goldens/openai_web_search.png'));
  });

  testWidgets('existing DeepSeek search switches to OpenAI in one write and can switch back', (tester) async {
    final host = searchHost();
    host.namespaces['web']!.user = {'searchProvider': 'deepseek-search-api', 'fetchProvider': 'deepseek-fetch-api'};
    await pumpPage(tester, const WebSearchSettingsPage(), overrides: engineOverrides(await fakeClient(host)));
    await tester.tap(find.text('OpenAI'));
    await flush(tester);
    expect(host.mutates().last['ns'], 'web');
    expect(host.mutates().last['ops'], [
      {
        'op': 'unset',
        'path': ['searchProvider'],
      },
      {
        'op': 'unset',
        'path': ['fetchProvider'],
      },
    ]);
    expect(find.text('DeepSeek 搜索'), findsNothing);
    await tester.tap(find.text('DeepSeek'));
    await flush(tester);
    expect(host.namespaces['web']!.value['searchProvider'], 'deepseek-official');
    expect(find.text('DeepSeek 搜索'), findsOneWidget);
  });
}
