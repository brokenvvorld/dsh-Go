import 'dart:convert';

import 'carrier.dart';
import 'errors.dart';
import 'session_api.dart';

/// Host-owned OpenAI credentials; only SDP and an opaque call handle cross this boundary.
extension OpenAIApi on DshClient {
  bool get supportsOpenAIVoice => carrier is DshHttpCarrier;

  Future<Map<String, Object?>> openAIVoice(String action, Map<String, Object?> body) async {
    if (!supportsOpenAIVoice || !const ['start', 'stop', 'ping'].contains(action)) {
      throw const DshProtocolException('OpenAI voice is unavailable on this connection');
    }
    final response = await connection.postJson('/openai/v1/voice/$action', body, timeout: const Duration(seconds: 50));
    if (response.statusCode != 200) {
      throw DshProtocolException('OpenAI voice: HTTP ${response.statusCode}');
    }
    final decoded = jsonDecode(response.text);
    if (decoded is! Map<String, dynamic>) throw const DshProtocolException('Invalid OpenAI voice response');
    return decoded;
  }
}
