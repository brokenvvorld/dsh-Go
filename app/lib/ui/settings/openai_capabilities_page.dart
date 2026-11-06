import 'dart:async';

import 'package:dsh_client/dsh_client.dart' hide SettingsSection;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/l10n.dart';
import '../../remote/openai_voice_peer.dart';
import '../../state/connection_state.dart';
import '../../state/openai_voice.dart';
import '../../state/voice_settings.dart';
import '../engine_settings/schema_form.dart';
import '../shell/page_frame.dart';
import 'settings_widgets.dart';

class OpenAICapabilitiesPage extends ConsumerWidget {
  const OpenAICapabilitiesPage({super.key});
  static const ns = 'dsh-go-openai';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final client = ref.watch(activeConnectionProvider).value?.client;
    SchemaFieldSpec field(String name, String label) =>
        SchemaFieldSpec(ns, [name], copy: FieldCopy(label: label, hint: ''));
    return EngineFormScaffold(
      title: l10n.openaiCapabilitiesTitle,
      namespaces: const [ns],
      missingBody: l10n.openaiRuntimeMissing,
      builder: (context, settings) => [
        ...schemaFormGroups([
          SchemaFormSection(
            fields: [
              field('enabled', l10n.openaiEnableTools),
              field('apiKey', l10n.openaiSharedKey),
              field('responseModel', l10n.openaiResponseModel),
            ],
            footer: l10n.openaiCapabilitiesHint,
          ),
          SchemaFormSection(
            title: l10n.openaiVoiceTitle,
            fields: [
              field('transcriptionModel', l10n.openaiTranscriptionModel),
              field('liveModel', 'GPT-Live'), // l10n:keep API name
              field('realtimeModel', 'Realtime'), // l10n:keep API name
              field('voice', l10n.openaiVoiceName),
              field('translationLanguage', l10n.openaiTranslationLanguage),
              field('liveDecisionQuestion', l10n.openaiLiveDecisionQuestion),
            ],
          ),
        ], settings: settings),
        SettingsSection(
          children: [
            SettingsTile(
              title: l10n.openaiVoiceTitle,
              subtitle: l10n.openaiVoiceDisclosure,
              onTap: client?.supportsOpenAIVoice == true
                  ? () =>
                        Navigator.of(context)
                            .push(MaterialPageRoute<void>(builder: (_) => OpenAIVoicePage(client: client!)))
                  : null,
            ),
            SettingsTile(
              title: l10n.openaiUseTranscription,
              subtitle: l10n.openaiCloudAudioHint,
              onTap: client == null
                  ? null
                  : () async {
                      try {
                        final catalog = await client.speechCatalog();
                        if (catalog == null || !catalog.providers.any((provider) => provider.id == 'openai')) {
                          throw StateError('unavailable');
                        }
                        await client.configureSpeech(providerId: 'openai', language: 'auto');
                        if (!identical(ref.read(activeConnectionProvider).value?.client, client)) return;
                        await ref.read(voiceSettingsProvider.notifier).setMode(VoiceMode.engine);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context)
                              .showSnackBar(SnackBar(content: Text(l10n.openaiTranscriptionSelected)));
                        }
                      } catch (_) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.openaiVoiceFailed)));
                        }
                      }
                    },
            ),
          ],
        ),
        SettingsSection(
          title: l10n.openaiCapabilitiesAvailable,
          children: [
            SettingsTile(title: l10n.openaiDecisionsTitle, subtitle: l10n.openaiDecisionsHint),
            SettingsTile(title: l10n.openaiResponsesTitle, subtitle: l10n.openaiResponsesHint),
            SettingsTile(title: l10n.openaiAgentsTitle, subtitle: l10n.openaiAgentsHint),
            SettingsTile(title: l10n.openaiMediaTitle, subtitle: l10n.openaiMediaHint),
            SettingsTile(title: l10n.openaiDataTitle, subtitle: l10n.openaiDataHint),
            SettingsTile(title: l10n.openaiOperationsTitle, subtitle: l10n.openaiOperationsHint),
          ],
        ),
        ...schemaFormGroups([
          SchemaFormSection(
            fields: [field('allowFineTuning', l10n.openaiTrainingTitle)],
            footer: l10n.openaiLegacyHint,
          ),
          SchemaFormSection(fields: [field('mcpCredentialRefs', l10n.openaiMcpCredentials)]),
        ], settings: settings),
      ],
    );
  }
}

class OpenAIVoicePage extends ConsumerStatefulWidget {
  const OpenAIVoicePage({super.key, required this.client});
  final DshClient client;
  @override
  ConsumerState<OpenAIVoicePage> createState() => _OpenAIVoicePageState();
}

class _OpenAIVoicePageState extends ConsumerState<OpenAIVoicePage> with WidgetsBindingObserver {
  late final OpenAIVoiceController controller;
  String kind = 'live';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    controller = OpenAIVoiceController(request: widget.client.openAIVoice, createPeer: createOpenAIVoicePeer)
      ..addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // A microphone permission dialog can briefly make the app inactive.
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden || state == AppLifecycleState.detached) {
      unawaited(controller.stop());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    controller.removeListener(_changed);
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    ref.listen(activeConnectionProvider, (_, next) {
      if (!identical(next.value?.client, widget.client)) unawaited(controller.stop());
    });
    final active = controller.busy || controller.connected;
    final currentHost = identical(ref.watch(activeConnectionProvider).value?.client, widget.client);
    return AppPage.list(
      title: l10n.openaiVoiceTitle,
      children: [
        Padding(padding: const EdgeInsets.all(16), child: Text(l10n.openaiVoiceDisclosure)),
        DropdownButtonFormField<String>(
          initialValue: kind,
          items: [
            DropdownMenuItem(value: 'live', child: Text(l10n.openaiLiveMode)),
            DropdownMenuItem(value: 'live_decisions', child: Text(l10n.openaiLiveDecisionsMode)),
            DropdownMenuItem(value: 'realtime', child: Text(l10n.openaiRealtimeMode)),
            DropdownMenuItem(value: 'transcription', child: Text(l10n.openaiCaptionMode)),
            DropdownMenuItem(value: 'translation', child: Text(l10n.openaiTranslationMode)),
          ],
          onChanged: active ? null : (value) => setState(() => kind = value!),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: !currentHost
              ? null
              : active
              ? () => unawaited(controller.stop())
              : () => unawaited(controller.start(kind)),
          child: Text(active ? l10n.openaiVoiceStop : l10n.openaiVoiceStart),
        ),
        if (controller.busy) const LinearProgressIndicator(),
        if (controller.connected) Text(l10n.openaiVoiceConnected),
        if (controller.failed) Text(l10n.openaiVoiceFailed),
        if (kind == 'transcription' && controller.connected)
          TextButton(
            onPressed: () => unawaited(controller.commitTranscription()),
            child: Text(l10n.openaiCommitSpeech),
          ),
        const SizedBox(height: 16),
        SelectableText(controller.transcript),
      ],
    );
  }
}
