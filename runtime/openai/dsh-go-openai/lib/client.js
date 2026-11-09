import { admitted } from './catalog.js';

export const API_ROOT = 'https://api.openai.com/v1';
export const MAX_BYTES = 64 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class OpenAIError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
}
const fail = code => { throw new OpenAIError(code); };

export function requestPath(row, params = {}, query = {}) {
  if (!object(params) || !object(query)) fail('OPENAI_INVALID_ARGUMENT');
  const used = new Set();
  let path = row.path.replace(/\{([^}]+)\}/g, (_, name) => {
    used.add(name);
    const value = params[name];
    if (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x20/\\?#%]/.test(value) || value === '.' || value === '..') fail('OPENAI_INVALID_RESOURCE_ID');
    return encodeURIComponent(value);
  });
  if (Object.keys(params).some(key => !used.has(key))) fail('OPENAI_UNKNOWN_PATH_PARAMETER');
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!/^[a-zA-Z_][\w.\[\]]{0,127}$/.test(key)) fail('OPENAI_INVALID_QUERY');
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!['string', 'number', 'boolean'].includes(typeof item)) fail('OPENAI_INVALID_QUERY');
      qs.append(Array.isArray(value) ? `${key}[]` : key, String(item));
    }
  }
  if (qs.size) path += `?${qs}`;
  return path;
}

export function validateDecision(body) {
  if (body.model !== 'gpt-6-luna' || !Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 400) fail('OPENAI_INVALID_DECISIONS');
  if (!(typeof body.input === 'string' || Array.isArray(body.input))) fail('OPENAI_INVALID_DECISIONS_INPUT');
  const names = new Set();
  for (const q of body.questions) {
    if (!object(q) || !['predicate', 'choice', 'score'].includes(q.type) || !(typeof q.instructions === 'string' || Array.isArray(q.instructions))) fail('OPENAI_INVALID_QUESTION');
    if (q.name != null && (typeof q.name !== 'string' || names.has(q.name))) fail('OPENAI_DUPLICATE_QUESTION');
    if (q.name != null) names.add(q.name);
    if (q.type === 'choice' && (!Array.isArray(q.choices) || !q.choices.length)) fail('OPENAI_INVALID_CHOICES');
    if (q.type === 'score' && (!Array.isArray(q.levels) || !q.levels.length)) fail('OPENAI_INVALID_LEVELS');
  }
}

// File markers are resolved only by the calling session's workspace adapter.
// They never name a host path directly and never expand environment variables.
export async function materialize(value, io, signal, budget = { bytes: 0 }, depth = 0) {
  signal.throwIfAborted();
  if (depth > 50) fail('OPENAI_INPUT_TOO_DEEP');
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) result.push(await materialize(item, io, signal, budget, depth + 1));
    return result;
  }
  if (!object(value)) return value;
  if ('$credential' in value) {
    if (Object.keys(value).length !== 1 || !io?.credential || typeof value.$credential !== 'string') fail('OPENAI_CREDENTIAL_REFERENCE_DENIED');
    return io.credential(value.$credential);
  }
  const marker = ['$file', '$data_url', '$base64'].find(key => key in value);
  if (marker) {
    if (!io || Object.keys(value).some(k => ![marker, 'mime', 'filename'].includes(k)) || typeof value[marker] !== 'string') fail('OPENAI_INVALID_FILE');
    const file = await io.read(value[marker], signal);
    budget.bytes += file.bytes.length;
    if (budget.bytes > MAX_BYTES) fail('OPENAI_UPLOAD_TOO_LARGE');
    const mime = value.mime ?? file.mime;
    if (typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) fail('OPENAI_INVALID_MIME');
    if (marker === '$data_url') return `data:${mime};base64,${Buffer.from(file.bytes).toString('base64')}`;
    if (marker === '$base64') return Buffer.from(file.bytes).toString('base64');
    const filename = value.filename ?? file.name;
    if (typeof filename !== 'string' || !filename || /[\x00-\x1f\\]/.test(filename) || filename.split('/').some(s => s === '..' || s === '.')) fail('OPENAI_INVALID_FILENAME');
    return new File([file.bytes], filename, { type: mime });
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('OPENAI_INVALID_ARGUMENT');
    result[key] = await materialize(child, io, signal, budget, depth + 1);
  }
  return result;
}

function hasFile(value) {
  return value instanceof Blob || Array.isArray(value) && value.some(hasFile) || object(value) && Object.values(value).some(hasFile);
}
export function multipart(body) {
  const form = new FormData();
  function append(key, value) {
    if (value === undefined) return;
    if (value instanceof Blob) form.append(key, value, value.name ?? 'upload');
    else if (Array.isArray(value)) value.forEach(v => append(`${key}[]`, v));
    else if (object(value)) Object.entries(value).forEach(([k, v]) => append(`${key}[${k}]`, v));
    else form.append(key, value === null ? '' : String(value));
  }
  Object.entries(body).forEach(([key, value]) => append(key, value));
  return form;
}

export async function boundedBytes(response, signal, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); fail('OPENAI_RESPONSE_TOO_LARGE'); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) fail('OPENAI_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function events(response, signal, io) {
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  const result = []; const checkpoints = new Set(); let pending = '', size = 0, terminal = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!terminal) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      size += value.length; if (size > MAX_BYTES) fail('OPENAI_RESPONSE_TOO_LARGE');
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end;
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 2);
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { terminal = true; break; }
        let event; try { event = JSON.parse(data); } catch { fail('OPENAI_INVALID_EVENT'); }
        result.push(event);
        const id = event.response?.id ?? event.session?.id ?? event.session_id;
        if (typeof id === 'string' && !checkpoints.has(id) && io) {
          checkpoints.add(id);
          await io.save(Buffer.from(JSON.stringify({ id, type: event.type, note: 'Query this resource before retrying interrupted work.' })), 'application/json', signal);
        }
        if (/^response\.(completed|failed|cancelled|incomplete)$/.test(event.type)
          || /^agent\.session\.(failed|environment\.failed)$/.test(event.type)
          || /^agent\.session\.turn\.(completed|failed|cancelled)$/.test(event.type) && !event.subagent_id && !event.turn?.subagent_id) { terminal = true; break; }
      }
    }
    return { events: result, streamEnded: true, terminal, recovery: terminal ? null : 'Stream ended before a terminal event. Retrieve the response/session before submitting more work.' };
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createClient({ credential, io, approve, training = false, fetchImpl = fetch, root = API_ROOT }) {
  // root is an internal test seam, never exposed in the agent's arguments.
  return {
    async request(args, signal, { native = false } = {}) {
      const row = admitted(args.operation, { native, training });
      if (!object(args.body ?? {})) fail('OPENAI_INVALID_BODY');
      if (row.confirmation && !await approve?.(row)) fail('OPENAI_APPROVAL_REQUIRED');
      // Beta Responses uses both a query selector and a feature header. Recovery
      // requests have no creation body, so callers retain query.beta with the ID.
      const multiAgent = row.family === 'responses' && (args.body?.multi_agent?.enabled === true || args.query?.beta === true);
      const path = requestPath(row, args.params, multiAgent ? { ...args.query, beta: true } : args.query);
      if (row.method === 'GET' && Object.keys(args.body ?? {}).length) fail('OPENAI_GET_BODY');
      if (row.family === 'decisions') validateDecision(args.body);
      const body = await materialize(args.body ?? {}, io, signal);
      const key = await credential(); signal.throwIfAborted();
      if (typeof key !== 'string' || !key.trim()) fail('OPENAI_CREDENTIAL_MISSING');
      const headers = { Authorization: `Bearer ${key}` };
      if (row.beta) headers['OpenAI-Beta'] = row.beta;
      if (multiAgent) headers['OpenAI-Beta'] = 'responses_multi_agent=v1';
      let payload;
      if (row.method !== 'GET') {
        if (row.multipart || row.optionalMultipart && hasFile(body)) payload = multipart(body);
        else {
          if (hasFile(body)) fail('OPENAI_FILE_REQUIRES_MULTIPART');
          payload = JSON.stringify(body);
          if (Buffer.byteLength(payload) > MAX_BYTES) fail('OPENAI_INPUT_TOO_LARGE');
          headers['Content-Type'] = 'application/json';
        }
      }
      // Redirects must never carry the account key to a download/CDN host. No automatic
      // retry: a timed-out POST may already have created a billable job.
      const response = await fetchImpl(`${root}${path}`, { method: row.method, headers, body: payload, signal, redirect: 'error' });
      const requestId = response.headers.get('x-request-id');
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const bytes = await boundedBytes(response, signal, 65536);
        let code; try { code = JSON.parse(bytes).error?.code; } catch {}
        throw new OpenAIError('OPENAI_HTTP_ERROR', { status: response.status, requestId, code: typeof code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(code) ? code : null });
      }
      if (type.includes('text/event-stream')) return { requestId, data: await events(response, signal, io) };
      const bytes = await boundedBytes(response, signal);
      if (!bytes.length) return { requestId, data: { status: response.status } };
      if (type.includes('json')) {
        let data; try { data = JSON.parse(bytes); } catch { fail('OPENAI_INVALID_JSON'); }
        return { requestId, data };
      }
      if (native) return { requestId, data: bytes.toString('utf8'), location: response.headers.get('location') };
      if (!io) fail('OPENAI_WORKSPACE_REQUIRED');
      return { requestId, data: { file: await io.save(bytes, type, signal), contentType: type } };
    },
  };
}

export function redactSecrets(value, secrets) {
  if (typeof value === 'string') { for (const secret of secrets) value = value.split(secret).join('[redacted]'); return value; }
  if (Array.isArray(value)) return value.map(v => redactSecrets(v, secrets));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactSecrets(child, secrets)]));
  return value;
}

export async function saveArtifacts(value, io, signal, formatHint) {
  if (Array.isArray(value)) {
    const out = []; for (const item of value) out.push(await saveArtifacts(item, io, signal, formatHint)); return out;
  }
  if (!object(value)) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const generatedImage = key === 'b64_json' || key === 'result' && value.type === 'image_generation_call';
    const generatedAudio = key === 'data' && typeof value.transcript === 'string' && typeof value.id === 'string';
    if ((generatedImage || generatedAudio) && typeof item === 'string') {
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(item) || item.length > MAX_BYTES * 1.4) fail('OPENAI_INVALID_MEDIA');
      const format = value.output_format ?? value.format ?? formatHint ?? (generatedImage ? 'png' : 'wav');
      const mime = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/ogg', flac: 'audio/flac', pcm: 'audio/pcm' })[format];
      result.file = await io.save(Buffer.from(item, 'base64'), mime ?? 'application/octet-stream', signal);
    } else if (['client_secret', 'api_key', 'access_token', 'refresh_token', 'secret', 'signing_secret', 'authorization'].includes(key)) result[key] = '[redacted]';
    else result[key] = await saveArtifacts(item, io, signal, value.output_format ?? value.format ?? formatHint);
  }
  return result;
}
