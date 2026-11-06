import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm, cp, symlink, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admitted, describe, operations } from '../openai/dsh-go-openai/lib/catalog.js';
import { createClient, requestPath, saveArtifacts, redactSecrets } from '../openai/dsh-go-openai/lib/client.js';
import { workspaceIO } from '../openai/dsh-go-openai/lib/workspace.js';
import { startVoice, sessionConfig, installVoice } from '../openai/dsh-go-openai/lib/voice.js';

const signal = () => new AbortController().signal;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' } });
const key = 'sk-test-only';
const decision = { model: 'gpt-6-luna', input: '判断这段话', questions: [{ type: 'predicate', name: 'question', instructions: '是否在问问题？' }] };
function fakeIO() {
  const files = [];
  return { files, async read(path) { return { bytes: Buffer.from(path), name: '文件.wav', mime: 'audio/wav' }; }, async save(bytes, type) { files.push({ bytes, type }); return `/workspace/output-${files.length}`; } };
}

test('catalog covers current application API families and excludes retired or secret-only calls', () => {
  for (const name of ['decisions', 'agents', 'responses', 'live', 'realtime', 'images', 'audio', 'files', 'uploads', 'vector_stores', 'skills', 'embeddings', 'moderations', 'content_provenance_checks', 'batches', 'containers', 'conversations', 'fine_tuning', 'evals', 'vaults', 'webhooks']) assert.ok(describe().families.some(f => f.id === name), name);
  assert.ok(operations.size >= 180);
  for (const id of ['POST /videos', 'POST /assistants', 'POST /images/variations', 'POST /organization/api_keys', 'POST /evals']) assert.throws(() => admitted(id));
  assert.throws(() => admitted('POST /realtime/client_secrets'));
  assert.throws(() => admitted('POST /live/sessions'));
  assert.throws(() => admitted('POST /fine_tuning/jobs'));
  assert.ok(admitted('POST /fine_tuning/jobs', { training: true, now: new Date('2026-11-06') }));
  assert.throws(() => admitted('GET /evals', { now: new Date('2026-11-30') }));
  assert.throws(() => admitted('POST /audio/speech', { now: new Date('2027-01-06') }));
});

test('every catalog route has an exact method and rejects path substitution attacks', () => {
  for (const row of operations.values()) {
    const names = [...row.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
    const path = requestPath(row, Object.fromEntries(names.map(n => [n, 'resource_123'])));
    assert.match(path, /^\/[a-z_]+/); assert.ok(!path.includes('{')); assert.ok(row.source.startsWith('https://developers.openai.com/'));
  }
  const row = admitted('GET /files/{file_id}');
  for (const id of ['../models', '..', 'x?y', 'x%2Fy', 'x/y', 'x\\y']) assert.throws(() => requestPath(row, { file_id: id }));
  assert.throws(() => requestPath(row, { file_id: 'file_1', other: 'oops' }));
});

test('Decisions sends typed questions, JSON evidence and inline image, preserving refusal/probability', async () => {
  const io = fakeIO(); let sent;
  const answers = [{ name: 'yes', type: 'predicate', probability: 0.77 }, { name: 'category', type: 'refusal' }];
  const client = createClient({ io, credential: async () => key, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/decisions'); assert.equal(options.headers.Authorization, `Bearer ${key}`);
    sent = JSON.parse(options.body); return json({ answers });
  } });
  const body = { ...decision, input: [{ role: 'user', content: [{ type: 'input_json', data: { value: 42 } }, { type: 'input_image', image_url: { $data_url: '/workspace/image.png', mime: 'image/png' } }] }],
    questions: [{ type: 'predicate', name: 'yes', instructions: '是吗？' }, { type: 'choice', name: 'category', instructions: '分类', choices: [{ value: 'a' }, { value: 'b' }] }] };
  assert.deepEqual((await client.request({ operation: 'POST /decisions', body }, signal())).data.answers, answers);
  assert.equal(sent.input[0].content[0].data.value, 42); assert.match(sent.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.equal(sent.questions[1].choices[0].value, 'a');
});

test('Decisions rejects duplicate names and requests above 400 before HTTP', async () => {
  const client = createClient({ credential: async () => key, fetchImpl: () => assert.fail('must not send') });
  await assert.rejects(client.request({ operation: 'POST /decisions', body: { ...decision, questions: [decision.questions[0], decision.questions[0]] } }, signal()), /DUPLICATE/);
  await assert.rejects(client.request({ operation: 'POST /decisions', body: { ...decision, questions: Array.from({ length: 401 }, () => ({ type: 'predicate', instructions: 'x' })) } }, signal()), /INVALID_DECISIONS/);
});

test('Responses retains native tools, file input, schema, cache and multi-agent options', async () => {
  const body = { model: 'gpt-6.1-sol', input: [{ role: 'user', content: [{ type: 'input_file', file_id: 'file_1' }] }],
    tools: [{ type: 'web_search' }, { type: 'file_search', vector_store_ids: ['vs_1'] }, { type: 'code_interpreter', container: { type: 'auto' } }, { type: 'image_generation' }, { type: 'shell', environment: { type: 'container_auto' } }, { type: 'tool_search' }, { type: 'programmatic_tool_calling' }],
    multi_agent: { enabled: true, max_concurrent_subagents: 2 }, text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' } } }, background: true, prompt_cache_key: 'cache', reasoning: { effort: 'high' } };
  const client = createClient({ credential: async () => key, fetchImpl: async (_, options) => {
    assert.deepEqual(JSON.parse(options.body), body); assert.equal(options.headers['OpenAI-Beta'], 'responses_multi_agent=v1');
    return json({ id: 'resp_1', status: 'queued' });
  } });
  assert.equal((await client.request({ operation: 'POST /responses', body }, signal())).data.status, 'queued');
});

test('Agents lifecycle uses required beta header and does not label required actions completed', async () => {
  const seen = [];
  const client = createClient({ credential: async () => key, fetchImpl: async (url, options) => {
    seen.push([url, options.method, options.headers['OpenAI-Beta']]);
    return json({ id: 'sess_1', status: 'requires_action', required_actions: [{ type: 'function_call' }] });
  } });
  const created = await client.request({ operation: 'POST /agents/sessions', body: { agent: { model: 'gpt-6.1-sol' }, environment: { type: 'openai_hosted' }, input: 'task' } }, signal());
  assert.equal(created.data.status, 'requires_action');
  await client.request({ operation: 'GET /agents/sessions/{session_id}', params: { session_id: created.data.id } }, signal());
  await client.request({ operation: 'POST /agents/sessions/{session_id}/events', params: { session_id: created.data.id }, body: { events: [{ type: 'agent.session.input.message', message: 'continue' }] } }, signal());
  assert.ok(seen.every(r => r[2] === 'agents=v1')); assert.equal(seen[1][0], 'https://api.openai.com/v1/agents/sessions/sess_1');
});

test('multipart reaches an actual HTTP server with binary file and no manual boundary', async t => {
  let received;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = await new Request('http://localhost', { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }).formData();
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"file_1"}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createClient({ credential: async () => key, io: fakeIO(), root: `http://127.0.0.1:${server.address().port}` });
  await client.request({ operation: 'POST /files', body: { purpose: 'user_data', file: { $file: '/workspace/test.txt' } } }, signal());
  assert.equal(received.get('purpose'), 'user_data'); assert.equal(await received.get('file').text(), '/workspace/test.txt');
});

test('multipart arrays support image references, masks and skill archives', async () => {
  const client = createClient({ credential: async () => key, io: fakeIO(), fetchImpl: async (_, options) => {
    assert.ok(options.body instanceof FormData); assert.equal(options.body.getAll('image[]').length, 2); assert.ok(options.body.get('mask') instanceof File); return json({ data: [] });
  } });
  await client.request({ operation: 'POST /images/edits', body: { model: 'gpt-image-2.6-flare', image: [{ $file: 'one.png' }, { $file: 'two.png' }], mask: { $file: 'mask.png' }, prompt: '修改' } }, signal());
});

test('vector search uses POST and pagination/filter data survives unchanged', async () => {
  const client = createClient({ credential: async () => key, fetchImpl: async (url, options) => {
    assert.equal(options.method, 'POST'); assert.equal(url, 'https://api.openai.com/v1/vector_stores/vs_1/search');
    assert.equal(JSON.parse(options.body).query, '在哪里'); return json({ data: [{ score: 0.9 }], has_more: false });
  } });
  assert.equal((await client.request({ operation: 'POST /vector_stores/{vector_store_id}/search', params: { vector_store_id: 'vs_1' }, body: { query: '在哪里', max_num_results: 5 } }, signal())).data.data[0].score, 0.9);
});

test('SSE handles split CRLF and persists recovery IDs before root completion', async () => {
  const io = fakeIO();
  const lines = [
    'data: {"type":"response.created","response":{"id":"resp_1"}}\r', '\n\r\n',
    'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\r\n\r\n',
  ];
  const client = createClient({ credential: async () => key, io, fetchImpl: async () => new Response(new ReadableStream({ start(controller) { for (const line of lines) controller.enqueue(Buffer.from(line)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const result = await client.request({ operation: 'POST /responses', body: { model: 'm', input: 'x', stream: true } }, signal());
  assert.equal(result.data.terminal, true); assert.equal(result.data.events.length, 2); assert.match(io.files[0].bytes.toString(), /resp_1/);
});

test('HTTP errors hide response secrets, no redirect and no automatic POST retry', async () => {
  let count = 0;
  const client = createClient({ credential: async () => key, fetchImpl: async (_, options) => {
    count++; assert.equal(options.redirect, 'error'); return json({ error: { code: 'invalid_api_key', message: key } }, 401);
  } });
  await assert.rejects(client.request({ operation: 'POST /decisions', body: decision }, signal()), error => error.details.status === 401 && !JSON.stringify(error).includes(key));
  assert.equal(count, 1);
});

test('cancellation and oversize response terminate reading', async () => {
  const controller = new AbortController(); controller.abort();
  const client = createClient({ credential: async () => key, fetchImpl: () => assert.fail('aborted') });
  await assert.rejects(client.request({ operation: 'GET /models' }, controller.signal));
  const big = createClient({ credential: async () => key, fetchImpl: async () => new Response('x', { headers: { 'content-length': '100000000' } }) });
  await assert.rejects(big.request({ operation: 'GET /models' }, signal()), /TOO_LARGE/);
});

test('deletes and cloud schedules require approval before sending', async () => {
  const client = createClient({ credential: async () => key, approve: async () => false, fetchImpl: () => assert.fail('denied') });
  await assert.rejects(client.request({ operation: 'DELETE /files/{file_id}', params: { file_id: 'file_1' } }, signal()), /APPROVAL/);
  await assert.rejects(client.request({ operation: 'POST /agents/automations', body: {} }, signal()), /APPROVAL/);
});

test('image and audio bytes become artifacts, including SVG/GIF, secrets do not reach output', async () => {
  const io = fakeIO();
  const value = await saveArtifacts({ output: [{ type: 'image_generation_call', result: Buffer.from('<svg/>').toString('base64'), output_format: 'svg' }], data: [{ b64_json: 'R0lGODlh', output_format: 'gif' }], secret: 'whsec_private' }, io, signal());
  assert.equal(io.files[0].type, 'image/svg+xml'); assert.equal(io.files[1].type, 'image/gif'); assert.equal(value.secret, '[redacted]');
  assert.ok(!JSON.stringify(value).includes('base64'));
  assert.deepEqual(redactSecrets({ output: 'a"b' }, ['a"b']), { output: '[redacted]' });
});

test('MCP credentials resolve only through the explicit credential adapter', async () => {
  const io = fakeIO();
  io.credential = async ref => { assert.equal(ref, 'MCP_TOKEN'); return 'secret-token'; };
  const client = createClient({ credential: async () => key, io, fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).tools[0].authorization, 'secret-token'); return json({ output: [] });
  } });
  await client.request({ operation: 'POST /responses', body: { model: 'm', tools: [{ type: 'mcp', authorization: { $credential: 'MCP_TOKEN' } }] } }, signal());
});

const voiceConfig = { voice: 'marin', responseModel: 'gpt-6.1-sol', liveModel: 'gpt-live-1', realtimeModel: 'gpt-realtime-2.1-mini', translationLanguage: 'zh' };
test('Live negotiates WebRTC with hosted Responses delegation and returns no key', async () => {
  const result = await startVoice({ kind: 'live', sdp: 'v=0\r\n', config: voiceConfig, credential: async () => key, signal: signal(), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/live/sessions'); const body = JSON.parse(options.body);
    assert.equal(body.transport.type, 'webrtc'); assert.equal(body.session.delegation.type, 'responses'); assert.equal(body.session.audio.output.voice, 'marin');
    return json({ session: { id: 'live_1' }, transport: { sdp: 'v=0\r\nanswer' } });
  } });
  assert.deepEqual(result, { id: 'live_1', kind: 'live', sdp: 'v=0\r\nanswer' });
});

for (const kind of ['realtime', 'transcription', 'translation']) test(`${kind} keeps ephemeral credential on Host and exchanges SDP`, async () => {
  const seen = [];
  const result = await startVoice({ kind, sdp: 'v=0\r\n', config: voiceConfig, credential: async () => key, signal: signal(), fetchImpl: async (url, options) => {
    seen.push([url, options]);
    return seen.length === 1 ? json({ value: 'ephemeral-secret' }) : new Response('v=0\r\nanswer', { headers: { location: '/v1/realtime/calls/call_1' } });
  } });
  assert.equal(seen.length, 2); assert.equal(seen[1][1].headers.Authorization, 'Bearer ephemeral-secret'); assert.equal(seen[1][1].headers['Content-Type'], 'application/sdp');
  assert.ok(!JSON.stringify(result).includes('secret'));
  if (kind === 'transcription') assert.equal(sessionConfig(kind, voiceConfig).audio.input.turn_detection, null);
});

test('workspace rejects escaped symlinks, saves without overwriting, and fails after session change', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openai-scope-')); t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'work'); await import('node:fs/promises').then(fs => fs.mkdir(workspace));
  await writeFile(join(root, 'private'), 'secret'); await symlink(join(root, 'private'), join(workspace, 'escape'));
  const session = { id: 's' }, fiber = { assertActive() {} }, agent = { session, ctx: { fiber } };
  const fs = {
    async resolve(path, options) { const p = await realpath(resolve(options?.cwd ?? workspace, path)); return { targetKey: p, displayPath: p }; },
    contains(parent, child) { const p = relative(parent.targetKey, child.targetKey); return !p.startsWith('..') && !isAbsolute(p); },
    async stat(target) { const s = await stat(target.targetKey); return { type: s.isFile() ? 'file' : 'directory', size: s.size, version: String(s.mtimeMs) }; },
    async readByteRange(target) { return readFile(target.targetKey); }, processPath: target => target.targetKey, processPathFromHostPath: p => p,
  };
  const io = workspaceIO({ fs, fiber, workingDirectory: { ensure: async () => workspace }, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) } }, { agent });
  await assert.rejects(io.read('escape', signal()), /DENIED/);
  const saved = await io.save(Buffer.from('hello'), 'text/plain', signal()); assert.equal(await readFile(saved, 'utf8'), 'hello');
  agent.session = { id: 'other' }; await assert.rejects(io.read(saved, signal()), /DENIED/);
});

test('plugin loads against pinned DSH, registers supported tool schemas and uses credential references', async t => {
  if (!process.env.DSH_PREFIX) throw new Error('Set DSH_PREFIX to the pinned runtime');
  const root = await mkdtemp(join(tmpdir(), 'openai-plugin-')); t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(join(resolve(process.env.DSH_PREFIX), 'node_modules'), join(root, 'node_modules'));
  await cp(new URL('../openai/dsh-go-openai', import.meta.url), join(root, 'plugin'), { recursive: true });
  const { Config, apply, read } = await import(pathToFileURL(join(root, 'plugin/lib/index.js')));
  assert.equal(read(Config({}).enabled), true);
  assert.equal(read(Config({ enabled: false }).enabled), false);
  assert.equal(read(Config({}).responseModel), 'gpt-6.1-sol');
  assert.equal(sessionConfig('live', Config({})).audio.output.voice, 'marin');
  const fixture = JSON.parse(await readFile(new URL('../../app/test/openai/fixtures/settings.json', import.meta.url)));
  assert.deepEqual(fixture.namespaces[0].base, Object.fromEntries(Object.entries(Config({})).map(([k, v]) => [k, read(v)])));
  const { assertSupportedJsonSchema } = await import(pathToFileURL(join(resolve(process.env.DSH_PREFIX), 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')));
  const registered = [], cleanups = [];
  const ctx = { credentials: { resolve: async ref => { assert.equal(ref, 'OPENAI_API_KEY'); return { value: key }; } }, fs: {}, workingDirectory: {}, sandboxPolicy: {},
    tools: { register(tool, options) { assertSupportedJsonSchema(tool.parameters); assertSupportedJsonSchema(tool.output.schema); registered.push({ tool, options }); return () => {}; } },
    inject(names, cb) { if (names.every(n => n in ctx)) cb(ctx); }, effect(cb) { cleanups.push(cb()); },
  };
  apply(ctx, Config({}));
  assert.deepEqual(registered.map(r => r.tool.name), ['openai_catalog', 'openai_call', 'openai_decide']);
  assert.equal(await registered[0].options.when(), true);
  const listing = JSON.parse(await registered[0].tool.execute({ family: 'decisions' })); assert.equal(listing.operations[0].path, '/decisions');
  for (const dispose of cleanups.reverse()) await dispose?.();
});

test('JSON image edits and custom voice prompts retain native request shapes', async () => {
  const client = createClient({ credential: async () => key, fetchImpl: async (_, options) => {
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(options.body);
    assert.ok(body.images?.[0].file_id === 'file_1' || body.prompt === 'Warm, calm voice');
    return json({ id: 'result' });
  } });
  await client.request({ operation: 'POST /images/edits', body: { images: [{ file_id: 'file_1' }], prompt: 'edit' } }, signal());
  await client.request({ operation: 'POST /audio/voices', body: { name: 'Guide', prompt: 'Warm, calm voice' } }, signal());
});

test('image response format applies to every image, and signing secrets are redacted', async () => {
  const io = fakeIO();
  const result = await saveArtifacts({ output_format: 'svg', data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }], signing_secret: 'private' }, io, signal());
  assert.equal(io.files[0].type, 'image/svg+xml');
  assert.equal(result.signing_secret, '[redacted]');
});

test('live Decisions delegates the configured condition and rejects empty questions', () => {
  const config = { ...voiceConfig, liveDecisionQuestion: '是否需要查询最新信息？' };
  assert.equal(sessionConfig('live_decisions', config).delegation.decisions.questions[0].instructions, config.liveDecisionQuestion);
  assert.throws(() => sessionConfig('live_decisions', voiceConfig), /QUESTION_MISSING/);
});

test('native voice route checks Host authentication and never accepts arbitrary action paths', async t => {
  const cleanups = []; let handler, reject = 401;
  const ctx = { connection: { requestRejection: () => reject }, webServer: { register(route) { handler = route.handler; return () => {}; } },
    inject(names, cb) { if (names.every(n => n in ctx)) cb(ctx); }, effect(cb) { cleanups.push(cb()); } };
  installVoice(ctx, voiceConfig, () => assert.fail('no credential access'), signal(), p => p);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); server.close(); for (const dispose of cleanups.reverse()) await dispose?.(); });
  const url = `http://127.0.0.1:${server.address().port}/openai/v1/voice/start`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  reject = undefined;
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(`${url}/other`, { method: 'POST' })).status, 404);
});
