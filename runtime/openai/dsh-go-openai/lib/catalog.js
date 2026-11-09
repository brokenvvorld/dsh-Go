import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../data/operations.json', import.meta.url), 'utf8'));
export const checkedAt = catalog.checkedAt;
export const operations = new Map(catalog.operations.map(row => [row.id, Object.freeze(row)]));

export const workflows = {
  decisions: { description: '条件概率、固定选项分类、按等级评分。支持文本、图片和 JSON；不是生成自由格式答案。',
    example: { model: 'gpt-6-luna', input: '用户的问题或证据', questions: [{ type: 'predicate', name: 'needs_search', instructions: '回答是否需要查询最新资料？' }] } },
  responses: { description: '完整 Responses 请求：图片/文件、结构化输出、思考档位、缓存、后台执行、上下文压缩、联网/文件检索、Code Interpreter、图片、Shell、Skills、MCP、工具搜索、PTC、多 Agent。',
    example: { model: 'gpt-6.1-sol', input: '查询并标注来源', tools: [{ type: 'web_search' }], store: false },
    continuation: '本地 function/computer/shell/apply_patch 调用返回后，必须通过现有 DSH 工具和审批执行，再以匹配 call_id 的 output 回传；不把调用请求当作已经执行。MCP 审批也需要用户决定。后台任务保存 response id 后 retrieve/cancel，不重复 create。多 Agent 创建自动选择 Beta 路由；后续 retrieve/cancel/delete/input_items/compact/input_tokens 同时传 query:{beta:true}，保留原来的 Beta 协议。' },
  agents: { description: '托管 Codex 会话、云端沙箱、浏览器、MCP、Skills、多 Agent、产物、事件、预热环境、定时任务。',
    example: { agent: { model: 'gpt-6.1-sol', instructions: '完成任务，将交付文件放在 /workspace/outputs。' }, environment: { type: 'openai_hosted' }, input: '用户的任务' },
    continuation: '保存 session id；读取会话、items、turns 和 required_actions。agent.session.idle 不等于任务成功。续写、取消、审批和工具结果通过 events 发送。不要重建会话重做已提交的工作。产物通过 artifacts/content 下载。' },
  images: { description: 'GPT Image 2.6 生图、编辑、多参考图、蒙版、markup、复杂度、SVG、GIF。文件字段用 {$file:工作区路径}。',
    example: { model: 'gpt-image-2.6-flare', prompt: '用户要求的图像', output_format: 'png', n: 1 } },
  audio: { description: '录音文件转写、语音合成、自定义声音及授权录音。实时通话/翻译/字幕从应用语音入口开始。合成语音必须向听众说明是 AI 生成。',
    example: { model: 'gpt-transcribe', file: { $file: '/workspace/recording.wav' } } },
  vector_stores: { description: '知识库创建、文件挂载、索引状态、语义检索、批量导入和清理。索引 completed 后才能用于 file_search。',
    example: { name: '我的资料', file_ids: ['file_id'], expires_after: { anchor: 'last_active_at', days: 7 } } },
  files: { description: '上传/读取/下载/删除云端文件。上传后仍按用途和保留策略计费；删除需确认。', example: { purpose: 'user_data', file: { $file: '/workspace/report.pdf' } } },
  uploads: { description: '分片上传：create → parts → complete，或 cancel。每个分片用 data:{$file:路径}；不要重复已成功的分片。' },
  skills: { description: '上传技能 zip、查看版本、下载和删除；Responses 挂载 skill_reference，Agents 从沙箱目录加载。', example: { files: [{ $file: '/workspace/my-skill.zip' }] } },
  batches: { description: '异步批处理：上传 JSONL（purpose=batch），创建任务，查询/取消，下载 output_file_id 和 error_file_id。', example: { input_file_id: 'file_id', endpoint: '/v1/responses', completion_window: '24h' } },
  embeddings: { description: '向量编码，可用于相似度检索、聚类和排序；大向量结果保存为工作区 JSON。', example: { model: 'text-embedding-3-small', input: ['待编码文本'], encoding_format: 'float' } },
  moderations: { description: '文本/图片审核，返回类别和分数；不是音频审核接口。', example: { model: 'omni-moderation-latest', input: '待检查文本' } },
  content_provenance_checks: { description: '核验图片/音频中的 OpenAI C2PA/SynthID 信号；未检出不代表真人创作。', example: { file: { $file: '/workspace/image.png' } } },
  conversations: { description: 'Responses 云端对话和消息的创建、续写、查看和删除。DSH 本地聊天记录仍由 DSH 管理。' },
  containers: { description: 'Code Interpreter / Hosted Shell 容器与文件管理；下载产物，结束后按用户要求清理。' },
  models: { description: '查询账号实际可用模型及 shutdown_date；列出不等于支持所有 API。删除只用于用户明确要求删除的微调模型。' },
  chat: { description: 'Chat Completions 兼容模式及音频输入输出；原生工具优先使用 Responses。' },
  completions: { description: '旧式文本补全兼容接口，仅用于账号仍可用的模型。' },
  evals: { description: '只读迁移入口；2026-10-31 起不可新建评测，2026-11-30 关闭。' },
  fine_tuning: { description: '仅现有合资格账号的训练、检查点和作业管理；2027-01-06 停止新建。需在设置里开启此兼容能力。' },
  live: { description: '应用实时语音入口：GPT-Live 双向语音、Responses/Decisions 委派、字幕、打断。录音下载和 SIP 管理可查询接口目录。' },
  realtime: { description: '应用实时语音入口：Realtime 对话、实时转写和实时翻译，WebRTC 音轨和事件通道。' },
  vaults: { description: '托管 Agent 的 Vault 和 MCP 凭据。敏感字段使用 {$credential:设置中已允许的凭据名}，不要把密钥写进工具参数。修改需要审批；返回值会隐藏凭据。' },
  webhooks: { description: '管理回调地址和订阅事件，需要自己可公开访问的 HTTPS 接收服务；手机不充当公网回调服务器。签名密钥不回传聊天，接收端必须独立验证签名。' },
  safety: { description: '按 ID 查询项目安全告警和组织执法通知，需要 api.safety.alerts.read 或 api.safety.read 权限；仅查看，不改变或绕过执行结果。' },
};

export function describe(family, operation) {
  if (operation) {
    const row = operations.get(operation);
    if (!row) throw new Error('OPENAI_UNKNOWN_OPERATION');
    return { ...row, workflow: workflows[row.family] };
  }
  if (family && !workflows[family]) throw new Error('OPENAI_UNKNOWN_FAMILY');
  return family ? { checkedAt, workflow: workflows[family], operations: [...operations.values()].filter(r => r.family === family) }
    : { checkedAt, families: Object.entries(workflows).map(([id, value]) => ({ id, ...value })) };
}

export function admitted(operation, { native = false, training = false, now = new Date() } = {}) {
  const row = operations.get(operation);
  if (!row || row.nativeOnly && !native) throw new Error('OPENAI_OPERATION_UNAVAILABLE');
  const cutoff = /until_(\d{4}-\d\d-\d\d)/.exec(row.status)?.[1];
  if (cutoff && now.toISOString().slice(0, 10) >= cutoff) throw new Error('OPENAI_ENDPOINT_RETIRED');
  if (row.family === 'fine_tuning' && !training) throw new Error('OPENAI_TRAINING_NOT_ENABLED');
  return row;
}
