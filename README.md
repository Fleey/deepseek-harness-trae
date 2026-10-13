# dsh-trae2api

一个 DeepSeek Harness（dsh）插件：在 Desktop / Web / CLI 里直接用 **Trae 企业版的模型**。
**只需要填一个 Trae 个人访问令牌（PAT），其它什么都不用配。**

v0.3 起插件自己直连 Trae 的 `llm_raw_chat` 接口（和 trae2api 的 direct 模式同一套协议），
**不再需要 trae2api 进程、不需要 Python、不需要 traecli**。

## 它做了什么

- 用你填的 PAT 向 `https://api.enterprise.trae.cn/cloudide/api/v3/trae/oauth/ExchangeToken`
  换一个 Cloud-IDE JWT（和 `traecli login --with-trae-pat` 同一套流程），快过期时自动再换。
- 注册一个叫 **Trae** 的模型来源，直接走 `/api/ide/v2/llm_raw_chat`：流式正文、流式 thinking、
  function calling、token 用量都支持。
- **模型、上下文长度、思考档位全部内置写死**，数据来自两处合并（和 trae2api 的
  `_apply_ide_capabilities` 同一套规则）：
  - 模型列表、`config_name`、后端 key（`__dev` / `__max`）、思考档位 → traecli 0.206.1 的
    `models_cache.json`。
  - **上下文窗口、哪些模型有 Max、思考档位** → 客户端自己的能力表
    （globalStorage 里的 `AI.agent.model.model_list_map`），取自 **TRAE SOLO CN**（31 条），
    也就是 TraeWork CN 实际在用的那份。
  - **16 个模型直接按 1M 上下文（Max）提供**，不再额外列一个小窗口的版本；剩下 8 个用各自的
    标准窗口（Doubao-Seed-2.1-Turbo 256K、Doubao 系 184K、其余 200K）。
  - **思考档位**在对话框模型菜单里选，用客户端自己的词表 `light / high / extra_high`
    （就是界面上的 轻 / 高 / 极高）；只有目录描述、能力表没覆盖的几个模型沿用 `low/high/xhigh`。

  > ⚠️ 注意 trae2api 的 `_IDE_STATE_DEFAULTS` **找不到**这张表：它只看 `Trae CN` / `Trae`
  > 两个旧客户端。那份 `Trae CN` 缓存是过期的——仍列着目录已删的 `glm-5.1`/`glm-5`，没有
  > DeepSeek-V4.1-Flash，窗口报 116K/112K，还把明明有 Max 的模型标成 `max_mode: false`。
  > 以后刷新这张表，请读 **TRAE SOLO CN** 那个库。

- 内置了 trae2api 里那几道兜底：工具调用历史修复（避免 `4027`）、把模型写成文本的
  `<invoke>` 工具调用捞回来、重复塌缩截断、空回合重试、上游错误码翻译。

## 安装到 Desktop

1. 打开一次 DeepSeek Harness Desktop（初始化 `desktop` profile），然后**完全退出**。
2. 终端里（`dsh` 命令可在 Desktop 菜单「管理 dsh 命令…」注册）：

   ```sh
   dsh plugin --profile desktop add /Users/leeyf/Desktop/trae/dsh-plugin
   ```

   也可以在侧栏 **插件 → 添加插件** 里填这个目录的绝对路径。

3. 重新打开 Desktop，去 **设置 → 模型 → Trae**，把 PAT 填进去、保存。
   卡片底部的 **连接状态** 会显示是否连上、有哪些模型。

然后在对话框右下角的模型菜单里选 **Trae** 分组下的模型，思考档位在同一个菜单里切换。

卸载：`dsh plugin --profile desktop remove dsh-trae2api`。

### 用 tgz 安装（发给别人）

`dsh-trae2api-0.3.0.tgz` 是预构建好的包，不需要构建权限：

```sh
dsh plugin --profile desktop add ./dsh-trae2api-0.3.0.tgz
```

装完同样去 **设置 → 模型 → Trae** 填 PAT。tgz 方式下插件自带全部代码，和项目目录无关。

## PAT 从哪来

在 Trae 企业版控制台生成个人访问令牌（Personal Access Token）。它只保存在 dsh 的凭据库
（`~/.dsh/.credentials.yaml`，凭据名默认 `TRAE_PAT`），**不会写进任何配置文件**，保存后即时生效。

> 如果你手上已经有一个现成的 Cloud-IDE JWT（例如 `~/.trae/cli/auth.json` 里的 `access_token`），
> 也可以直接填进 PAT 框——插件识别出是 JWT 就原样使用，过期后需要你自己更新。

## 配置项

界面里只有 PAT 一个字段。其余都是写死的默认值，只有在 Trae 以后改了接口、而插件还没更新时，
才需要在 profile 的 `cordis.patch.yml` 里覆盖 `id: trae2api` 这一行：

| 字段 | 默认 | 说明 |
|---|---|---|
| `patEnv` | `TRAE_PAT` | PAT 在凭据库里的名字 |
| `host` | `https://api.enterprise.trae.cn` | Trae 接口地址 |
| `clientId` | `app_EMoamEEZ73f0CkXaXp7hrann` | PAT 兑换用的 OAuth client id（traecli 的） |
| `appId` / `ideVersionCode` / `clientVersion` | 20260908 那一代 | 身份头，和内置模型目录的后缀（`__dev`）配对 |
| `readTimeoutMs` | `300000` | 上游两次数据之间的最长间隔 |
| `emptyRetries` | `1` | 空回合/瞬时故障的额外重试次数 |
| `loopGuardChars` | `600` | 重复塌缩截断的触发长度；0 关闭 |

> ⚠️ 模型名后缀（`__dev`）和 `ideVersionCode`（`20260908`）是一对，必须同代。Trae 升级后若
> 大量模型报 `4023` / `4001`，说明内置目录和身份头过时了，需要更新插件（或临时改这几个字段）。

## 已知限制

- **图片暂不透传**：所有模型按纯文本声明，消息里的图片会替换成一行说明文字。
- 这是 Trae 未公开的内部接口，后端改协议插件就会断——和 trae2api 的 direct 模式同样的前提。
- **Max 的实际效果未经证实**：trae2api 实测这条私有接口对 `context_window_size` 和 `__max` key
  没有可观测差异（两者 `extra_info.model` 相同）。路由是真的（15 个模型的 `4023` 就是靠它修好的），
  但「真能吃下 1M」没被实测过——这 16 个模型 dsh 会按 1M 规划上下文，万一后端不认，很长的会话
  可能在上游被截断。真遇到了就把 `src/trae/catalog.ts` 里那个模型的 `max` 去掉、重新构建。

## 开发

```sh
npm install        # 仅用于类型检查 / 重新构建
npm run typecheck
npm run build      # 产出 lib/index.js（宿主端）与 lib/client.js（浏览器端，无需编译）
npm run build:test # 产出 lib/testing.mjs，供单元测试导入内部纯函数
npm test           # 目录、消息转换、SSE 解码、重复检测、文本工具调用、PAT/JWT 解析等
```

源码：
- `src/index.ts` —— 宿主端：注册模型来源和 Models 页的 Trae 行。
- `src/adapter.ts` —— dsh `LlmAdapter`，组装 llm_raw_chat 请求、解流、重组工具调用、兜底。
- `src/trae/auth.ts` —— PAT → Cloud-IDE JWT 兑换与缓存。
- `src/trae/catalog.ts` —— 写死的 24 个模型（key / 上下文 / 思考档位），其中 16 个默认走 Max。
- `src/trae/wire.ts` —— 消息转换、SSE、错误分类、重复检测、文本工具调用嗅探。
- `client/client.js` —— 浏览器端：Models 页和插件页里的 PAT 卡片。

已在 `@deepseek-ai/dsh@0.2.0-rc.2` 的 Web 界面里验证：Trae 卡片只有 PAT 一个字段，未填时
连接状态显示明确提示。15 项单元测试覆盖协议转换、各项兜底，以及**出货 bundle 里每个模型的上下文窗口和思考档位**。真实的 PAT 兑换与模型调用需要能访问
`api.enterprise.trae.cn` 的环境，请在你自己的机器上用真实 PAT 验证。
