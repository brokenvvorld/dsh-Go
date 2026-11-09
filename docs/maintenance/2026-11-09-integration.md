# 2026-11-09：上游整合与 OpenAI 协议核对

## 起点与候选

- 目标 main：`fda8a47e3c9ba203559fabec706807e70ec41ea7`。
- 继续已有候选：`maintenance/incomplete-20261107-openai`，起点 `5c87b3d80be7496d21db2a7262f047678311ac4a`。
- 上游 main：`d15858a210381fa769ae6c89669f93c83dc35e45`。
- 共同祖先：`cd5d32197a3e5674c7e49a6d0330a0f3188e04b6`。待合入 535 个提交，涉及 1,033 个文件。保留两边父提交与上游提交信息。
- 重新 clone、fetch，并读取双方最新 AGENTS、贡献契约及架构说明。旧 scratch 不作为本轮验证结果。

## 修改前的统一核对

已获取官方 [Docs 总目录](https://developers.openai.com/api/docs)、[API Reference](https://developers.openai.com/api/reference)、完整指南、Changelog、Deprecations，以及 Node SDK v7.53.0 源码。可复查的来源摘要和 SDK 路由清单见 [baseline](openai-platform-baseline.json)。全量指南导出 274 个文档段；Reference 导出有占位页，涉及修改的 Beta Responses 另取方法级完整 Markdown，不能把占位页当成参数核验。

| 类别 | 当前实现与本轮处置 |
| --- | --- |
| Responses / Beta Responses | 普通请求、原生工具、结构化结果、reasoning、background、缓存参数透传。发现 Multi-agent 创建缺少 `?beta=true`，恢复操作也未保留 Beta header；本轮修复创建、查询、取消、删除及输入条目路由。其他 Responses 操作可通过 `query.beta: true` 选择同一协议。 |
| Decisions | 官方仍限定 `gpt-6-luna`、1–400 个问题。文本、图片、JSON、工具历史、问题 instructions 数组、predicate/choice/score 由现有实现支持；不执行 Decisions 返回结果隐含的动作。 |
| Agents | 原始 JSON 保留 tools 全量替换、review、compaction.async、experimental.time_awareness、prompt_cache_options。继续候选已有 session/environment failed 终止修复；error 与 idle 不截断后续生命周期。维持 `agents=v1`。 |
| Live / Realtime | 保留 WebRTC、转写、翻译、Decisions/Responses 委派、SIP 管理与录音；SIP 外呼需要供应商配置。应用仍只采集音频。WebSocket/fork/sideband 不是现有原生入口，不宣称已实现。 |
| 图片 / 音频 | GPT Image 2.6、complexity、markup、SVG/GIF 通过原始参数、multipart 与产物保存路径传递；新增模型名称不等于账号可用。文件转写、声音授权与删除仍保留。 |
| Files / Uploads / Skills / Containers / Vector Stores | 工作区路径与权限检查、文件内容、multipart、分片/索引状态和取消路径保留。SDK Vector Stores search 写作 GET，而实时官方指南/Reference 为 POST；保持 POST，不按 SDK 覆盖。 |
| Conversations / Batches / Embeddings / Moderations / Provenance | 保留 CRUD、异步状态查询和输出文件。无自动重试收费 POST。Provenance 未检出不代表真人创作。 |
| Vault / Webhook / Safety | 主机凭据引用与返回值打码保留；Webhook 接收端仍需独立公网服务。Safety 需要对应读取权限，不自动申请管理员权限。 |
| 模型与账号 | 任意模型 ID 保留。GPT-6-Cyber 与 Rosalind 有专门访问条件，不作为普通账号的保证能力。`shutdown_date` 由 Models 原始响应保留。 |
| 停用与迁移 | Assistants、Sora、DALL·E、Realtime Beta 已排除；Evals 10/31 只读、11/30 关闭；Prompts 11/30 关闭，应用没有独立 Prompts 入口；旧音频/图片和 Fine-tuning 截止沿用实时公告。gpt-5.5-cyber-preview 的移除日为 2027-02-01。 |
| 管理、身份与区域 | SDK 组织/项目/组/角色/服务账号、证书、WIF、外部密钥、网络、配额与费用路由已纳入比对，但不暴露为聊天 Key 的组织管理工具。mTLS/X.509 需要主机证书与组织配置；区域端点需要合资格项目。扩展仍固定官方默认端点，未实现企业身份/区域选择设置。 |
| 其他产品与传输 | ChatKit、Agent Builder、Terraform、Actions、SDK 本地执行器与云供应商集成不替换本应用 Flutter/DSH 执行层。HTTP/SSE 与 WebRTC 是当前实现；不能以原始 JSON 透传声称支持所有传输和本地工具执行器。 |

路由清单比对发现 187 项 SDK 路由与现有目录相符、199 项需要另行分类（主要是管理、停用接口和 Beta Responses 的查询选择器）。这不是 386 项实账号调用通过；Decisions 仍以官方文档为准。

## 整合与有证据的问题

1. 七处冲突逐项解决。媒体同时保留同源密钥复用和官方 OpenAI Key 隔离；打包同时保留 `bridge_shared_rows()`、`with_openai` 和本分支媒体包；pins 按三方递归合并，随后在全新锁定 DSH 上验证全部补丁哈希。
2. 本地 HTTP 回归证明 Multi-agent 请求缺少查询参数（修复前 `null !== 'true'`）；修复后验证完整 URL、Beta header、后续恢复/取消以及普通 Responses 不受影响。
3. 上游伙伴小屋在无 Host 时默认走手机直连 DeepSeek。只配置 OpenAI/自定义渠道会被要求再填 DeepSeek Key。候选改为这些配置使用当前 Host 完整模式，并隐藏不能使用的轻量选择；中英说明同步。DeepSeek 原有轻量模式保留。
4. 另复现租约清理失败后没有再次安排清理、永久占用通话名额的问题（修复前 `0 !== 1`）。现仅对失败的挂断安排下次清理，不重试创建通话；模拟租约、503、恢复成功和新通话重新可用均通过。
5. 保留旧候选的关闭扩展后通话清理、挂断 503 错误与句柄保留、Agents 失败状态处理。
6. main 最近 CI、Android APK、测试包发布均成功；目标开放 issue 为空。这些不是候选的验证结果。

## 验证状态

当前候选已完成：Flutter analyze 无问题；OpenAI 39 项通过；全量 runtime Node 1,599 通过、1 跳过（该轮早于新增租约回归，新增回归已由 OpenAI 测试单独通过）；运行时 Python 20 通过、1 跳过；补丁 Python 9 通过、1 跳过；tooling Python 74 通过；Dart client 817 通过、31 跳过；真实固定 DSH 插件加载及 2 项入包检查通过。Flutter 功能/截图与 Android 构建待完成，因此候选不能进入 main。跳过项不计为通过。没有使用真实 OpenAI Key，也没有真实账号、Android 真机或真实电话验证。涉及上游 Android 运行时升级与手机操控的真机范围不能用桌面测试替代。

## 后续检查范围

本轮除了 OpenAI 路径，还运行全部运行时桥接/补丁测试并检查媒体密钥与伙伴小屋模式。后续轮换检查运行时升级 journal 恢复、后台手机操控槽位与重放、分享导出及诊断数据脱敏。不要重复把历史候选的未完成项写成已交付 main。
