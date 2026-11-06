# OpenAI 能力清单与接入边界

核对日期：2026-11-06。[配置方法](openai.md) · [English](openai.en.md)

先对照官方文档总目录、API Reference、停用公告和 OpenAI Node SDK 7.19.0 的资源路由整理清单，再统一接入。SDK 尚未收录的 Decisions 以官方接口文档为准；SDK 仍保留的停用接口不据此认定可用。

当前目录包括 **25 类、190 个 HTTP 操作**。这是适配器接受的操作数量，不是实账号逐接口测试通过数。普通任务通过聊天中的 `openai_catalog`、`openai_call`、`openai_decide` 使用；实时麦克风通过原生页面使用。通用调用保留完整 JSON 参数，由服务端校验模型和账号是否支持。没有为每个 API 单独做一个表单。

## 覆盖范围

| 能力 | 已接入内容 | 入口、条件或限制 |
| --- | --- | --- |
| Decisions | 文本、图片、JSON、对话输入；predicate 条件概率、choice 分类、score 评分；缓存；保留概率、置信度和拒答 | `openai_decide`；`gpt-6-luna`；每次 1–400 个问题 |
| Responses | 文本/图片/文件输入、结构化结果、推理参数、会话续写、后台任务、查询/取消、输入 token 计数、压缩、缓存、SSE | `openai_call`；普通聊天继续使用原有 Responses 适配器 |
| Responses 工具 | Web Search、File Search、Code Interpreter、Image Generation、Hosted Shell/Skills、MCP、Tool Search、程序化工具调用、多 Agent；function/custom/computer/local shell/apply_patch 请求及结果回传 | 云端工具由 OpenAI 执行；本地动作返回 DSH 后使用已有工具和审批，再回传 `call_id`。不自动执行模型返回的任意代码 |
| Agents | 托管 Agent、会话、事件、回合、沙箱、浏览器、Skills、协作 Agent、产物、预热环境/模板、定时任务 | `agents=v1`；保存 session ID，查询、续写、取消、下载产物。`idle` 和子 Agent 完成不代表整个任务成功 |
| GPT-Live | WebRTC 双向语音、字幕、打断、Responses 联网委派、Decisions 条件判断委派；录音下载、SIP 管理 | 设置 → OpenAI 能力 → 实时语音；实时判断先填写条件。SIP/录音管理通过目录 |
| Realtime | WebRTC 语音对话、实时转写、实时语音翻译；通话管理 | 同一语音页；转写模式手动提交一段录音。当前原生页为音频，不含摄像头视频采集 |
| Images | GPT Image 生图/编辑、多参考图、蒙版、markup、复杂度、SVG/GIF；JSON 图片引用及 multipart 上传 | 聊天；图片字节保存到会话工作区。官方图片服务可复用聊天 Key |
| Audio | 文件转写/翻译、语音合成、自定义声音、声音授权录音 | 聊天；聊天麦克风可选 OpenAI 转写，需主机加载语音组件。旧 `/audio/speech` 按公告到期禁用；实时语音使用新模型 |
| Files / Uploads | 文件上传、信息/列表、内容下载、删除；分片创建/上传/完成/取消 | 单次上传和响应限 64 MiB；更大文件需拆分后用 Uploads；文件必须来自当前会话工作区 |
| Vector Stores | 知识库、文件挂载与属性、索引批次、状态、检索、清理 | 等索引完成后再用于 File Search；检索使用 POST |
| Skills | 技能上传、列表/详情、版本、内容下载、删除 | 上传 zip 或文件集合；云端执行仍由对应工具/Agent 承担 |
| Containers | 云端容器及文件创建、查看、下载、删除 | 用于 Code Interpreter / Hosted Shell 产物管理 |
| Conversations | 云端对话和条目创建、读取、续写、删除 | 不替换 DSH 的本地聊天记录 |
| Embeddings | 向量编码和原生参数 | 大结果保存为 JSON 文件 |
| Moderations | 文本/图片审核、类别和分数 | 保留服务端结果 |
| Content Provenance | 图片/音频来源信号核验 | 未检出不等于真人创作 |
| Batches | 创建、列表/查询、取消、下载结果和错误文件 | 上传 JSONL 后提交；异步任务按 ID 跟踪，不自动重复提交 |
| Vaults | Vault 与 MCP 凭据管理 | 敏感值用主机凭据引用；先在设置中允许对应凭据名 |
| Webhooks | 回调地址、订阅事件、测试、签名密钥轮换 | 需要自己的公网 HTTPS 接收服务；签名密钥保存在主机凭据服务，不进入聊天 |
| Safety | 按 ID 查询项目告警和组织执法通知 | 分别需要 `api.safety.alerts.read` / `api.safety.read`；查询不改变处理结果 |
| Models | 列表、详情、微调模型删除 | 列表只说明账号能看到模型，不代表模型支持所有接口 |
| Chat Completions / Completions | 兼容接口、音频输入输出、已有结果管理 | 适用模型决定能力；新任务优先 Responses |
| Fine-tuning | 现有合资格账号的作业、事件、检查点、权限与管理接口 | 默认关闭；设置中启用。2027-01-06 起停止新建 |
| Evals | 既有评测、运行和输出查询 | 2026-10-31 起只读；2026-11-30 起目录拒绝调用 |

## 查过但没有作为可用能力加入的项目

| 项目 | 处理原因 |
| --- | --- |
| Assistants / Threads / Runs | 2026-08-26 已停用；使用 Responses / Conversations / Agents |
| Sora Video | 2026-09-24 已停用；不添加一个注定失败的 OpenAI 视频入口。其他厂商视频服务保留 |
| DALL·E / Images variations | 已停用；使用 GPT Image |
| Realtime beta sessions / transcription_sessions | 使用 GA client secrets 与 calls 流程 |
| Evals 新建和修改 | 已进入只读期，目录不接收这些请求 |
| Organization Admin | 已核查组织/项目/用户/组/角色、服务账号、Admin Keys、证书、审计、用量/费用、配额、组织 Webhooks、网络与身份设置；它们需要独立管理员权限，不使用聊天 Key 执行组织管理 |
| ChatKit / Agent Builder | 是另一套聊天前端和编排产品；本项目已有 Flutter + DSH。托管执行能力通过 Agents / Responses 接入，不再嵌入一套 ChatKit 聊天页 |
| Agents SDK、浏览器驱动、批处理 SDK | 是编程库或本地执行器，不是新的模型 API；本项目保留 DSH 执行层 |
| Responses WebSocket、Live fork/sideband WebSocket | 传输方式没有单独实现；现有入口使用 HTTP/SSE 和 WebRTC，不宣称覆盖所有传输协议 |
| Webhook 接收服务器 | 手机不作为公网 HTTPS 服务器；仅接入官方管理接口。接收端需要单独部署并验证签名 |

## 调用方式

工具先查目录，再按精确 `METHOD /path/{id}` 调用；不会拼接任意服务 URL。比如：

```json
{"operation":"POST /decisions","body":{"model":"gpt-6-luna","input":"这张报销单是否缺少日期？","questions":[{"type":"predicate","name":"missing_date","instructions":"输入是否缺少可辨认的日期？"}]}}
```

```json
{"operation":"POST /files","body":{"purpose":"user_data","file":{"$file":"/workspace/report.pdf"}}}
```

文件引用支持 `{$file: 路径}`、`{$data_url: 路径}`、`{$base64: 路径}`；可指定 `mime` 和 multipart 的 `filename`。路径由 DSH 文件系统解析，并检查会话、沙箱根目录和符号链接。产物用新文件保存，返回可打开的工作区路径。

MCP 的 `authorization` 或 Vault 的敏感字段用 `{"$credential":"MY_MCP_TOKEN"}`。先通过主机凭据管理存入该名称，再把名称加入 OpenAI 设置的允许列表；工具参数中不要直接放密钥。`OPENAI_API_KEY` 不允许用作第三方 MCP 凭据。Webhook 创建/轮换得到的 `signing_secret` 存为 `OPENAI_WEBHOOK_<端点ID>`，只返回凭据名。

长任务优先 `background` 或异步会话；立即保存资源 ID，之后 retrieve / events / cancel。SSE 首次收到资源 ID 时在工作区写检查点；断线或超时会提示检查点路径。取消本地等待不保证取消已经提交的云端任务。HTTP POST 不自动重试，避免重复创建付费任务。

删除、训练、修改 Vault/Webhook、创建或修改云端定时任务会走 DSH 已有审批。MCP、浏览器和本地工具的后续审批也不能用模型自己的判断代替用户授权。

## 凭据、语音与部署

- 官方扩展只向 `https://api.openai.com/v1` 请求，使用当前 Host 的 `OPENAI_API_KEY`；不接受模型提供的请求地址或认证头，不跟随重定向。
- 对话中的第三方渠道仍使用各自配置。第三方图片网关不会自动继承官方聊天密钥。
- 手机只传 SDP 和不透明通话句柄；长期 Key 和临时 Key 留在 Host。麦克风音轨通过 WebRTC 发往 OpenAI；用户点击后才开始。
- 停止、退页、切换 Host、进入后台时释放音轨。Host 为通话设置 90 秒租约，客户端每 25 秒续租；连接未完成会超时关闭。
- 语音信令目前需要 HTTP Host 连接（本机或 SSH 转发等）；仅提供 RPC 的远程中继连接不显示可用的通话按钮。
- 新插件随本分支运行时打包；既有 APK 和旧 Host 不会凭空获得这些代码。远程主机可安装本仓库 `runtime/openai/dsh-go-openai` 包，加入 DSH profile bundles，再重启 Host。它依赖当前固定的 DSH 0.2.2-rc.1 服务协议。

## 来源与验证

主要来源：[文档总目录](https://developers.openai.com/api/docs)、[API Reference](https://developers.openai.com/api/reference)、[更新日志](https://developers.openai.com/api/docs/changelog)、[停用公告](https://developers.openai.com/api/docs/deprecations)、[Decisions](https://developers.openai.com/api/docs/guides/decisions)、[Agents](https://developers.openai.com/api/docs/guides/agents)、[工具](https://developers.openai.com/api/docs/guides/tools)、[GPT-Live](https://developers.openai.com/api/docs/guides/live)、[Realtime](https://developers.openai.com/api/docs/guides/realtime)、[Images](https://developers.openai.com/api/docs/guides/image-generation)、[Webhooks](https://developers.openai.com/api/docs/guides/webhooks)。每个操作的来源、参数摘要和状态还保存在机器可读目录中。

验证分为：真实固定版本 DSH 的插件加载/设置保存，真实适配器连接本地模拟服务，文件与 SSE 协议测试，Flutter 页面/语音生命周期测试，Dart 信令测试，以及静态和生成检查。它们不等于 190 个接口均用真实 OpenAI 账号调用成功；没有真实 API Key，也没有执行 Android 真机语音测试或完整 APK 构建。

## 全部操作

以下表格来自 [operations.json](../runtime/openai/dsh-go-openai/data/operations.json)。`native` 仅供用户主动开启的语音连接流程；`approval` 需要 DSH 审批；到期状态按日期禁止调用。

| 类别 | 操作 | 限制 |
| --- | --- | --- |
| agents | `DELETE /agents/automations/{automation_id}` | approval |
| agents | `DELETE /agents/environments/templates/{environment_template_id}` | approval |
| agents | `DELETE /agents/sessions/{session_id}` | approval |
| agents | `DELETE /agents/sessions/{session_id}/artifacts/{artifact_id}` | approval |
| agents | `DELETE /agents/{agent_id}` | approval |
| agents | `GET /agents` | — |
| agents | `GET /agents/automations` | — |
| agents | `GET /agents/automations/{automation_id}` | — |
| agents | `GET /agents/automations/{automation_id}/invocations` | — |
| agents | `GET /agents/automations/{automation_id}/invocations/{invocation_id}` | — |
| agents | `GET /agents/environments` | — |
| agents | `GET /agents/environments/templates` | — |
| agents | `GET /agents/environments/templates/{environment_template_id}` | — |
| agents | `GET /agents/environments/{environment_id}` | — |
| agents | `GET /agents/environments/{environment_id}/files` | — |
| agents | `GET /agents/sessions` | — |
| agents | `GET /agents/sessions/{session_id}` | — |
| agents | `GET /agents/sessions/{session_id}/artifacts` | — |
| agents | `GET /agents/sessions/{session_id}/artifacts/{artifact_id}` | — |
| agents | `GET /agents/sessions/{session_id}/artifacts/{artifact_id}/content` | — |
| agents | `GET /agents/sessions/{session_id}/events` | — |
| agents | `GET /agents/sessions/{session_id}/items` | — |
| agents | `GET /agents/sessions/{session_id}/subagents` | — |
| agents | `GET /agents/sessions/{session_id}/subagents/{subagent_id}` | — |
| agents | `GET /agents/sessions/{session_id}/subagents/{subagent_id}/items` | — |
| agents | `GET /agents/sessions/{session_id}/subagents/{subagent_id}/turns` | — |
| agents | `GET /agents/sessions/{session_id}/subagents/{subagent_id}/turns/{turn_id}` | — |
| agents | `GET /agents/sessions/{session_id}/subagents/{subagent_id}/turns/{turn_id}/items` | — |
| agents | `GET /agents/sessions/{session_id}/traces` | — |
| agents | `GET /agents/sessions/{session_id}/turns` | — |
| agents | `GET /agents/sessions/{session_id}/turns/{turn_id}` | — |
| agents | `GET /agents/sessions/{session_id}/turns/{turn_id}/items` | — |
| agents | `GET /agents/{agent_id}` | — |
| agents | `POST /agents` | — |
| agents | `POST /agents/automations` | approval |
| agents | `POST /agents/automations/{automation_id}` | approval |
| agents | `POST /agents/automations/{automation_id}/invocations` | approval |
| agents | `POST /agents/automations/{automation_id}/pause` | approval |
| agents | `POST /agents/automations/{automation_id}/resume` | approval |
| agents | `POST /agents/environments` | — |
| agents | `POST /agents/environments/templates` | — |
| agents | `POST /agents/environments/templates/{environment_template_id}` | — |
| agents | `POST /agents/environments/{environment_id}/files` | — |
| agents | `POST /agents/sessions` | — |
| agents | `POST /agents/sessions/{session_id}` | — |
| agents | `POST /agents/sessions/{session_id}/events` | — |
| agents | `POST /agents/{agent_id}` | — |
| audio | `DELETE /audio/voice_consents/{consent_id}` | approval |
| audio | `DELETE /audio/voices/{voice_id}` | approval |
| audio | `GET /audio/voice_consents` | — |
| audio | `GET /audio/voice_consents/{consent_id}` | — |
| audio | `POST /audio/speech` | deprecated_until_2027-01-06 |
| audio | `POST /audio/transcriptions` | — |
| audio | `POST /audio/translations` | deprecated_until_2027-02-26 |
| audio | `POST /audio/voice_consents` | approval |
| audio | `POST /audio/voice_consents/{consent_id}` | approval |
| audio | `POST /audio/voices` | — |
| batches | `GET /batches` | — |
| batches | `GET /batches/{batch_id}` | — |
| batches | `POST /batches` | — |
| batches | `POST /batches/{batch_id}/cancel` | — |
| chat | `DELETE /chat/completions/{completion_id}` | approval |
| chat | `GET /chat/completions` | — |
| chat | `GET /chat/completions/{completion_id}` | — |
| chat | `GET /chat/completions/{completion_id}/messages` | — |
| chat | `POST /chat/completions` | — |
| chat | `POST /chat/completions/{completion_id}` | — |
| completions | `POST /completions` | — |
| containers | `DELETE /containers/{container_id}` | approval |
| containers | `DELETE /containers/{container_id}/files/{file_id}` | approval |
| containers | `GET /containers` | — |
| containers | `GET /containers/{container_id}` | — |
| containers | `GET /containers/{container_id}/files` | — |
| containers | `GET /containers/{container_id}/files/{file_id}` | — |
| containers | `GET /containers/{container_id}/files/{file_id}/content` | — |
| containers | `POST /containers` | — |
| containers | `POST /containers/{container_id}/files` | — |
| content_provenance_checks | `POST /content_provenance_checks` | — |
| conversations | `DELETE /conversations/{conversation_id}` | approval |
| conversations | `DELETE /conversations/{conversation_id}/items/{item_id}` | approval |
| conversations | `GET /conversations/{conversation_id}` | — |
| conversations | `GET /conversations/{conversation_id}/items` | — |
| conversations | `GET /conversations/{conversation_id}/items/{item_id}` | — |
| conversations | `POST /conversations` | — |
| conversations | `POST /conversations/{conversation_id}` | — |
| conversations | `POST /conversations/{conversation_id}/items` | — |
| decisions | `POST /decisions` | — |
| embeddings | `POST /embeddings` | — |
| evals | `GET /evals` | read_only_until_2026-11-30 |
| evals | `GET /evals/{eval_id}` | read_only_until_2026-11-30 |
| evals | `GET /evals/{eval_id}/runs` | read_only_until_2026-11-30 |
| evals | `GET /evals/{eval_id}/runs/{run_id}` | read_only_until_2026-11-30 |
| evals | `GET /evals/{eval_id}/runs/{run_id}/output_items` | read_only_until_2026-11-30 |
| evals | `GET /evals/{eval_id}/runs/{run_id}/output_items/{output_item_id}` | read_only_until_2026-11-30 |
| files | `DELETE /files/{file_id}` | approval |
| files | `GET /files` | — |
| files | `GET /files/{file_id}` | — |
| files | `GET /files/{file_id}/content` | — |
| files | `POST /files` | — |
| fine_tuning | `DELETE /fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions/{permission_id}` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `GET /fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions` | existing_customers_until_2027-01-06 |
| fine_tuning | `GET /fine_tuning/jobs` | existing_customers_until_2027-01-06 |
| fine_tuning | `GET /fine_tuning/jobs/{fine_tuning_job_id}` | existing_customers_until_2027-01-06 |
| fine_tuning | `GET /fine_tuning/jobs/{fine_tuning_job_id}/checkpoints` | existing_customers_until_2027-01-06 |
| fine_tuning | `GET /fine_tuning/jobs/{fine_tuning_job_id}/events` | existing_customers_until_2027-01-06 |
| fine_tuning | `POST /fine_tuning/alpha/graders/run` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `POST /fine_tuning/alpha/graders/validate` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `POST /fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `POST /fine_tuning/jobs` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `POST /fine_tuning/jobs/{fine_tuning_job_id}/cancel` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `POST /fine_tuning/jobs/{fine_tuning_job_id}/pause` | existing_customers_until_2027-01-06, approval |
| fine_tuning | `POST /fine_tuning/jobs/{fine_tuning_job_id}/resume` | existing_customers_until_2027-01-06, approval |
| images | `POST /images/edits` | — |
| images | `POST /images/generations` | — |
| live | `GET /live/sessions/{session_id}/content` | — |
| live | `POST /live/sessions` | native |
| live | `POST /live/sessions/{session_id}/accept` | — |
| live | `POST /live/sessions/{session_id}/fork` | — |
| live | `POST /live/sessions/{session_id}/hangup` | — |
| live | `POST /live/sessions/{session_id}/refer` | — |
| live | `POST /live/sessions/{session_id}/reject` | — |
| models | `DELETE /models/{model}` | approval |
| models | `GET /models` | — |
| models | `GET /models/{model}` | — |
| moderations | `POST /moderations` | — |
| realtime | `POST /realtime/calls` | native |
| realtime | `POST /realtime/calls/{call_id}/accept` | — |
| realtime | `POST /realtime/calls/{call_id}/hangup` | — |
| realtime | `POST /realtime/calls/{call_id}/refer` | — |
| realtime | `POST /realtime/calls/{call_id}/reject` | — |
| realtime | `POST /realtime/client_secrets` | native |
| realtime | `POST /realtime/translations/client_secrets` | native |
| responses | `DELETE /responses/{response_id}` | approval |
| responses | `GET /responses/{response_id}` | — |
| responses | `GET /responses/{response_id}/input_items` | — |
| responses | `POST /responses` | — |
| responses | `POST /responses/compact` | — |
| responses | `POST /responses/input_tokens` | — |
| responses | `POST /responses/{response_id}/cancel` | — |
| safety | `GET /safety/alerts/{id}` | — |
| safety | `GET /safety/cases/{id}` | — |
| skills | `DELETE /skills/{skill_id}` | approval |
| skills | `DELETE /skills/{skill_id}/versions/{version}` | approval |
| skills | `GET /skills` | — |
| skills | `GET /skills/{skill_id}` | — |
| skills | `GET /skills/{skill_id}/content` | — |
| skills | `GET /skills/{skill_id}/versions` | — |
| skills | `GET /skills/{skill_id}/versions/{version}` | — |
| skills | `GET /skills/{skill_id}/versions/{version}/content` | — |
| skills | `POST /skills` | — |
| skills | `POST /skills/{skill_id}` | — |
| skills | `POST /skills/{skill_id}/versions` | — |
| uploads | `POST /uploads` | — |
| uploads | `POST /uploads/{upload_id}/cancel` | — |
| uploads | `POST /uploads/{upload_id}/complete` | — |
| uploads | `POST /uploads/{upload_id}/parts` | — |
| vaults | `DELETE /vaults/{vault_id}` | approval |
| vaults | `DELETE /vaults/{vault_id}/credentials/{credential_id}` | approval |
| vaults | `GET /vaults` | — |
| vaults | `GET /vaults/{vault_id}` | — |
| vaults | `GET /vaults/{vault_id}/credentials` | — |
| vaults | `GET /vaults/{vault_id}/credentials/{credential_id}` | — |
| vaults | `POST /vaults` | approval |
| vaults | `POST /vaults/{vault_id}` | approval |
| vaults | `POST /vaults/{vault_id}/credentials` | approval |
| vaults | `POST /vaults/{vault_id}/credentials/{credential_id}` | approval |
| vector_stores | `DELETE /vector_stores/{vector_store_id}` | approval |
| vector_stores | `DELETE /vector_stores/{vector_store_id}/files/{file_id}` | approval |
| vector_stores | `GET /vector_stores` | — |
| vector_stores | `GET /vector_stores/{vector_store_id}` | — |
| vector_stores | `GET /vector_stores/{vector_store_id}/file_batches/{batch_id}` | — |
| vector_stores | `GET /vector_stores/{vector_store_id}/file_batches/{batch_id}/files` | — |
| vector_stores | `GET /vector_stores/{vector_store_id}/files` | — |
| vector_stores | `GET /vector_stores/{vector_store_id}/files/{file_id}` | — |
| vector_stores | `GET /vector_stores/{vector_store_id}/files/{file_id}/content` | — |
| vector_stores | `POST /vector_stores` | — |
| vector_stores | `POST /vector_stores/{vector_store_id}` | — |
| vector_stores | `POST /vector_stores/{vector_store_id}/file_batches` | — |
| vector_stores | `POST /vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel` | — |
| vector_stores | `POST /vector_stores/{vector_store_id}/files` | — |
| vector_stores | `POST /vector_stores/{vector_store_id}/files/{file_id}` | — |
| vector_stores | `POST /vector_stores/{vector_store_id}/search` | — |
| webhooks | `DELETE /webhook_endpoints/{webhook_endpoint_id}` | approval |
| webhooks | `GET /webhook_endpoints` | — |
| webhooks | `GET /webhook_endpoints/{webhook_endpoint_id}` | — |
| webhooks | `GET /webhook_event_types` | — |
| webhooks | `POST /webhook_endpoints` | approval |
| webhooks | `POST /webhook_endpoints/{webhook_endpoint_id}` | approval |
| webhooks | `POST /webhook_endpoints/{webhook_endpoint_id}/rotate_secret` | approval |
| webhooks | `POST /webhook_endpoints/{webhook_endpoint_id}/test` | approval |
