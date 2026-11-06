# OpenAI API setup

This branch is based on [DSH Go](https://github.com/ccch1mneyyy/dsh-Go) by ccch1mneyyy. It retains the Flutter client, DSH engine and pi-ai adapter, along with their licenses and third-party notices. It is not an official release by OpenAI, DeepSeek or the original DSH Go author.

## Configure

1. Choose local operation and prepare the runtime, or connect to a remote host you manage.
2. Select **Use OpenAI API key** during setup, or **Model providers → OpenAI API → Connect OpenAI** later.
3. The endpoint is prefilled as `https://api.openai.com/v1` and the protocol is **Responses**. Enter your own API key.
4. Fetch models and choose a model supporting Responses conversations, or enter its ID manually. Listings can include audio, embedding and other specialized models; a listing does not imply chat compatibility.
5. Save, then select an OpenAI model in chat. The new-chat defaults card can retain a fixed choice.

For a third-party gateway, change the endpoint and protocol as needed. Requests and credentials go to the service you configure. The settings shortcut opens an existing OpenAI provider's details; duplicate creation does not overwrite it. The DeepSeek API-key entry remains separate.

## Skills, plugins and accounts

Skills supply instructions, procedures and companion resources. Invoked skill content enters conversation context and does not require a DeepSeek model. Plugins register executable DSH tools: the chat model requests a tool call, then the host runs code or contacts the selected external service. Local files, commands and phone-control tools remain available.

The image and video plugin is bundled with this fork's runtime, retaining the `dsh-media` settings and existing credentials. The previous market package 0.2.1 targets a different DSH version from this fork's 0.2.2-rc.1. Updating the app provides the compatible plugin; version checks are retained. Its market detail opens media settings rather than installing the old package again.

OpenAI images reuse the host's `OPENAI_API_KEY`. The chat model chooses and calls the tool; the selected GPT Image model generates the result. Third-party video services remain configurable and require their own keys and billing. OpenAI shut down the Videos API on 2026-09-24, so an OpenAI key alone does not provide video models.

Ordinary DSH web search now uses the Responses `web_search` tool, with OpenAI selected by default in new runtimes. A host with an explicitly saved DeepSeek search setting can switch in Web search settings. Webpage fetching remains ordinary HTTP. Account status, model providers and usage no longer imply that OpenAI users must sign in to or top up DeepSeek.

## Subscription sign-in and billing

**ChatGPT (Codex)** is the existing pi-ai Codex-compatible sign-in route. It authorizes a ChatGPT account and uses the plan allowance available to that account for supported chat models, subject to access and usage limits. It is separate from an OpenAI Platform API key and does not pay for standalone plugin calls to images, audio, search or Decisions. The service determines whether a third-party compatible client can sign in and use a model.

As documented on 2026-11-06, eligible paid Pro / Business subscriptions can also claim separate API credits. Link the subscription to an API organization you own through ChatGPT or Platform billing, then use a project key from that organization. Signing in to this app does not claim those credits or convert ChatGPT conversation allowance into API balance. Check billing settings for eligibility, credit amounts and expiry.

Official references: [authentication and API billing](https://learn.chatgpt.com/docs/auth?surface=cli), [API credits for subscribers](https://developers.openai.com/api/docs/guides/chatgpt-api-credits), [API deprecations](https://developers.openai.com/api/docs/deprecations).

## Changes

- OpenAI API is the primary initial-setup action and has a direct settings entry.
- The `openai` route and `OPENAI_API_KEY` credential reference preserve image input, reasoning levels and context limits for models known to the installed engine catalog.
- Users choose models instead of receiving a hardcoded default their account might not support. New models absent from the catalog can be added manually with their capabilities set in model settings.
- Existing credential storage, streaming, tool calling, error handling and remote-host paths are reused. No real credentials are included in source, builds or tests.
- Configuration can be entered while the local runtime installs. Its engine starts when installation completes; model discovery and saving then become available.

## Validation

`runtime/tests/openai-responses.test.mjs` exercises the locked DSH/pi-ai adapter against a local mock HTTP server: model capabilities, Responses endpoint, Bearer authentication, reasoning effort, streamed function calls, tool-result replay, Chinese text and a 401 error. It does not contact OpenAI or incur API charges.

```bash
# Install the pinned runtime dependencies into a temporary directory first.
DSH_PREFIX=/path/to/installed/runtime node --test runtime/tests/openai-responses.test.mjs

cd app
flutter analyze
flutter test test/providers/provider_form_test.dart test/providers/providers_logic_test.dart test/providers/onboarding_provider_test.dart test/account/account_widget_test.dart test/onboarding/parallel_setup_test.dart
```

Local validation: 180 Flutter tests passed, covering the flows above, provider pages, and related golden images. All 3 Responses runtime tests passed, as did Flutter analysis, localization generation checks, and guide synchronization checks.

Mock results do not establish live-account or Android-device behavior. API credit, model access, network reachability and installation on a physical device need separate verification. See README for source builds and [APK packaging](android-release.en.md) for the difference between automated test builds and formal releases. Check this repository’s Actions / Releases for available artifacts. Before redistributing a modified app, replace the restricted name, brand and mascot assets as described in [ASSETS.md](../ASSETS.md), retaining attribution and licenses.

## Extended API capabilities

Open **Settings → OpenAI capabilities**. The official chat provider and this extension share the Host's `OPENAI_API_KEY`. Response, transcription, Live and Realtime models, voice and translation language are configurable. OpenAI determines account/model access.

The source-backed [capability matrix and complete operation list](openai-capabilities.md) covers **25 families and 190 HTTP operations**. This is adapter coverage, not a count of live-account tests. The assistant uses `openai_catalog`, `openai_call`, and `openai_decide`; the app provides a separate microphone/WebRTC screen.

| Area | Integration |
| --- | --- |
| Decisions | Real `/v1/decisions` requests with text, images, JSON and conversation input; predicates, choices, scores, cache, confidence and refusals; 1–400 questions with `gpt-6-luna` |
| Responses | Native parameters, structured output, vision/files, reasoning, cache, background work, continuation, retrieval/cancellation, compaction, token counting and SSE |
| Responses tools | Search, file search, code interpreter, image generation, hosted shell/skills, MCP, tool search, programmatic calls and multi-agent; local tool requests return to DSH for execution/approval and explicit output replay |
| Agents | Hosted agent sessions, events/turns, sandbox/browser work, skills, subagents, artifacts, environment templates/prewarming and automations; `agents=v1` |
| GPT-Live / Realtime | WebRTC voice, transcripts, interruption, Responses delegation, a configurable Decisions predicate, transcription and translation; call/recording/SIP management through the catalog |
| Images / Audio | Image generation/editing with reference images, masks, markup, SVG/GIF; file transcription/translation, speech, custom voices and consent uploads |
| Data | Files, multipart uploads, vector stores/indexing/search, skill versions, containers, conversations and embeddings |
| Operations | Batches, moderation, content provenance, models, vaults, webhook management and safety alert/case retrieval |
| Compatibility | Chat Completions and Completions; fine-tuning for eligible existing accounts when enabled; read-only Evals until shutdown |

The catalog deliberately excludes retired Assistants/Threads/Runs, Sora, DALL·E variations, legacy Realtime beta session creation, and Evals writes. Evals closes on 2026-11-30; new fine-tuning jobs and the old speech endpoint stop on 2027-01-06. Organization administration requires separate Admin authority and is not exposed using a chat key. ChatKit and Agent Builder are alternate frontend/orchestration products; this app retains Flutter and DSH. HTTP/SSE and WebRTC provide the implemented transports; Responses WebSocket and Live fork/sideband sockets are not separately implemented. The native voice screen is audio-only, without camera capture.

Files must reside in the current DSH workspace. Use `{"$file":"/workspace/report.pdf"}` for multipart, or `$data_url` / `$base64` for inline data. Uploads/responses have a 64 MiB per-request limit; larger files require the multipart Uploads workflow. Binary outputs are saved without overwriting existing files. Background resource IDs and SSE checkpoints support continuation after interruptions; local cancellation does not guarantee a cloud job was cancelled. POST requests are not retried automatically.

MCP/Vault secrets use `{"$credential":"MY_MCP_TOKEN"}` after adding the name to the explicit settings allowlist and storing its value through Host credential management. The official API key cannot be used as an MCP secret. Webhook signing secrets are stored as Host credentials and redacted from chat. A separate public HTTPS webhook receiver is required, with signature verification. Deletion, training, cloud schedules and Vault/Webhook changes use DSH approvals.

Long-lived and ephemeral API keys remain on the Host; mobile receives only SDP and an opaque call handle. The app releases microphone tracks on stop, navigation, Host switch or backgrounding. A 90-second Host lease is renewed every 25 seconds. Calls require an HTTP Host carrier, including local operation or SSH forwarding; RPC-only relays cannot use this signaling route. Third-party image gateways do not automatically inherit the official chat credential.

`runtime/openai/dsh-go-openai` is bundled into rebuilt runtimes. Existing APKs/Hosts require an update; a remote Host can install the package and add it to its DSH profile bundles. The plugin targets the pinned DSH 0.2.2-rc.1 service contracts.

```bash
DSH_PREFIX=/path/to/patched/runtime node --test runtime/tests/openai-capabilities.test.mjs runtime/tests/openai-responses.test.mjs
DSH_PREFIX=/path/to/patched/runtime python3 runtime/tests/openai-host-live.py
python3 -m unittest discover -s runtime/tests -p 'test_*.py'
(cd app && flutter analyze --no-pub && flutter test --no-pub test/openai/capabilities_page_test.dart test/voice/openai_voice_test.dart test/media/media_settings_test.dart test/media/media_settings_page_test.dart)
(cd packages/dsh_client && dart analyze && dart test test/openai_api_test.dart test/dsh_go_api_test.dart)
```

The 180 tests above describe the initial chat integration. Extended validation exercises the real pinned DSH Host's plugin loading/config persistence, real adapters against mock HTTP, protocol/file handling, Flutter UI/voice lifecycles and Dart signaling. No real OpenAI credentials, Android voice-device verification or full APK build were used for this extension.

Plugin/account compatibility validation: 478 Flutter tests passed; one live-account test was not enabled. Media Node tests had 324 passes and four existing skips; OpenAI extension/search tests had 30 passes. Real DSH hosts verified old configuration preservation, no media tools without a key, disable/restart/re-enable behavior and safe mode. Image and background-video workflows passed against local mock services. Complete patch-chain and repeated-application checks passed. No real OpenAI account or physical Android device was used.
