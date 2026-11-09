import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '../openai/dsh-go-openai/lib/client.js';

const key = 'sk-test-only';
const signal = () => new AbortController().signal;
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('Agents preserves error and idle events until session or environment failure', async () => {
  for (const failed of ['agent.session.failed', 'agent.session.environment.failed']) {
    const saved = [];
    const io = { async save(bytes) { saved.push(JSON.parse(bytes)); return '/workspace/checkpoint.json'; } };
    const rows = [
      { type: 'agent.session.created', session: { id: 'as_test' } },
      { type: 'error', error: { code: 'agent_error', message: 'failed' } },
      { type: 'agent.session.idle', session_id: 'as_test' },
      { type: failed, session_id: 'as_test' },
    ];
    const client = createClient({ credential: async () => key, io, fetchImpl: async () => new Response(
      rows.map(row => `data: ${JSON.stringify(row)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }) });
    const result = await client.request({ operation: 'GET /agents/sessions/{session_id}/events', params: { session_id: 'as_test' } }, signal());
    assert.equal(result.data.terminal, true);
    assert.deepEqual(result.data.events.map(row => row.type), rows.map(row => row.type));
    assert.equal(result.data.recovery, null);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, 'as_test');
  }
});

test('Agents updates preserve tools, prompt cache TTL, review and Beta header', async () => {
  const body = { agent: { tools: [{ type: 'web_search' }] }, prompt_cache_options: { ttl: '12h' }, review: 'auto_review' };
  const client = createClient({ credential: async () => key, fetchImpl: async (_, options) => {
    assert.equal(options.headers['OpenAI-Beta'], 'agents=v1');
    assert.deepEqual(JSON.parse(options.body), body);
    return json({ id: 'as_test', ...body });
  } });
  const result = await client.request({ operation: 'POST /agents/sessions/{session_id}', params: { session_id: 'as_test' }, body }, signal());
  assert.deepEqual(result.data.prompt_cache_options, body.prompt_cache_options);
});

for (const firstHangupStatus of [200, 503]) test(`disabled OpenAI cleans up calls and preserves failed hangups (${firstHangupStatus})`, async t => {
  assert.ok(process.env.DSH_PREFIX, 'Set DSH_PREFIX to the pinned runtime');
  const root = await mkdtemp(join(tmpdir(), 'openai-stop-disabled-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(join(resolve(process.env.DSH_PREFIX), 'node_modules'), join(root, 'node_modules'));
  await cp(new URL('../openai/dsh-go-openai', import.meta.url), join(root, 'plugin'), { recursive: true });
  const { Config, apply } = await import(pathToFileURL(join(root, 'plugin/lib/index.js')));
  const cleanups = [], routes = new Map();
  const ctx = {
    credentials: { resolve: async ref => { assert.equal(ref, 'OPENAI_API_KEY'); return { value: key }; } },
    connection: { requestRejection: () => undefined },
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    inject(names, cb) { if (names.every(n => n in ctx)) cb(ctx); },
    effect(cb) { cleanups.push(cb()); },
  };
  const config = Config({}); apply(ctx, config);
  const realFetch = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://api.openai.com/v1/'));
    requests.push(String(url));
    if (String(url).endsWith('/hangup')) return new Response(null, { status: requests.filter(url => url.endsWith('/hangup')).length === 1 ? firstHangupStatus : 200 });
    return json({ session: { id: 'live_test' }, transport: { sdp: 'v=0\r\nanswer' } });
  };
  const server = createServer((req, res) => { void routes.get('/openai/v1/voice')(req, res); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    for (const dispose of cleanups.reverse()) await dispose?.();
    globalThis.fetch = realFetch; server.closeAllConnections(); server.close();
  });
  const call = (action, body) => realFetch(`http://127.0.0.1:${server.address().port}/openai/v1/voice/${action}`, { method: 'POST', body: JSON.stringify(body) });
  const start = await call('start', { kind: 'live', sdp: 'v=0\r\n' });
  assert.equal(start.status, 200); const { token } = await start.json();
  config.enabled = false;
  if (firstHangupStatus !== 200) {
    const failed = await call('stop', { token });
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).error, 'OPENAI_VOICE_HTTP');
    assert.equal((await call('ping', { token })).status, 200);
  }
  assert.equal((await call('stop', { token })).status, 200);
  assert.equal(requests.filter(url => url.endsWith('/hangup')).length, firstHangupStatus === 200 ? 1 : 2);
  const blocked = await call('start', { kind: 'live', sdp: 'v=0\r\n' });
  assert.equal(blocked.status, 502); assert.equal((await blocked.json()).error, 'OPENAI_DISABLED');
  assert.equal(requests.length, firstHangupStatus === 200 ? 2 : 3);
});

test('Multi-agent create and recovery use the beta route and header on the wire', async t => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ url: req.url, beta: req.headers['openai-beta'], body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'resp_multi', status: 'queued' }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createClient({ credential: async () => key, root: `http://127.0.0.1:${server.address().port}/v1`, approve: async () => true });
  await client.request({ operation: 'POST /responses', body: { model: 'gpt-6.1-sol', input: 'test', multi_agent: { enabled: true } } }, signal());
  for (const operation of ['GET /responses/{response_id}', 'POST /responses/{response_id}/cancel', 'GET /responses/{response_id}/input_items', 'DELETE /responses/{response_id}']) {
    await client.request({ operation, params: { response_id: 'resp_multi' }, query: { beta: true } }, signal());
  }
  for (const request of seen) {
    assert.equal(new URL(request.url, 'http://localhost').searchParams.get('beta'), 'true');
    assert.equal(request.beta, 'responses_multi_agent=v1');
  }
  await client.request({ operation: 'POST /responses', body: { model: 'gpt-6.1-sol', input: 'ordinary' } }, signal());
  assert.equal(seen.at(-1).url, '/v1/responses');
  assert.equal(seen.at(-1).beta, undefined);
});

test('an expired voice lease retries a failed cloud hangup and releases the call slot', async t => {
  const { installVoice } = await import('../openai/dsh-go-openai/lib/voice.js');
  const { Readable } = await import('node:stream');
  const { EventEmitter } = await import('node:events');
  const timers = [], routes = new Map(), cleanup = [];
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, delay, ...args) => {
    if (delay !== 90000) return realTimeout(fn, delay, ...args);
    timers.push(fn); return { unref() {} };
  });
  let hangups = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/hangup')) return new Response(null, { status: ++hangups === 1 ? 503 : 200 });
    return json({ session: { id: 'live_lease' }, transport: { sdp: 'v=0\r\nanswer' } });
  });
  const ctx = {
    connection: { requestRejection: () => undefined },
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    inject(names, cb) { if (names.every(n => n in ctx)) cb(ctx); },
    effect(cb) { cleanup.push(cb()); },
  };
  installVoice(ctx, { liveModel: 'gpt-live-1', responseModel: 'gpt-6.1-sol', voice: 'marin' }, async () => key, signal(), x => x);
  t.after(async () => { for (const dispose of cleanup.reverse()) await dispose?.(); });
  async function call(action, body) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.url = `/openai/v1/voice/${action}`;
    const res = new EventEmitter();
    res.writeHead = status => { res.status = status; };
    res.end = body => { res.body = body && JSON.parse(body); res.writableEnded = true; };
    await routes.get('/openai/v1/voice')(req, res);
    return res;
  }
  const first = await call('start', { kind: 'live', sdp: 'v=0\r\n' });
  assert.equal(first.status, 200);
  await timers.shift()();
  await new Promise(setImmediate);
  assert.equal(hangups, 1);
  assert.equal(timers.length, 1, 'failed lease cleanup must arm another cleanup attempt');
  await timers.shift()();
  await new Promise(setImmediate);
  assert.equal(hangups, 2);
  assert.equal((await call('start', { kind: 'live', sdp: 'v=0\r\n' })).status, 200);
});
