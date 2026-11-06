// 使用锁定版本的真实 DSH 适配器，对本机假 API 验证请求和流式结果，不访问模型服务。
// DSH_PREFIX=/path/to/installed/runtime node --test runtime/tests/openai-responses.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

if (!process.env.DSH_PREFIX) throw new Error('Set DSH_PREFIX to the installed pinned runtime');
const { Config, apply } = await import(pathToFileURL(join(resolve(process.env.DSH_PREFIX),
  'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')));

function adapterAt(baseURL) {
  let adapter;
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    // Optional host UI/auth services are not needed for API-key inference.
    inject() {}, on() {},
    get(name) {
      return name === 'credentials' ? {
        async resolve(ref) {
          assert.equal(ref, 'OPENAI_API_KEY');
          return { value: 'sk-test-only' };
        },
      } : undefined;
    },
    waterfall(...args) { return args.at(-1)(); },
    llm: {
      registerConfigurableProviders() { return { replace() {} }; },
      registerModelDiscovery() {},
      registerAdapter(routes, value) {
        assert.deepEqual(routes, ['openai']);
        adapter = value;
        return { replace() {} };
      },
    },
  };
  apply(ctx, Config({ providers: { openai: {
    api: 'openai-responses', baseURL, apiKeyEnv: 'OPENAI_API_KEY',
    models: [{ id: 'gpt-5.4' }], transport: 'sse',
  } } }));
  return adapter;
}

async function endpoint(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
    respond(res, requests.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { requests, adapter: adapterAt(`http://127.0.0.1:${server.address().port}/v1`) };
}

function sendEvents(res, item, deltaEvent, delta) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  event({ type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } });
  event({ type: 'response.output_item.added', output_index: 0,
    item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
  event({ type: deltaEvent, output_index: 0, content_index: 0, delta });
  event({ type: 'response.output_item.done', output_index: 0, item });
  event({ type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [item],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
  res.end();
}

const user = { role: 'user', content: [{ type: 'text', text: '读取测试数据' }] };
const request = { provider: 'openai', model: 'gpt-5.4', messages: [user], reasoningEffort: 'medium',
  tools: [{ name: 'read_test', description: 'Read test data', parameters: {
    type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false,
  } }] };
async function collect(adapter, options = request) {
  const chunks = [];
  for await (const chunk of adapter.stream(options)) chunks.push(chunk);
  return chunks;
}

test('OpenAI route retains the installed model catalog capabilities', async () => {
  const model = await adapterAt('http://127.0.0.1:1/v1').resolveModel('openai', 'gpt-5.4');
  assert(model.inputModalities.includes('image'));
  assert(model.reasoning.efforts.some(e => e.id === 'medium'));
  assert(model.context.contextWindow > 0);
});

test('Responses streams a tool call, accepts its result, then streams Chinese text', async t => {
  const call = { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'read_test',
    arguments: '{"name":"sample"}', status: 'completed' };
  const { requests, adapter } = await endpoint(t, (res, turn) => {
    if (turn === 1) sendEvents(res, call, 'response.function_call_arguments.delta', call.arguments);
    else sendEvents(res, { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '读取完成', annotations: [] }] }, 'response.output_text.delta', '读取完成');
  });
  const first = await collect(adapter);
  assert.equal(requests[0].url, '/v1/responses');
  assert.equal(requests[0].authorization, 'Bearer sk-test-only');
  assert.equal(requests[0].body.model, 'gpt-5.4');
  assert.equal(requests[0].body.reasoning.effort, 'medium');
  assert.equal(requests[0].body.tools[0].name, 'read_test');
  assert.equal(first.at(-1).reason.kind, 'tool-calls');
  const block = first.find(c => c.type === 'block-end' && c.block.type === 'tool-call').block;
  assert.deepEqual(JSON.parse(block.arguments), { name: 'sample' });
  const second = await collect(adapter, { ...request, messages: [user,
    { role: 'assistant', source: { provider: 'openai', model: 'gpt-5.4' }, content: [block],
      replayState: first.at(-1).replayState },
    { role: 'tool', toolCallId: block.id, content: [{ type: 'text', text: '测试结果' }] },
  ] });
  assert(requests[1].body.input.some(item => item.type === 'function_call_output' && item.output.includes('测试结果')));
  assert.equal(second.filter(c => c.type === 'text-delta').map(c => c.text).join(''), '读取完成');
  assert.equal(second.find(c => c.type === 'usage').usage.totalTokens, 15);
  assert.equal(second.at(-1).reason.kind, 'stop');
});

test('an invalid API key returns an authentication error', async t => {
  const { adapter } = await endpoint(t, res => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid test credential', type: 'invalid_request_error' } }));
  });
  const chunks = await collect(adapter);
  assert.equal(chunks.at(-1).reason.failure.code, 'AUTH');
});
