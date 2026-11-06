# OpenAI API setup

This branch is based on [DSH Go](https://github.com/ccch1mneyyy/dsh-Go) by ccch1mneyyy. It retains the Flutter client, DSH engine and pi-ai adapter, along with their licenses and third-party notices. It is not an official release by OpenAI, DeepSeek or the original DSH Go author.

## Configure

1. Choose local operation and prepare the runtime, or connect to a remote host you manage.
2. Select **Use OpenAI API key** during setup, or **Model providers → OpenAI API → Connect OpenAI** later.
3. The endpoint is prefilled as `https://api.openai.com/v1` and the protocol is **Responses**. Enter your own API key.
4. Fetch models and choose a model supporting Responses conversations, or enter its ID manually. Listings can include audio, embedding and other specialized models; a listing does not imply chat compatibility.
5. Save, then select an OpenAI model in chat. The new-chat defaults card can retain a fixed choice.

For a third-party gateway, change the endpoint and protocol as needed. Requests and credentials go to the service you configure. The settings shortcut opens an existing OpenAI provider's details; duplicate creation does not overwrite it. The DeepSeek API-key entry remains separate.

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

Mock results do not establish live-account or Android-device behavior. API credit, model access, network reachability and installation on a physical device need separate verification. See README for source builds; this branch has not published a modified APK. Before redistributing a modified app, replace the restricted name, brand and mascot assets as described in [ASSETS.md](../ASSETS.md), retaining attribution and licenses.
