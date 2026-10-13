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
选中 Trae 模型时，模型选择器旁边还会出现一个剩余额度小徽标（详见下文「额度显示」）。

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
| `consoleEmailEnv` | `TRAE_CONSOLE_EMAIL` | 控制台邮箱在凭据库里的引用名（卡片写这里） |
| `consoleEmail` | 空 | 控制台邮箱的配置兜底（凭据库里没有时才用） |
| `consolePasswordEnv` | `TRAE_CONSOLE_PASSWORD` | 控制台密码在凭据库里的引用名 |
| `consoleHost` | `https://console.enterprise.trae.cn` | 企业控制台地址 |
| `readTimeoutMs` | `300000` | 上游两次数据之间的最长间隔 |
| `emptyRetries` | `1` | 空回合/瞬时故障的额外重试次数 |
| `loopGuardChars` | `600` | 重复塌缩截断的触发长度；0 关闭 |

> ⚠️ 模型名后缀（`__dev`）和 `ideVersionCode`（`20260908`）是一对，必须同代。Trae 升级后若
> 大量模型报 `4023` / `4001`，说明内置目录和身份头过时了，需要更新插件（或临时改这几个字段）。

## 额度显示

插件会向 Trae 查询剩余额度，显示在两处：

- **设置 → 模型 → Trae 卡片**里有一块「剩余额度」：显示每个额度包的已用/剩余/到期，
  总量、美元计费标记，以及一个「刷新」按钮。
- **对话框右下角**（模型选择器旁边）有一个小徽标，选中的是 Trae 模型时显示剩余百分比，
  点击即刷新；其它来源的模型选中时不显示。

实现方式：插件在宿主端通过登录态隔离开的 `/api/dsh-trae2api/quota` 路由供 UI 查询，
带一分钟缓存，`?refresh` 强制刷新。后端流程是先向企业 API 的
`/cloudide/api/v3/trae/CheckLogin` 问 `GetAIPayHost:true` 拿到真正的支付网关地址，
再查 `v1`（企业，`basic_usage_limit`）→ `v2`（个人，`credits_limit`）两条
`/pay/ide_user_ent_usage` 路径，哪条先通用哪条，两边字段都兼容。`limit: -1` 按不限量处理；
额度包 `basic_usage_limit: 0`（免费档）显示为「当前账号没有额度包」。

空额度包列表不再当成结论：某个地址返回 0 个额度包时会继续问剩下的地址，只有全都没有额度包
才显示「当前账号没有额度包」，并附上回答这句话的 `host + path`。

### 企业版（ToB）席位：走控制台账号

用企业版 PAT 实测过（2026-10-13）：**IDE 那套额度接口是 CN 个人版的，拿不到企业席位的额度。**

- `CheckLogin` 不给 `AIPayHost`（`Host: ""`），所以一定走兜底 `api.trae.cn`；
- `api.enterprise.trae.cn` 上两条路径都是 openresty 的裸 404，网关层就没这条路由；
- `api.trae.cn` 两条都 200，但只返回这个 user_id 的**个人免费档**：`product_type: 0`、
  `display_desc: "免费"`、`entitlement_id: "free_utc…"`，所有数字额度字段都是 0
  （`v2` 连数字字段都不返回，只剩 `enable_solo_*` 布尔开关）。

席位的真实用量记在企业租户上（JWT 里的 `tob_tenant_id`、`tenant_id: "tob_online"`），
只有**企业控制台**的接口给得出来（`src/trae/tob.ts`）：

| 接口 | 给什么 |
|---|---|
| `POST /trae/gtm/tob/api/v1/config/get_personal_quota` | `user_model_quota.seat_pool_currency_quota`（席位额度）、`paygo_currency_quota`（超额/按量） |
| `POST /trae/gtm/tob/api/v1/config/get_user_model_usage` | `user_usage_list[].in_seat_detail.chat_usage_details[]`：每个模型的 `total_token_usage` 与 `total_cost_currency`；`model_usage_detail_list[]` 是按量那侧 |

`seat_total_cost_currency` / `extra_total_cost_currency` 实测恒为 `null`，所以已用量是把
每个模型的 `total_cost_currency` 相加得出的。

**认证只有一条路**：这两个接口只认控制台的会话 cookie `X-Cloudide-Tob-Session`。Cloud-IDE JWT
一律回 `30011 请先登录`，`account/check_token` 换不到会话，在控制台域名上做 `ExchangeToken`
也不 `Set-Cookie`。所以插件用控制台自己的密码登录（`POST /trae/gtm/tob/api/v1/account/login`，
`{Email, Password}`）拿会话，会话过期自动重登一次。**SSO 登录的租户用不了这条路。**

界面上因此分两种账号：

- **JWT 带企业租户**（`tob_tenant_id`）→ Trae 卡片多出「企业控制台账号」一栏（邮箱 + 密码）。
  邮箱和密码都写进 dsh 凭据库（默认引用名 `TRAE_CONSOLE_EMAIL` / `TRAE_CONSOLE_PASSWORD`），
  配置文件一个字都不碰——保存这对账号因此不依赖配置可写；`consoleEmail` 配置项只作兜底。
  凭据写失败时，卡片直接把宿主返回的原因显示在字段下面，而不是只说「保存失败」。填好后额度块显示「席位额度 / 超额（按量）」两个包、总剩余百分比，外加一个可展开的
  **按模型用量**（花费 + token 数）。没填时显示「企业版席位：填下面的控制台账号才能看到额度」。
- **个人版账号** → 完全走原来的 `ide_user_ent_usage`，不显示控制台登录栏。

要重新验证或找新接口：

```sh
TRAE_PAT=… TRAE_CONSOLE_EMAIL=… TRAE_CONSOLE_PASSWORD=… python3 -I tools/probe_quota.py
```

（仓库根目录；把 IDE 两条路径在各个地址、两套请求头下的原始响应，以及控制台的两条接口全打出来。）

## 已知限制

- **图片仅限多模态模型与 user 消息**：图片以 `data:` URI 内联发给能力表标记
  `multimodal: true` 的模型（24 个里 18 个，GLM-5.3/GLM-5.2/DeepSeek 全系/MiniMax-M2.7
  除外）；纯文本模型与 tool 结果里的图片仍是占位文本（上游接口只在 user 消息接受
  `image_url`，发给纯文本模型会被 `1210` 拒绝还伪装成限流）。读取失败的单张图片降级为
  占位文本而不是让整轮失败。图片按每边 1024px / 2MiB 预算由附件服务缩放。
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
- `src/trae/quota.ts` —— 额度查询：CheckLogin 发现支付网关、v1/v2 兜底、宽容解析、企业席位判定。
- `src/trae/tob.ts` —— 企业版额度：控制台密码登录 + 个人配额/按模型用量两条接口。
- `client/client.js` —— 浏览器端：Models 页和插件页里的 PAT 卡片、额度块、输入框额度徽标。

已在 `@deepseek-ai/dsh@0.2.0-rc.2` 的 Web 界面里验证：Trae 卡片只有 PAT 一个字段，未填时
连接状态显示明确提示。24 项单元测试覆盖协议转换、各项兜底、额度解析与路由注册，以及**出货
bundle 里每个模型的上下文窗口和思考档位**。真实 PAT 兑换、模型调用与额度查询已在
`api.enterprise.trae.cn` 环境用真实 PAT 验证通过。
