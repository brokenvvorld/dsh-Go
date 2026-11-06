import 'dart:convert';
import 'dart:io';

import 'package:dsh_client/dsh_client.dart';
import 'package:test/test.dart';

void main() {
  test('voice signaling uses the authenticated Host and only accepts voice actions', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    final base = Uri.parse('http://127.0.0.1:${server.port}');
    final client = DshClient(
      DshConnection(
        base,
        cookie: DshCookie(name: 'dsh-auth', value: 'fixture', authority: base.authority),
      ),
    );
    addTearDown(client.close);
    var calls = 0;
    server.listen((req) async {
      calls++;
      expect(req.method, 'POST');
      expect(req.uri.path, '/openai/v1/voice/start');
      expect(req.headers.value('cookie'), 'dsh-auth=fixture');
      expect(req.headers.value('host'), base.authority);
      expect(jsonDecode(await utf8.decoder.bind(req).join()), {'kind': 'live', 'sdp': 'v=0'});
      req.response.headers.contentType = ContentType.json;
      req.response.write(jsonEncode({'token': 'call', 'sdp': 'answer'}));
      await req.response.close();
    });
    expect(client.supportsOpenAIVoice, true);
    expect(await client.openAIVoice('start', {'kind': 'live', 'sdp': 'v=0'}), {'token': 'call', 'sdp': 'answer'});
    await expectLater(client.openAIVoice('../files', {}), throwsA(isA<DshProtocolException>()));
    expect(calls, 1);
  });
}
