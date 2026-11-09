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
