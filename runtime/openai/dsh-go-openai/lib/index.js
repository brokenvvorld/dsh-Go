import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { describe } from './catalog.js';
import { createClient, saveArtifacts, redactSecrets, OpenAIError } from './client.js';
import { workspaceIO } from './workspace.js';
import { installVoice } from './voice.js';
export { Config } from './config.js';
export const name = 'dsh-go-openai';
export const read = value => typeof value?.get === 'function' ? value.get() : value;

const output = { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] };
const schema = properties => ({ type: 'object', properties, additionalProperties: false });
const string = { type: 'string' }, json = { type: 'object', additionalProperties: true };

export function apply(ctx, config) {
  const lifetime = new AbortController();
  const running = new Set();
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...running]); });
  function track(operation) {
    running.add(operation);
    void operation.then(() => running.delete(operation), () => running.delete(operation));
    return operation;
  }
  ctx.inject(['credentials'], credentialsCtx => {
    const credential = async () => {
      if (!read(config.enabled)) throw new OpenAIError('OPENAI_DISABLED');
      const record = await credentialsCtx.credentials.resolve(credentialRef('OPENAI_API_KEY'));
      if (!record?.value) throw new OpenAIError('OPENAI_CREDENTIAL_MISSING');
      return record.value;
    };
    installVoice(credentialsCtx, config, credential, lifetime.signal, track);
    credentialsCtx.inject(['tools', 'fs', 'workingDirectory', 'sandboxPolicy'], toolCtx => {
      const when = async () => read(config.enabled) && Boolean((await credentialsCtx.credentials.resolve(credentialRef('OPENAI_API_KEY')))?.value);
      function register(tool) {
        toolCtx.effect(() => toolCtx.tools.register({ ...tool, output, timeoutMs: 180000, isConcurrencySafe: () => false }, { when }));
      }
      register({ name: 'openai_catalog', description: '查阅全部 OpenAI 扩展能力、当前可用状态、具体操作的参数和例子。首次调用某项能力前先查目录。',
        parameters: schema({ family: string, operation: string }),
        execute: async args => JSON.stringify(describe(args.family, args.operation)),
      });
      const execute = (args, exec) => track((async () => {
        const signal = AbortSignal.any([exec.signal, lifetime.signal, AbortSignal.timeout(180000)]);
        const io = workspaceIO(toolCtx, exec);
        const resolvedSecrets = [];
        io.credential = async ref => {
          if (!read(config.mcpCredentialRefs).includes(ref) || ref === 'OPENAI_API_KEY') throw new OpenAIError('OPENAI_CREDENTIAL_REFERENCE_DENIED');
          const record = await credentialsCtx.credentials.resolve(credentialRef(ref));
          signal.throwIfAborted();
          if (!record?.value) throw new OpenAIError('OPENAI_CREDENTIAL_MISSING');
          resolvedSecrets.push(record.value);
          return record.value;
        };
        const client = createClient({ credential: async () => { const key = await credential(); resolvedSecrets.push(key); return key; }, io, training: read(config.allowFineTuning), approve: async row =>
          await toolCtx.approval?.request({ agent: exec.agent, callId: exec.callId, toolName: 'openai_call', reason: row.id, signal }) === 'allowed-once' });
        if (args.operation === 'POST /responses' && !args.body?.model) args = { ...args, body: { ...args.body, model: read(config.responseModel) } };
        try {
          const response = await client.request(args, signal);
          // Webhook signing secrets are write-once API results. Save to the Host's
          // credential service before redacting them from transcript and artifacts.
          if (args.operation.startsWith('POST /webhook_endpoints') && typeof response.data?.signing_secret === 'string') {
            const ref = `OPENAI_WEBHOOK_${String(response.data.id ?? 'SIGNING').replace(/\W/g, '_').toUpperCase()}`;
            await credentialsCtx.credentials.set(credentialRef(ref), response.data.signing_secret);
            response.data.credential_ref = ref;
            resolvedSecrets.push(response.data.signing_secret);
          }
          const result = await saveArtifacts(redactSecrets(response, resolvedSecrets), io, signal, args.body?.output_format ?? args.body?.audio?.format);
          let text = JSON.stringify(result);
          if (text.length > 48000) {
            const file = await io.save(Buffer.from(text), 'application/json', signal);
            text = JSON.stringify({ requestId: result.requestId, file, preview: text.slice(0, 12000), truncated: true });
          }
          return text + io.saved.map(path => `\n[${path.split('/').pop()}](${path})`).join('');
        } catch (error) {
          if (signal.aborted) throw new Error(`OPENAI_CANCELLED_OR_TIMEOUT: 已提交的云端任务可能仍在运行，请查询后再试。检查点：${io.saved.join(', ')}`);
          if (error instanceof OpenAIError) throw new Error(`${error.code} ${JSON.stringify(error.details)} 检查点：${io.saved.join(', ')}`);
          // Transport errors may contain request headers or URLs. Never forward them to a model/log.
          throw new Error(`OPENAI_REQUEST_FAILED: 请求未完成，请检查连接或参数；不要直接重复提交付费任务。检查点：${io.saved.join(', ')}`);
        }
      })());
      register({ name: 'openai_call', description: '使用 openai_catalog 中的 OpenAI API 操作。支持完整请求参数、云端任务续写/查询/取消、文件上传下载和产物保存。密钥由主机注入；禁止在参数中填写密钥。操作完成不代表异步任务成功，必须检查 status、required_actions 或最终事件。',
        parameters: { ...schema({ operation: string, params: json, query: json, body: json }), required: ['operation'] }, execute });
      register({ name: 'openai_decide', description: 'OpenAI Decisions：对文本、图片、JSON 或对话作条件概率判断、分类或评分。1–400 个问题；保留概率、置信度和 refusal，不将概率视作保证。',
        parameters: { ...schema({ input: {}, questions: { type: 'array', items: json }, prompt_cache_key: string, prompt_cache_options: json }), required: ['input', 'questions'] },
        execute: (args, exec) => execute({ operation: 'POST /decisions', body: { ...args, model: 'gpt-6-luna' } }, exec) });
    });
  });
}
