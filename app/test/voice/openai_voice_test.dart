import 'dart:async';

import 'package:dsh_app/state/openai_voice.dart';
import 'package:flutter_test/flutter_test.dart';

class FakePeer implements OpenAIVoicePeer {
  int closes = 0;
  int answers = 0;
  void Function(Map<String, Object?>)? emit;
  final sent = <Map<String, Object?>>[];
  @override
  Future<String> offer(void Function(Map<String, Object?>) onEvent, void Function() onClosed) async {
    emit = onEvent;
    return 'v=0';
  }

  @override
  Future<void> answer(String sdp) async {
    answers++;
    emit?.call({'type': 'session.started'});
  }

  @override
  Future<void> close() async {
    closes++;
  }

  @override
  Future<void> send(Map<String, Object?> event) async {
    sent.add(event);
  }
}

void main() {
  test('call starts, receives captions, commits transcription, and closes on stop', () async {
    final peer = FakePeer(), calls = <String>[];
    final controller = OpenAIVoiceController(
      createPeer: () async => peer,
      request: (action, body) async {
        calls.add(action);
        return action == 'start' ? {'token': 'call', 'sdp': 'answer'} : {};
      },
    );
    await controller.start('transcription');
    expect(controller.connected, true);
    expect(controller.busy, false);
    peer.emit!({'type': 'session.input_transcript.delta', 'delta': '你好'});
    expect(controller.transcript, '你好');
    await controller.commitTranscription();
    expect(peer.sent.single['type'], 'input_audio_buffer.commit');
    await controller.stop();
    expect(controller.connected, false);
    expect(calls, ['start', 'stop']);
    expect(peer.closes, 1);
    controller.dispose();
  });

  test('late server session after cancel is stopped on the original Host', () async {
    final peer = FakePeer(), started = Completer<void>(), result = Completer<Map<String, Object?>>();
    final stopped = <String>[];
    final controller = OpenAIVoiceController(
      createPeer: () async => peer,
      request: (action, body) async {
        if (action == 'start') {
          started.complete();
          return result.future;
        }
        if (action == 'stop') stopped.add(body['token']! as String);
        return {};
      },
    );
    final pending = controller.start('live');
    await started.future;
    await controller.stop();
    result.complete({'token': 'late-call', 'sdp': 'answer'});
    await pending;
    expect(stopped, ['late-call']);
    expect(peer.answers, 0);
    expect(controller.connected, false);
    controller.dispose();
  });

  test('late microphone acquisition is released after page disposal', () async {
    final peer = FakePeer(), acquired = Completer<OpenAIVoicePeer>(), ready = Completer<void>();
    final controller = OpenAIVoiceController(
      createPeer: () {
        ready.complete();
        return acquired.future;
      },
      request: (_, _) async {
        fail('must not start network session');
      },
    );
    final pending = controller.start('live');
    await ready.future;
    controller.dispose();
    acquired.complete(peer);
    await pending;
    expect(peer.closes, greaterThanOrEqualTo(1));
    expect(peer.answers, 0);
  });

  test('live Decisions preserves probability and sends the result back to the same delegation', () async {
    final peer = FakePeer();
    final controller = OpenAIVoiceController(
      createPeer: () async => peer,
      request: (action, _) async => action == 'start' ? {'token': 'call', 'sdp': 'answer'} : {},
    );
    await controller.start('live_decisions');
    peer.emit!({
      'type': 'decision.event',
      'delegation_id': 'del_1',
      'event': {
        'type': 'decision.completed',
        'decision': {
          'answers': [
            {'type': 'predicate', 'name': 'condition', 'probability': 0.75},
          ],
        },
      },
    });
    expect(controller.transcript, contains('75.0%'));
    expect(peer.sent.single, {
      'type': 'session.commentary.append',
      'delegation_id': 'del_1',
      'content': 'condition: 75.0%',
    });
    await controller.stop();
    controller.dispose();
  });

  test('two starts in the same tick acquire only the newest microphone', () async {
    var acquisitions = 0;
    final controller = OpenAIVoiceController(
      createPeer: () async {
        acquisitions++;
        return FakePeer();
      },
      request: (action, _) async => action == 'start' ? {'token': 'call', 'sdp': 'answer'} : {},
    );
    await Future.wait([controller.start('live'), controller.start('realtime')]);
    expect(acquisitions, 1);
    await controller.stop();
    controller.dispose();
  });

  test('provider errors end call and late transcript events are ignored', () async {
    final peer = FakePeer();
    final controller = OpenAIVoiceController(
      createPeer: () async => peer,
      request: (action, _) async => action == 'start' ? {'token': 'call', 'sdp': 'answer'} : {},
    );
    await controller.start('realtime');
    peer.emit!({'type': 'error'});
    await Future<void>.delayed(Duration.zero);
    peer.emit!({'type': 'session.output_transcript.delta', 'delta': 'stale'});
    expect(controller.failed, true);
    expect(controller.connected, false);
    expect(controller.transcript, isEmpty);
    controller.dispose();
  });
}
