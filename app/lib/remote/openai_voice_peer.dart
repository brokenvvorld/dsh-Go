import 'dart:async';
import 'dart:convert';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../state/openai_voice.dart';

Future<OpenAIVoicePeer> createOpenAIVoicePeer() async => _VoicePeer();

class _VoicePeer implements OpenAIVoicePeer {
  RTCPeerConnection? _pc;
  MediaStream? _microphone;
  RTCDataChannel? _events;
  bool _closed = false;
  void _check() {
    if (_closed) throw StateError('Voice call closed');
  }

  @override
  Future<String> offer(void Function(Map<String, Object?>) onEvent, void Function() onClosed) async {
    final stream = await navigator.mediaDevices.getUserMedia({'audio': true, 'video': false});
    if (_closed) {
      for (final track in stream.getTracks()) {
        await track.stop();
      }
      await stream.dispose();
      _check();
    }
    _microphone = stream;
    final pc = await createPeerConnection({'sdpSemantics': 'unified-plan'});
    if (_closed) {
      await pc.close();
      await pc.dispose();
      _check();
    }
    _pc = pc;
    pc.onConnectionState = (state) {
      if (!_closed &&
          (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
              state == RTCPeerConnectionState.RTCPeerConnectionStateClosed)) {
        onClosed();
      }
    };
    pc.onTrack = (event) {
      event.track.enabled = true;
    };
    for (final track in stream.getAudioTracks()) {
      await pc.addTrack(track, stream);
      _check();
    }
    final channel = await pc.createDataChannel('oai-events', RTCDataChannelInit()..ordered = true);
    if (_closed) {
      await channel.close();
      _check();
    }
    _events = channel;
    channel.onMessage = (message) {
      if (_closed || message.isBinary) return;
      try {
        final event = jsonDecode(message.text);
        if (event is Map<String, dynamic>) onEvent(event);
      } catch (_) {}
    };
    final gathered = Completer<void>();
    pc.onIceGatheringState = (state) {
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete && !gathered.isCompleted) gathered.complete();
    };
    await pc.setLocalDescription(await pc.createOffer());
    _check();
    if (pc.iceGatheringState != RTCIceGatheringState.RTCIceGatheringStateComplete) {
      await gathered.future.timeout(const Duration(seconds: 15));
    }
    _check();
    final description = await pc.getLocalDescription();
    _check();
    if (description?.sdp == null) throw StateError('Missing SDP');
    return description!.sdp!;
  }

  @override
  Future<void> answer(String sdp) async {
    _check();
    await _pc!.setRemoteDescription(RTCSessionDescription(sdp, 'answer'));
    _check();
  }

  @override
  Future<void> send(Map<String, Object?> event) async {
    _check();
    await _events!.send(RTCDataChannelMessage(jsonEncode(event)));
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    for (final track in _microphone?.getTracks() ?? <MediaStreamTrack>[]) {
      try {
        await track.stop();
      } catch (_) {}
    }
    // Release every resource even if a native handle has already disappeared.
    try {
      await _events?.close();
    } catch (_) {}
    try {
      await _pc?.close();
    } catch (_) {}
    try {
      await _pc?.dispose();
    } catch (_) {}
    try {
      await _microphone?.dispose();
    } catch (_) {}
  }
}
