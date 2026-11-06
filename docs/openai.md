# 接入 OpenAI API

本分支基于 ccch1mneyyy 的 [DSH Go](https://github.com/ccch1mneyyy/dsh-Go)，沿用其 Flutter 客户端、DSH 引擎和 pi-ai 模型适配器。源码及第三方声明保留原有许可证。这个版本不是 OpenAI、DeepSeek 或 DSH Go 作者发布的官方版本。

## 配置

1. 首次启动选择本机运行，准备运行环境；也可以连接自己管理的远程主机。
2. 点「使用 OpenAI API Key」。已经完成引导的用户可到「模型渠道 → OpenAI API → 连接 OpenAI」。
3. 地址已填 `https://api.openai.com/v1`，协议已选 `Responses`。填入你自己的 API Key。
4. 点「获取模型」并选择支持 Responses 对话的模型，或者「手动添加」模型 ID。模型列表可能包含音频、向量或其他专用模型，列出不代表都能用于聊天。
5. 保存后，在聊天页选择 OpenAI 渠道下的模型。可在「新对话默认模型」中固定选择。

接第三方网关时可自行改地址和协议；请求和密钥会发送给填写的服务方。已有 OpenAI 渠道时，设置页入口打开它的详情，重复添加不会覆盖原配置。DeepSeek 的 API Key 入口仍单独保留。

## Skill、插件与账号

Skill 给助手提供说明、工作步骤和随附资源；调用时内容进入对话上下文，不要求使用 DeepSeek 模型。插件则给 DSH 注册可执行工具，聊天模型发起工具调用后，由主机运行代码或请求外部服务。本地文件、命令、手机操控等功能可以继续使用。

图像与视频插件随本分支运行时内置，保留 `dsh-media` 的配置和已有凭据。之前市场里的 0.2.1 包与本分支的 DSH 0.2.2-rc.1 不匹配，不能通过取消版本检查解决；更新应用后使用随包的适配版本。市场详情会直接进入媒体设置，不再重复安装旧包。

OpenAI 图片服务复用主机的 `OPENAI_API_KEY`；聊天模型只负责选择和调用工具，图片由所选 GPT Image 模型生成。视频插件保留可配置的第三方服务，但这些服务需要各自的 Key 并独立计费。OpenAI 官方 Videos API 已于 2026-09-24 停用，只有 OpenAI Key 时不提供可用视频模型。

普通联网搜索通过 OpenAI Responses 的 `web_search` 接入 DSH 原有搜索工具，新运行时默认选择 OpenAI。已有主机如果明确保存过 DeepSeek 搜索配置，可在「联网搜索」中切换。网页读取仍走普通 HTTP。OpenAI 账号状态、模型渠道和用量页不再将 DeepSeek 登录或充值当作使用前提。

## “订阅登录”使用什么额度

「ChatGPT (Codex)」是现有 pi-ai 的 Codex 兼容登录渠道：使用 ChatGPT 账号授权，聊天消耗该账号获准使用的套餐额度，受模型权限和用量限制；它不是 OpenAI Platform API Key，也不会自动支付独立插件的生图、语音、搜索或 Decisions 请求。第三方兼容客户端的实际登录和模型可用性仍由服务端决定。

按 2026-11-06 的官方说明，符合条件的付费 Pro / Business 订阅还可领取独立 API 额度。需要在 ChatGPT 或 Platform 账单页关联自己拥有的 API 组织；领取后使用该组织的项目 Key。登录本应用不会代领，也不会将 ChatGPT 对话额度转换成 API 余额。可领取资格、额度和有效期以账户账单页为准。

官方依据：[登录与 API 计费](https://learn.chatgpt.com/docs/auth?surface=cli)、[订阅附带的 API 额度](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)、[接口停用时间](https://developers.openai.com/api/docs/deprecations)。

## 这次改了什么

- 首次引导以 OpenAI API 为主要入口，模型渠道页增加直接入口。
- 使用 `openai` 渠道 ID 和 `OPENAI_API_KEY` 凭据引用。这样引擎可以继续提供已收录模型的图片输入、思考档位、上下文长度等信息。
- 模型由用户选择，不写死账号未必有权限使用的型号。引擎尚未收录的新模型可手动添加，并在模型设置里填写实际能力。
- 沿用已有的密钥存储、流式回复、工具调用、错误处理和远程主机实现。源码、安装包和测试中不放真实 API Key。
- 本机环境还在安装时可以先填写配置；安装完成后会启动引擎，之后才能获取模型或保存。

## 验证

`runtime/tests/openai-responses.test.mjs` 使用锁文件中的真实 DSH/pi-ai 适配器，连接本机模拟 HTTP 服务，检查模型能力、Responses 请求路径、Bearer 鉴权、思考档位、流式工具调用、工具结果回传、中文输出和 401 错误。测试不访问 OpenAI、不产生模型费用。

```bash
# 在临时目录安装锁定的运行时依赖，DSH_PREFIX 指向该目录。
DSH_PREFIX=/path/to/installed/runtime node --test runtime/tests/openai-responses.test.mjs

cd app
flutter analyze
flutter test test/providers/provider_form_test.dart test/providers/providers_logic_test.dart test/providers/onboarding_provider_test.dart test/account/account_widget_test.dart test/onboarding/parallel_setup_test.dart
```

本次本地验证：上述功能测试连同渠道页面和相关截图测试共 180 项通过；运行时 Responses 测试 3 项通过；Flutter 静态检查、文案生成检查和指南同步检查通过。

模拟服务通过不等于真实账号或 Android 真机通过。真实 API 额度、模型权限、网络可达性及真机安装运行需要另行验证。源码构建方法见 README；自动测试包和正式发布的区别见 [APK 打包说明](android-release.md)。当前可下载产物以本仓库 Actions / Releases 为准。若要再发布修改版应用，需按 [ASSETS.md](../ASSETS.md) 更换名称和受限制的品牌、吉祥物素材，并保留来源和许可证。

## 完整能力扩展

设置页新增「OpenAI 能力」。填写的 Key 与官方聊天共用；默认任务模型、转写模型、实时语音模型、声音和目标语言均可修改。账号权限由 OpenAI 判断。

完整范围见 [能力清单与 190 个操作](openai-capabilities.md)：Decisions、Responses 原生工具、托管 Agents、GPT-Live / Realtime、图像与音频、文件/知识库/Skills、批处理、向量、审核、来源核验、Vault、Webhook 和安全告警查询。聊天助手通过目录和工具调用这些能力；实时麦克风从设置页启动。

Decisions 是实际 `/v1/decisions` 接口，包含条件概率、分类和评分，并保留拒答和置信度。GPT-Live 的「实时判断」可以使用预先填写的条件调用 Decisions；其余分类/评分任务在聊天中提出即可。

插件源码位于 `runtime/openai/dsh-go-openai`，随本分支运行时打包。远程 Host 需安装此包并加入 profile bundles。未升级的 Host 会显示说明；HTTP 以外的中继连接暂不提供实时语音信令。实时语音会把录音发给 OpenAI 并计费，离开应用会关闭通话。

扩展验证命令：

```bash
DSH_PREFIX=/path/to/patched/runtime node --test runtime/tests/openai-capabilities.test.mjs runtime/tests/openai-responses.test.mjs
DSH_PREFIX=/path/to/patched/runtime python3 runtime/tests/openai-host-live.py
python3 -m unittest discover -s runtime/tests -p 'test_*.py'
(cd app && flutter analyze --no-pub && flutter test --no-pub test/openai/capabilities_page_test.dart test/voice/openai_voice_test.dart test/media/media_settings_test.dart test/media/media_settings_page_test.dart)
(cd packages/dsh_client && dart analyze && dart test test/openai_api_test.dart test/dsh_go_api_test.dart)
```

原有 180 项是首次聊天接入的验证记录。扩展的验证范围以以上命令和对应提交的 CI 结果为准；不把接口目录数量当成实账号通过数量。

本次插件与账号适配验证：Flutter 478 项通过，真实账号测试 1 项未启用；媒体 Node 测试 324 项通过、4 项既有测试跳过，OpenAI 扩展与搜索测试 30 项通过。真实 DSH 主机验证了旧插件配置保留、无 Key 不暴露媒体工具、关闭后重启、重新启用和安全模式；图片及后台视频使用本地模拟服务跑通。补丁完整应用和重复应用检查通过。未使用真实 OpenAI 账号，也未做 Android 真机验证。
