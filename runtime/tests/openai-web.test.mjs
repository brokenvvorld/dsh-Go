import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSearchProvider, installWeb, searchResult } from '../openai/dsh-go-openai/lib/web.js';

const key = 'sk-test-search-only';
const config = { enabled: { get: () => true }, responseModel: { get: () => 'gpt-6.1-sol' } };
const response = () => ({ status: 'completed', output: [
  { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [
    { type: 'url', url: 'https://example.com/one', title: 'First' },
    { type: 'url', url: 'https://example.com/two' },
  ] } },
  { type: 'message', content: [{ type: 'output_text', text: 'Fact [1]', annotations: [
    { type: 'url_citation', start_index: 5, end_index: 8, url: 'https://example.com/one', title: 'First' },
  ] }] },
] });

test('search calls Responses with the shared key, forces search and preserves clickable sources', async () => {
  let requests = 0;
  const provider = createSearchProvider({ config, credential: async () => key, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-6.1-sol');
    assert.equal(body.input, '今天有什么新闻');
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, [{ type: 'web_search', user_location: { type: 'approximate' } }]);
    assert.deepEqual(body.include, ['web_search_call.action.sources']);
    return Response.json(response());
  } });
  assert.equal(await provider.ready('openai'), true);
  assert.equal(await provider.ready('openai-codex'), true, 'subscription chat may use a separately configured API key for search');
  const result = await provider.search({ query: '今天有什么新闻' });
  assert.equal(result.content, 'Fact [First](https://example.com/one)');
  assert.equal(result.sources.length, 2);
  assert.equal(result.truncated, false);
  assert.equal(requests, 1);
});

test('missing key and disabled extension hide search without trying a network request', async () => {
  const provider = createSearchProvider({ config, credential: async () => undefined, fetchImpl: () => assert.fail('no request') });
  assert.equal(await provider.ready('openai'), false);
  await assert.rejects(provider.search({ query: 'x' }), { code: 'OPENAI_CREDENTIAL_MISSING' });
  const disabled = createSearchProvider({ config: { ...config, enabled: { get: () => false } }, credential: async () => key, fetchImpl: () => assert.fail('disabled') });
  assert.equal(await disabled.ready('openai'), false);
  await assert.rejects(disabled.search({ query: 'x' }), { code: 'OPENAI_DISABLED' });
});

test('search refuses incomplete or no-search answers and filters unsafe citation URLs', () => {
  assert.throws(() => searchResult({ ...response(), status: 'incomplete' }), { code: 'OPENAI_SEARCH_INCOMPLETE' });
  assert.throws(() => searchResult({ status: 'completed', output: [response().output[1]] }), { code: 'OPENAI_SEARCH_NOT_PERFORMED' });
  const data = response();
  data.output[0].action.sources.push({ url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com' });
  assert.equal(searchResult(data).sources.length, 2);
});

test('cancelled, failed and rejected requests neither leak credentials nor retry', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  let count = 0;
  const provider = createSearchProvider({ config, credential: async () => key, fetchImpl: async () => { count++; throw new Error(`headers: ${key}`); } });
  await assert.rejects(provider.search({ query: 'x' }, cancelled.signal));
  assert.equal(count, 0);
  await assert.rejects(provider.search({ query: 'x' }), error => error.code === 'OPENAI_SEARCH_FAILED' && !String(error).includes(key));
  assert.equal(count, 1);
  const rejected = createSearchProvider({ config, credential: async () => key, fetchImpl: async () => Response.json({ error: { message: key, code: 'invalid_api_key' } }, { status: 401 }) });
  await assert.rejects(rejected.search({ query: 'x' }), error => error.details.status === 401 && !JSON.stringify(error).includes(key));
});

test('actual DSH web registry selects OpenAI, gates on key and caps results', { skip: !process.env.DSH_PREFIX }, async t => {
  const base = join(resolve(process.env.DSH_PREFIX), 'node_modules/@deepseek-ai');
  const { Context } = await import(pathToFileURL(join(base, 'cordis/lib/index.js')));
  const { WebRuntime } = await import(pathToFileURL(join(base, 'dsh-web/lib/index.js')));
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(WebRuntime, { searchProvider: 'openai', fetchProvider: 'http' });
  let credential;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    return Response.json(response());
  };
  installWeb(ctx, config, async () => credential, new AbortController().signal, value => value);
  await new Promise(done => setImmediate(done));
  assert.equal(await ctx.web.searchReady('openai'), false);
  credential = key;
  assert.equal(await ctx.web.searchReady('openai'), true);
  const result = await ctx.web.search({ query: 'x', maxResults: 1 });
  assert.equal(result.sources.length, 1);
  assert.equal(result.truncated, true);
  assert.match(result.content, /\[First\]\(https:\/\/example.com\/one\)/);
});
