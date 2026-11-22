import 'dart:ui' show SemanticsAction;

import 'package:dsh_app/l10n/l10n.dart';
import 'package:dsh_app/links/external_link.dart';
import 'package:dsh_app/state/app_info.dart';
import 'package:dsh_app/ui/settings/about_page.dart';
import 'package:dsh_app/ui/settings/settings_widgets.dart';
import 'package:dsh_app/ui/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_fonts.dart';

const _profiles = [
  ('about-author-bilibili', 'https://b23.tv/9WBns6Y'),
  ('about-author-x', 'https://x.com/cccch1mneyyyy'),
  ('about-author-github', 'https://github.com/ccch1mneyyy'),
];

void main() {
  late List<Uri> opened;
  late Future<bool> Function(Uri) opener;

  setUp(() {
    opened = [];
    opener = (uri) async {
      opened.add(uri);
      return true;
    };
  });

  tearDown(() => AppLocale.use(AppLocale.zhCN));

  Future<void> pump(
    WidgetTester tester, {
    Locale locale = AppLocale.zhCN,
    Brightness brightness = Brightness.light,
    double scale = 1,
  }) async {
    AppLocale.use(locale);
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(360, 800);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          externalLinkOpenerProvider.overrideWithValue((uri) => opener(uri)),
        ],
        child: MaterialApp(
          theme: withTestFonts(buildLightTheme()),
          darkTheme: withTestFonts(buildDarkTheme()),
          themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
          locale: locale,
          supportedLocales: AppLocale.supported,
          localizationsDelegates: L10n.localizationsDelegates,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: const AboutPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, String key) async {
    final row = find.byKey(ValueKey(key));
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();
  }

  for (final locale in AppLocale.supported) {
    for (final brightness in Brightness.values) {
      testWidgets('author profiles fit 360dp at 1.3x in $locale $brightness', (tester) async {
        await pump(tester, locale: locale, brightness: brightness, scale: 1.3);
        final english = locale == AppLocale.en;
        expect(find.text(english ? 'Original author of DSH Go' : 'DSH Go 原作者'), findsOneWidget);
        expect(find.text('ccch1mneyyy'), findsOneWidget);
        expect(find.text('ccchimneyyy'), findsOneWidget);
        expect(find.text('@cccch1mneyyyy'), findsOneWidget);
        expect(find.text('@ccch1mneyyy'), findsOneWidget);
        expect(find.text(AppInfo.displayVersion), findsOneWidget);
        expect(find.byKey(const ValueKey('settings-star')), findsNothing);
        expect(find.text(english ? 'Check for updates' : '检查更新'), findsNothing);
        expect(find.text(english ? 'Check automatically' : '自动检查更新'), findsNothing);
        expect(find.text(english ? 'Bilibili profile' : 'B站主页'), findsOneWidget);
        expect(find.text(english ? 'X profile' : 'X 主页'), findsOneWidget);
        expect(find.text(english ? 'GitHub profile' : 'GitHub 主页'), findsOneWidget);

        for (final (key, _) in _profiles) {
          final row = find.byKey(ValueKey(key));
          await tester.ensureVisible(row);
          await tester.pumpAndSettle();
          expect(tester.getSize(row).height, greaterThanOrEqualTo(64));
          expect(tester.widget<SettingsTile>(row).onTap, isNotNull);
          expect(tester.takeException(), isNull, reason: 'No overflow at $key');
        }
        final disclaimer = find.text(
          english ? 'Built on DeepSeek Harness · Unofficial DeepSeek app' : '基于 DeepSeek Harness 构建 · 非 DeepSeek 官方应用',
        );
        await tester.ensureVisible(disclaimer);
        await tester.pumpAndSettle();
        expect(disclaimer.hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('each author profile opens its exact personal URL', (tester) async {
    await pump(tester);
    for (final (key, _) in _profiles) {
      await tap(tester, key);
    }
    expect(opened.map((uri) => uri.toString()), _profiles.map((profile) => profile.$2));
  });

  testWidgets('no browser copies the original B23 URL and reports it', (tester) async {
    String? clipboard;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') clipboard = (call.arguments as Map)['text'] as String?;
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    opener = (_) async => false;
    await pump(tester);
    await tap(tester, 'about-author-bilibili');
    expect(clipboard, 'https://b23.tv/9WBns6Y');
    expect(find.text('没能打开浏览器，网址已复制'), findsOneWidget);
  });

  testWidgets('browser and clipboard exceptions report failure without claiming a copy', (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') throw PlatformException(code: 'no-clipboard');
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    opener = (_) async => throw PlatformException(code: 'no-browser');
    await pump(tester, locale: AppLocale.en);
    await tap(tester, 'about-author-x');
    expect(find.text(lookupL10n(AppLocale.en).stateBrowserOpenFailed), findsOneWidget);
    expect(find.text(lookupL10n(AppLocale.en).shellBrowserUrlCopied), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('profiles are announced as actionable links', (tester) async {
    final semantics = tester.ensureSemantics();
    try {
      await pump(tester, locale: AppLocale.en);
      for (final (key, _) in _profiles) {
        final row = find.byKey(ValueKey(key));
        await tester.ensureVisible(row);
        await tester.pumpAndSettle();
        final node = tester.getSemantics(row);
        expect(node.flagsCollection.isLink, isTrue);
        expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      }
    } finally {
      semantics.dispose();
    }
  });
}
