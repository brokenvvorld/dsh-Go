import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// What the community feed needs from HTTP: one GET with a streamed body. A seam
/// so tests never touch the network.
abstract interface class CommunityHttp {
  /// Resolves once the response headers are in; [timeout] covers connecting
  /// and waiting for them, not the body.
  Future<CommunityHttpResponse> get(
    Uri url, {
    Map<String, String> headers = const {},
    Duration timeout = const Duration(seconds: 15),
  });
}

class CommunityHttpResponse {
  CommunityHttpResponse({required this.status, required this.body, this.headers = const {}, this.contentLength});

  final int status;

  /// Lowercase header names.
  final Map<String, String> headers;

  /// Null when the server didn't say.
  final int? contentLength;
  final Stream<List<int>> body;

  /// Reads the body as UTF-8, refusing more than [maxBytes].
  Future<String> text({int maxBytes = 2 * 1024 * 1024, Duration timeout = const Duration(seconds: 20)}) async {
    final bytes = <int>[];
    await for (final chunk in body.timeout(timeout)) {
      bytes.addAll(chunk);
      if (bytes.length > maxBytes) throw const HttpException('response too large');
    }
    return utf8.decode(bytes, allowMalformed: true);
  }

  /// Drops the body (frees the connection).
  Future<void> discard() async {
    try {
      final subscription = body.listen(null, cancelOnError: true);
      await subscription.asFuture<void>().timeout(
        const Duration(seconds: 5),
        onTimeout: () {
          unawaited(subscription.cancel().catchError((Object _) {}));
        },
      );
    } catch (_) {}
  }
}

/// The real thing, on `dart:io`.
class IoCommunityHttp implements CommunityHttp {
  IoCommunityHttp()
    : _client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 10)
        ..idleTimeout = const Duration(seconds: 5);

  final HttpClient _client;

  @override
  Future<CommunityHttpResponse> get(
    Uri url, {
    Map<String, String> headers = const {},
    Duration timeout = const Duration(seconds: 15),
  }) async {
    final request = await _client.getUrl(url).timeout(timeout);
    headers.forEach(request.headers.set);
    final response = await request.close().timeout(
      timeout,
      onTimeout: () {
        request.abort();
        throw TimeoutException('Community response headers timed out', timeout);
      },
    );
    final names = <String, String>{};
    response.headers.forEach((name, values) => names[name.toLowerCase()] = values.join(', '));
    return CommunityHttpResponse(
      status: response.statusCode,
      headers: names,
      contentLength: response.contentLength >= 0 ? response.contentLength : null,
      body: response,
    );
  }
}
