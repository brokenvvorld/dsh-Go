import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  enabled: z.boolean().default(true).volatile().description('启用 OpenAI 扩展能力 / Enable OpenAI capabilities'),
  credentialRef: z.const('OPENAI_API_KEY').default('OPENAI_API_KEY').role('credential-ref'),
  apiKey: z.transform(z.any(), value => {
    if (value !== '') throw new Error('Use the credential service to store the key.');
    return '';
  }, true).default('').role('secret').description('OpenAI API Key（复用聊天凭据 / Shared with chat）'),
  responseModel: z.string().default('gpt-6.1-sol').volatile().description('Responses 默认模型 / Default Responses model'),
  transcriptionModel: z.string().default('gpt-transcribe').volatile().description('文件转写模型 / File transcription model'),
  liveModel: z.string().default('gpt-live-1').volatile().description('GPT-Live 模型 / GPT-Live model'),
  realtimeModel: z.string().default('gpt-realtime-2.1-mini').volatile().description('Realtime 模型 / Realtime model'),
  voice: z.string().default('marin').volatile().description('声音 / Voice'),
  translationLanguage: z.string().default('zh').volatile().description('翻译目标语言 / Translation target language'),
  liveDecisionQuestion: z.string().default('').volatile().description('实时判断的问题 / Condition to evaluate during live voice'),
  allowFineTuning: z.boolean().default(false).volatile().description('现有合资格账号的微调兼容入口 / Fine-tuning for eligible existing customers'),
  mcpCredentialRefs: z.array(z.string()).default([]).volatile().description('允许交给 MCP / Vault 的凭据名（不填密钥） / Credential names allowed for MCP and vaults'),
});
