import { randomUUID } from 'node:crypto';
import { API_ROOT, boundedBytes, OpenAIError } from './client.js';
const read = value => typeof value?.get === 'function' ? value.get() : value;

export function sessionConfig(kind, config) {
  const voice = read(config.voice);
  if (kind === 'live_decisions') {
    const question = read(config.liveDecisionQuestion)?.trim();
    if (!question) throw new OpenAIError('OPENAI_DECISION_QUESTION_MISSING');
    return { ...sessionConfig('live', config),
      instructions: '用户每次提供新信息时交给 Decisions 判断，等待应用返回结果后说明概率与不确定性。不要执行外部操作。',
      delegation: { type: 'decisions', decisions: { model: 'gpt-6-luna', questions: [{ type: 'predicate', name: 'condition', instructions: question }] } } };
  }
  if (kind === 'live') return { model: read(config.liveModel), store: false,
    instructions: '你是语音助手。使用用户的语言回答。需要查询或推理时交给后端；不要声称尚未完成的行动已经完成。你的声音由 AI 生成。',
    audio: { output: { voice } },
    delegation: { type: 'responses', responses: { model: read(config.responseModel), instructions: '完成用户的问题，必要时查找最新信息并保留来源。', tools: [{ type: 'web_search' }] } } };
  if (kind === 'realtime') return { type: 'realtime', model: read(config.realtimeModel), audio: { output: { voice } } };
  if (kind === 'transcription') return { type: 'transcription', audio: { input: { transcription: { model: 'gpt-live-transcribe' }, turn_detection: null } } };
  if (kind === 'translation') return { model: 'gpt-realtime-translate', audio: { output: { language: read(config.translationLanguage) } } };
  throw new OpenAIError('OPENAI_INVALID_VOICE_MODE');
}

export async function startVoice({ kind, sdp, config, credential, signal, fetchImpl = fetch, root = API_ROOT }) {
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 128000) throw new OpenAIError('OPENAI_INVALID_SDP');
  const key = await credential(); signal.throwIfAborted();
  const session = sessionConfig(kind, config);
  async function post(path, body, auth = key, type = 'application/json') {
    const headers = { Authorization: `Bearer ${auth}` };
    if (type) headers['Content-Type'] = type;
    const response = await fetchImpl(`${root}${path}`, { method: 'POST', headers, body, signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new OpenAIError('OPENAI_VOICE_HTTP', { status: response.status }); }
    return response;
  }
  if (kind === 'live' || kind === 'live_decisions') {
    const response = await post('/live/sessions', JSON.stringify({ session, transport: { type: 'webrtc', sdp } }));
    const result = JSON.parse(await boundedBytes(response, signal, 256000));
    if (typeof result.transport?.sdp !== 'string' || typeof result.session?.id !== 'string') throw new OpenAIError('OPENAI_INVALID_VOICE_RESPONSE');
    return { sdp: result.transport.sdp, id: result.session.id, kind };
  }
  // Keep ephemeral credentials on the Host too. Mobile only receives the SDP answer.
  const prefix = kind === 'translation' ? '/realtime/translations' : '/realtime';
  const response = await post(`${prefix}/client_secrets`, JSON.stringify({ session }));
  const secret = JSON.parse(await boundedBytes(response, signal, 256000));
  if (typeof secret.value !== 'string' || !secret.value) throw new OpenAIError('OPENAI_INVALID_VOICE_RESPONSE');
  const answer = await post(`${prefix}/calls`, sdp, secret.value, 'application/sdp');
  const location = answer.headers.get('location');
  const id = location?.split('/').pop();
  return { sdp: (await boundedBytes(answer, signal, 256000)).toString('utf8'), id: id && /^[\w-]+$/.test(id) ? id : null, kind };
}

export function installVoice(ctx, config, credential, lifetime, track) {
  ctx.inject(['speechToText'], speechCtx => {
    speechCtx.effect(() => speechCtx.speechToText.register({
      info: { id: 'openai', name: 'OpenAI', location: 'cloud', languages: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'] },
      async transcribe({ audio, language }, signal) {
        signal = AbortSignal.any([signal, lifetime, AbortSignal.timeout(120000)]);
        return track((async () => {
          if (audio.length > 25 * 1024 * 1024) throw new OpenAIError('OPENAI_AUDIO_TOO_LARGE');
          const start = performance.now(), form = new FormData();
          form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
          form.append('model', read(config.transcriptionModel));
          if (language && language !== 'auto') form.append('languages[]', language);
          const key = await credential(); signal.throwIfAborted();
          const response = await fetch(`${API_ROOT}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal, redirect: 'error' });
          if (!response.ok) { await response.body?.cancel(); throw new OpenAIError('OPENAI_TRANSCRIPTION_FAILED', { status: response.status }); }
          const result = JSON.parse(await boundedBytes(response, signal, 1024 * 1024));
          if (typeof result.text !== 'string') throw new OpenAIError('OPENAI_INVALID_TRANSCRIPT');
          return { text: result.text, audioSeconds: Math.max(0, audio.length - 44) / 32000, inferenceSeconds: (performance.now() - start) / 1000 };
        })());
      },
    }));
  });
  ctx.inject(['webServer', 'connection'], webCtx => {
    const sessions = new Map(); let starting = false;
    async function stop(token) {
      const session = sessions.get(token); sessions.delete(token);
      clearTimeout(session?.lease);
      if (!session?.id || session.kind === 'translation' || session.kind === 'transcription') return;
      const key = await credential();
      const path = session.kind.startsWith('live') ? '/live/sessions/' : '/realtime/calls/';
      const response = await fetch(`${API_ROOT}${path}${encodeURIComponent(session.id)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      await response.body?.cancel();
    }
    function renew(token) {
      const session = sessions.get(token);
      if (!session) throw new OpenAIError('OPENAI_VOICE_EXPIRED');
      clearTimeout(session.lease);
      session.lease = setTimeout(() => { void stop(token).catch(() => {}); }, 90000);
      session.lease.unref?.();
    }
    webCtx.effect(() => async () => { await Promise.allSettled([...sessions.keys()].map(stop)); });
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: '/openai/v1/voice', handler: (req, res) => track((async () => {
      const rejection = webCtx.connection.requestRejection(req);
      if (rejection !== undefined) { res.writeHead(rejection); res.end(); return; }
      if (req.method !== 'POST' || !['/openai/v1/voice/start', '/openai/v1/voice/stop', '/openai/v1/voice/ping'].includes(req.url)) { res.writeHead(404); res.end(); return; }
      const abort = new AbortController();
      const onClose = () => { if (!res.writableEnded) abort.abort(); };
      res.on('close', onClose);
      const signal = AbortSignal.any([abort.signal, lifetime, AbortSignal.timeout(45000)]);
      try {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 140000) throw new Error('large'); chunks.push(chunk); }
        signal.throwIfAborted();
        const args = JSON.parse(Buffer.concat(chunks));
        let result;
        if (req.url.endsWith('/stop')) { await stop(args.token); result = { stopped: true }; }
        else if (req.url.endsWith('/ping')) { renew(args.token); result = { active: true }; }
        else {
          if (starting || sessions.size) { res.writeHead(409); res.end(); return; }
          starting = true;
          try {
            const session = await startVoice({ kind: args.kind, sdp: args.sdp, config, credential, signal });
            const token = randomUUID(); sessions.set(token, session);
            renew(token);
            if (signal.aborted) { await stop(token); signal.throwIfAborted(); }
            result = { token, sdp: session.sdp };
          } finally { starting = false; }
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(result));
      } catch (error) {
        if (!res.destroyed) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error instanceof OpenAIError ? error.code : 'OPENAI_VOICE_FAILED' })); }
      } finally { res.off('close', onClose); }
    })()) }));
  });
}
