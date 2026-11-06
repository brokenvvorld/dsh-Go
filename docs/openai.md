# 接入 OpenAI API

本分支基于 ccch1mneyyy 的 [DSH Go](https://github.com/ccch1mneyyy/dsh-Go)，沿用其 Flutter 客户端、DSH 引擎和 pi-ai 模型适配器。源码及第三方声明保留原有许可证。这个版本不是 OpenAI、DeepSeek 或 DSH Go 作者发布的官方版本。

## 配置

1. 首次启动选择本机运行，准备运行环境；也可以连接自己管理的远程主机。
2. 点「使用 OpenAI API Key」。已经完成引导的用户可到「模型渠道 → OpenAI API → 连接 OpenAI」。
3. 地址已填 `https://api.openai.com/v1`，协议已选 `Responses`。填入你自己的 API Key。
4. 点「获取模型」并选择支持 Responses 对话的模型，或者「手动添加」模型 ID。模型列表可能包含音频、向量或其他专用模型，列出不代表都能用于聊天。
5. 保存后，在聊天页选择 OpenAI 渠道下的模型。可在「新对话默认模型」中固定选择。

接第三方网关时可自行改地址和协议；请求和密钥会发送给填写的服务方。已有 OpenAI 渠道时，设置页入口打开它的详情，重复添加不会覆盖原配置。DeepSeek 的 API Key 入口仍单独保留。

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

模拟服务通过不等于真实账号或 Android 真机通过。真实 API 额度、模型权限、网络可达性及真机安装运行需要另行验证。源码构建方法见 README；本分支没有发布修改版 APK。若要再发布修改版应用，需按 [ASSETS.md](../ASSETS.md) 更换名称和受限制的品牌、吉祥物素材，并保留来源和许可证。
