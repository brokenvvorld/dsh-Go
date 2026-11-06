// Search credentials belong to the selected search service, independently of
// the chat model. OpenAI reuses the Host's chat API key; DeepSeek remains an
// explicit choice for users who configured that service.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/l10n.dart';
import '../../state/engine_settings_state.dart';
import '../common/segmented_pill.dart';
import '../theme/theme.dart';
import 'field_row.dart';
import 'namespace_copy.dart';
import 'schema_form.dart';

/// Provider ids the switch writes, by `web` field and position.
const webSearchProviders = {
  'searchProvider': (api: 'deepseek-search-api', messages: 'deepseek-official'),
  'fetchProvider': (api: 'deepseek-fetch-api', messages: 'http'),
};

/// The `web` edits for one switch position: a target equal to the composed
/// value clears the override instead of storing a copy of it.
List<SettingsOp> webSearchSwitchOps(SettingsNamespaceView web, {required bool api}) => [
  for (final MapEntry(:key, :value) in webSearchProviders.entries)
    if (lookupPath(web.base, [key]).$2 == (api ? value.api : value.messages))
      SettingsOp.unset([key])
    else
      SettingsOp.set([key], api ? value.api : value.messages),
];

List<SettingsOp> webSearchProviderOps(SettingsNamespaceView web, {required bool openai}) => [
  for (final entry in {'searchProvider': openai ? 'openai' : 'deepseek-official', 'fetchProvider': 'http'}.entries)
    if (lookupPath(web.base, [entry.key]).$2 == entry.value)
      SettingsOp.unset([entry.key])
    else
      SettingsOp.set([entry.key], entry.value),
];

class WebSearchSettingsPage extends ConsumerWidget {
  const WebSearchSettingsPage({super.key});

  static const messagesNs = 'web-search-deepseek';
  static const apiNs = 'web-deepseek-api';
  static const webNs = 'web';
  static const openaiNs = 'dsh-go-openai';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    return EngineFormScaffold(
      title: l10n.engineSearchTitle,
      namespaces: const [webNs, messagesNs],
      builder: (context, settings) {
        final selected = settings.valueOf(const FieldRef(webNs, ['searchProvider']));
        final openai = selected == 'openai';
        final openaiAvailable = settings.served(openaiNs);
        final switchable = settings.served(webNs) && settings.served(apiNs);
        final api = switchable && selected == 'deepseek-search-api';
        final ns = api ? apiNs : messagesNs;
        SchemaFieldSpec field(String key) => SchemaFieldSpec(
          ns,
          [key],
          copy: copyOf(ns, [key]),
          keyboardType: key == 'baseURL' ? TextInputType.url : null,
        );
        return schemaFormGroups([
          if (settings.served(webNs) && (openaiAvailable || openai))
            SchemaFormSection(
              children: [_ProviderChoice(settings: settings, openai: openai)],
            ),
          if (openai)
            SchemaFormSection(
              title: 'OpenAI', // l10n:keep provider name
              fields: [
                SchemaFieldSpec(openaiNs, const ['enabled'], copy: FieldCopy(label: l10n.openaiEnableTools, hint: '')),
                SchemaFieldSpec(openaiNs, const ['apiKey'], copy: FieldCopy(label: l10n.openaiSharedKey, hint: '')),
                SchemaFieldSpec(openaiNs, const [
                  'responseModel',
                ], copy: FieldCopy(label: l10n.openaiResponseModel, hint: '')),
              ],
              footer: openaiAvailable ? l10n.openaiSearchHint : l10n.openaiRuntimeMissing,
            )
          else ...[
            if (switchable)
              SchemaFormSection(
                children: [_ApiSwitch(settings: settings, api: api)],
              ),
            SchemaFormSection(
              title: l10n.engineSearchDeepSeek,
              fields: [field('apiKey'), field('baseURL'), field(api ? 'count' : 'maxUses')],
            ),
          ],
        ], settings: settings);
      },
    );
  }
}

class _ProviderChoice extends ConsumerWidget {
  const _ProviderChoice({required this.settings, required this.openai});
  final EngineSettings settings;
  final bool openai;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const fields = [
      FieldRef(WebSearchSettingsPage.webNs, ['searchProvider']),
      FieldRef(WebSearchSettingsPage.webNs, ['fetchProvider']),
    ];
    final web = settings[WebSearchSettingsPage.webNs]!;
    final saving = fields.any(settings.isSaving);
    final error = fields.map(settings.errorOf).nonNulls.firstOrNull;
    final enabled = settings.canWrite(WebSearchSettingsPage.webNs) && !saving;
    return EngineFieldRow(
      title: context.l10n.engineFieldSearchProvider,
      subtitle: error ?? (settings.layerOf(fields.first) == FieldLayer.locked ? lockedHint : null),
      subtitleColor: error != null ? DshColors.of(context).danger : null,
      enabled: enabled,
      trailing: SegmentedPill<bool>(
        key: const ValueKey('web-search-provider'),
        segments: const [PillSegment(true, 'OpenAI'), PillSegment(false, 'DeepSeek')], // l10n:keep provider names
        selected: openai,
        expand: false,
        onChanged: enabled
            ? (value) {
                for (final field in fields) {
                  ref.read(engineSettingsProvider.notifier).clearError(field);
                }
                unawaited(
                  ref
                      .read(engineSettingsProvider.notifier)
                      .write(WebSearchSettingsPage.webNs, webSearchProviderOps(web, openai: value), fields: fields),
                );
              }
            : null,
      ),
    );
  }
}

class _ApiSwitch extends ConsumerWidget {
  const _ApiSwitch({required this.settings, required this.api});

  final EngineSettings settings;
  final bool api;

  static const _fields = [
    FieldRef(WebSearchSettingsPage.webNs, ['searchProvider']),
    FieldRef(WebSearchSettingsPage.webNs, ['fetchProvider']),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final colors = DshColors.of(context);
    final web = settings[WebSearchSettingsPage.webNs]!;
    final saving = _fields.any(settings.isSaving);
    final error = _fields.map(settings.errorOf).nonNulls.firstOrNull;
    final enabled = settings.canWrite(WebSearchSettingsPage.webNs) && !saving;
    final layer = settings.layerOf(_fields.first);
    void toggle(bool on) {
      for (final f in _fields) {
        ref.read(engineSettingsProvider.notifier).clearError(f);
      }
      unawaited(
        ref
            .read(engineSettingsProvider.notifier)
            .write(WebSearchSettingsPage.webNs, webSearchSwitchOps(web, api: on), fields: _fields),
      );
    }

    return MergeSemantics(
      child: EngineFieldRow(
        title: l10n.engineSearchNewApi,
        subtitle: error ?? (layer == FieldLayer.locked ? lockedHint : null),
        subtitleColor: error != null ? colors.danger : null,
        badge: layer == FieldLayer.user && enabled ? modifiedBadge : null,
        enabled: enabled,
        onTap: enabled ? () => toggle(!api) : null,
        trailing: Switch(value: api, onChanged: enabled ? toggle : null),
      ),
    );
  }
}
