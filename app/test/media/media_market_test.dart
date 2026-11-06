import 'package:dsh_app/state/media_generation.dart';
import 'package:dsh_app/state/plugins_state.dart';
import 'package:dsh_app/ui/plugins/plugin_detail_sheet.dart';
import 'package:dsh_app/ui/plugins/plugin_actions.dart';
import 'package:dsh_app/ui/plugins/plugins_screen.dart';
import 'package:dsh_app/ui/settings/media_settings_page.dart';
import 'package:dsh_app/update/version.dart';
import 'package:dsh_client/dsh_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../chat/support/harness.dart';
import '../plugins/support/fake_plugin_host.dart';

void main() {
  test('official and fallback media names; offered, installed, disabled, disconnected', () {
    for (final name in ['@dsh-go/media', '@ccchimneyyy/dsh-media', 'dsh-media', '@example/dsh-media']) {
      expect(isMediaPluginName(name), isTrue);
      final installed = PluginBundle.fromJson(bundleJson(name));
      expect(mediaPluginStateOf([installed]), MediaPluginState.ready);
      final disabled = PluginBundle.fromJson(bundleJson(name, enabled: false));
      expect(mediaPluginStateOf([disabled]), MediaPluginState.installable);
    }
    expect(isMediaPluginName('@example/media'), isFalse);
    expect(mediaPluginStateOf([], offered: true), MediaPluginState.installable);
    expect(mediaPluginStateOf([]), MediaPluginState.absent);
    expect(mediaPluginStateOf(null, offered: true), MediaPluginState.absent);
  });

  test('bundled media is ready without a profile dependency', () {
    const bundled = PluginBundle(name: '@ccch1mneyyy/dsh-media', availability: 'installation', enabled: true);
    expect(mediaPluginStateOf([bundled]), MediaPluginState.ready);
    expect(bundleGroup(bundled), BundleGroup.official);
  });

  late FakePluginCarrier carrier;
  late DshClient client;
  setUp(() {
    carrier = FakePluginCarrier();
    client = DshClient.withCarrier(carrier);
    carrier.handlers['pluginManager/listBundles'] = (_) => sampleBundles;
    carrier.handlers['pluginManager/installBundle'] = (_) => installResult(target: '@dsh-go/media');
  });
  tearDown(() => client.close());

  Future<void> pump(WidgetTester tester, {String appVersion = '1.0.2', bool settings = false}) async {
    usePhoneView(tester);
    await tester.pumpWidget(
      testApp(
        settings ? const MediaSettingsPage() : const Scaffold(body: MediaInstallPrompt()),
        overrides: [
          ...pluginOverrides(
            fakeHost(client),
            official: () async => officialFixtureMarket(),
            npmIntegrity: (name, _) async => officialFixtureMarket().byName[name]?.listing?.integrity,
          ),
          appVersionProvider.overrideWithValue(AppVersion.tryParse(appVersion)!),
        ],
      ),
    );
    final container = ProviderScope.containerOf(tester.element(find.byType(MediaInstallPrompt)));
    container.listen(installedPluginsProvider, (_, _) {});
    await tester.pumpAndSettle();
  }

  testWidgets('the generate install prompt installs the official pinned package', (tester) async {
    await pump(tester);
    final container = ProviderScope.containerOf(tester.element(find.byType(MediaInstallPrompt)));
    expect(container.read(mediaPluginProvider), MediaPluginState.installable);
    await tester.tap(find.text('在此主机上安装'));
    await tester.pumpAndSettle();
    expect(carrier.argsOf('pluginManager/installBundle').single['spec'], '@dsh-go/media@0.2.0');
  });

  testWidgets('media settings still offers installation when no plugin serves settings', (tester) async {
    await pump(tester, settings: true);
    expect(find.byType(MediaInstallPrompt), findsOneWidget);
    await tester.tap(find.text('在此主机上安装'));
    await tester.pumpAndSettle();
    expect(carrier.argsOf('pluginManager/installBundle').single['spec'], '@dsh-go/media@0.2.0');
  });

  testWidgets('an old app reaches the detail with a disabled install action', (tester) async {
    await pump(tester, appVersion: '1.0.1');
    await tester.tap(find.text('在此主机上安装'));
    await tester.pumpAndSettle();
    expect(find.byType(MarketPluginSheet), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, '需要 DSH Go 1.0.2 或更高版本')).onPressed, isNull);
    expect(carrier.argsOf('pluginManager/installBundle'), isEmpty);
  });

  testWidgets('a disabled installed media plugin opens management without reinstalling', (tester) async {
    carrier.handlers['pluginManager/listBundles'] = (_) => [bundleJson('@dsh-go/media', enabled: false)];
    await pump(tester);
    await tester.tap(find.text('在此主机上安装'));
    await tester.pumpAndSettle();
    expect(find.byType(PluginsScreen), findsOneWidget);
    expect(carrier.argsOf('pluginManager/installBundle'), isEmpty);
  });

  testWidgets('bundled media opens settings and cannot be replaced by the market package', (tester) async {
    carrier.handlers['pluginManager/listBundles'] = (_) => [
      {...bundleJson('@ccch1mneyyy/dsh-media'), 'availability': 'installation', 'installed': false, 'version': '0.3.1'},
    ];
    usePhoneView(tester);
    final entry = officialFixtureMarket().byName['@dsh-go/media']!;
    await tester.pumpWidget(
      testApp(
        Scaffold(body: MarketPluginSheet(entry: entry)),
        overrides: pluginOverrides(fakeHost(client)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('图像与视频'), findsOneWidget);
    expect(find.textContaining('随应用内置'), findsOneWidget);
    final context = tester.element(find.byType(MarketPluginSheet));
    await installMarketEntry(context, entry);
    await updateMarketEntry(context, entry);
    expect(carrier.argsOf('pluginManager/installBundle'), isEmpty);
    expect(carrier.argsOf('pluginManager/removeBundle'), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disabled bundled media stays visible and opens management without reinstalling', (tester) async {
    carrier.handlers['pluginManager/setBundleEnabled'] = (args) => {
      'stage': 'enable',
      'target': args['name'],
      'changed': true,
      'application': 'applied',
    };
    carrier.handlers['pluginManager/listBundles'] = (_) => [
      {...bundleJson('@ccch1mneyyy/dsh-media', enabled: false), 'availability': 'installation', 'installed': false},
    ];
    await pump(tester);
    expect(find.text('在此主机上安装'), findsNothing);
    expect(find.text('管理'), findsOneWidget);
    await tester.tap(find.text('管理'));
    await tester.pumpAndSettle();
    expect(find.byType(PluginsScreen), findsOneWidget);
    expect(find.textContaining('@ccch1mneyyy/dsh-media'), findsWidgets);
    expect(find.byType(Switch), findsOneWidget);
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(carrier.argsOf('pluginManager/setBundleEnabled').single, {
      'name': '@ccch1mneyyy/dsh-media',
      'enabled': true,
    });
    expect(carrier.argsOf('pluginManager/installBundle'), isEmpty);
    expect(tester.takeException(), isNull);
  });
}
