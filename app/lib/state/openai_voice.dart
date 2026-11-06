import 'dart:async';

import 'package:dsh_client/dsh_client.dart';
import 'package:flutter/foundation.dart';

abstract interface class OpenAIVoicePeer {
  Future<String> offer(void Function(Map<String, Object?>) onEvent, void Function() onClosed);
  Future<void> answer(String sdp);
  Future<void> send(Map<String, Object?> event);
  Future<void> close();
}

typedef VoiceRequest = Future<Map<String, Object?>> Function(String action, Map<String, Object?> body);

/// Owns one call and its captured Host. A late start can never attach to another Host.
class OpenAIVoiceController extends ChangeNotifier {
  OpenAIVoiceController({required this.request, required this.createPeer});
  final VoiceRequest request;
  final Future<OpenAIVoicePeer> Function() createPeer;
  OpenAIVoicePeer? _peer;
  String? _token;
  Timer? _heartbeat;
  Timer? _connecting;
  int _generation = 0;
  bool _disposed = false;
  bool busy = false;
  bool connected = false;
  bool failed = false;
  String transcript = '';

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int generation) => !_disposed && generation == _generation;

  Future<void> start(String kind) async {
    final stopped = stop();
    final generation = ++_generation;
    await stopped;
    if (!_current(generation)) return;
    busy = true;
    failed = false;
    transcript = '';
    _changed();
    OpenAIVoicePeer? peer;
    String? token;
    try {
      peer = await createPeer();
      if (!_current(generation)) {
        await peer.close();
        return;
      }
      _peer = peer;
      final offer = await peer.offer(
        (event) {
          if (!_current(generation)) return;
          final type = event['type'];
          if (type == 'session.started' || type == 'session.created' || type == 'session.updated') {
            connected = true;
            busy = false;
            _connecting?.cancel();
          }
          if (type == 'error' || type == 'session.error') {
            failed = true;
            unawaited(stop());
          }
          if (type == 'decision.event') {
            final decisionEvent = event['event'];
            if (decisionEvent is Map && decisionEvent['type'] == 'decision.completed') {
              final decision = decisionEvent['decision'];
              final text = decision is Map ? decisionAnswerText(decision['answers']) : '';
              if (text.isNotEmpty) {
                transcript += '\n$text\n';
                final delegation = event['delegation_id'];
                if (delegation is String) {
                  unawaited(
                    _peer
                            ?.send({'type': 'session.commentary.append', 'delegation_id': delegation, 'content': text})
                            .catchError((Object _) {}) ??
                        Future<void>.value(),
                  );
                }
              }
            }
          }
          if (type is String && (type.contains('transcript') || type.contains('transcription'))) {
            final text = event['delta'] ?? event['transcript'] ?? event['text'];
            if (text is String) {
              transcript += type.endsWith('.delta') ? text : '\n$text\n';
              if (transcript.length > 24000) transcript = transcript.substring(transcript.length - 24000);
            }
          }
          _changed();
        },
        () {
          if (_current(generation)) {
            failed = true;
            unawaited(stop());
          }
        },
      );
      if (!_current(generation)) return;
      final result = await request('start', {'kind': kind, 'sdp': offer});
      token = result['token'] as String?;
      final sdp = result['sdp'];
      if (token == null || sdp is! String) throw const DshProtocolException('Invalid voice session');
      if (!_current(generation)) {
        await request('stop', {'token': token});
        return;
      }
      _token = token;
      await peer.answer(sdp);
      if (!_current(generation)) return;
      if (!connected) {
        _connecting = Timer(const Duration(seconds: 30), () {
          if (_current(generation) && !connected) {
            failed = true;
            unawaited(stop());
          }
        });
      }
      _heartbeat = Timer.periodic(const Duration(seconds: 25), (_) async {
        if (!_current(generation)) return;
        try {
          await request('ping', {'token': token});
        } catch (_) {
          if (_current(generation)) {
            failed = true;
            await stop();
          }
        }
      });
    } catch (_) {
      if (_current(generation)) {
        failed = true;
        await stop();
      }
    } finally {
      if (!_current(generation)) {
        try {
          await peer?.close();
        } catch (_) {}
      }
    }
  }

  Future<void> commitTranscription() async {
    if (!connected) return;
    try {
      await _peer?.send({'type': 'input_audio_buffer.commit'});
    } catch (_) {
      failed = true;
      await stop();
    }
  }

  Future<void> stop() async {
    ++_generation;
    _heartbeat?.cancel();
    _heartbeat = null;
    _connecting?.cancel();
    _connecting = null;
    final peer = _peer, token = _token;
    _peer = null;
    _token = null;
    busy = false;
    connected = false;
    _changed();
    try {
      await peer?.close();
    } catch (_) {}
    if (token != null) {
      try {
        await request('stop', {'token': token});
      } catch (_) {}
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(stop());
    super.dispose();
  }
}

String decisionAnswerText(Object? value) {
  if (value is! List) return '';
  return [
    for (final answer in value.whereType<Map>())
      if (answer['probability'] case final num p)
        '${answer['name'] ?? ''}: ${(p * 100).toStringAsFixed(1)}%'
      else if (answer['choice'] != null)
        '${answer['name'] ?? ''}: ${answer['choice']}'
      else if (answer['score'] != null)
        '${answer['name'] ?? ''}: ${answer['score']}'
      else if (answer['type'] == 'refusal')
        '${answer['name'] ?? ''}: —',
  ].join('\n');
}
