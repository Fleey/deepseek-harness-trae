# dsh-trae2api

一个 DeepSeek Harness（dsh）插件：在 Desktop / Web / CLI 里直接用 **Trae 企业版的模型**。
**只需要填一个 Trae 个人访问令牌（PAT），其它什么都不用配。**

v0.3 起插件自己直连 Trae 的 `llm_raw_chat` 接口（和 trae2api 的 direct 模式同一套协议），
**不再需要 trae2api 进程、不需要 Python、不需要 traecli**。

## 插件相关功能界面

当选择trae模式是聊天支持显示trae额度

<img width="1126" height="338" alt="image" src="https://github.com/user-attachments/assets/174f1592-8132-432f-ab31-cfc6d1f3f96c" />

模型配置只需要添加traecli令牌继续使用，配置上企业额度可实时读取企业额度信息，支持tob与toc额度显示（toc无需登录企业账号即可获取额度）

<img width="1598" height="1536" alt="image" src="https://github.com/user-attachments/assets/3d35d44e-dd11-44ce-a370-ec186e44f0fb" />

支持像claude一样弹出建议弹窗

<img width="600" height="135" alt="image" src="https://github.com/user-attachments/assets/bbefde18-3309-40ee-99f0-9bf9b5904592" />


## 它做了什么

- 用你填的 PAT 向 `https://api.enterprise.trae.cn/cloudide/api/v3/trae/oauth/ExchangeToken`
  换一个 Cloud-IDE JWT（和 `traecli login --with-trae-pat` 同一套流程），快过期时自动再换。
- 注册一个叫 **Trae** 的模型来源，直接走 `/api/ide/v2/llm_raw_chat`：流式正文、流式 thinking、
  function calling、token 用量都支持。
- **模型目录是问来的，不是写死的**。Trae 会随时下线模型（2026-10-16 就一次下掉了四个），
  写死的目录过期后那些模型在选择器里还在，一发就是 `4023 the model is unknown`。所以每次
  插件启动（重载插件 = 重新拉一次）按这个顺序取：
  1. **上游** `POST /api/ide/v1/batch_get_detail_param` —— traecli 自己也走这个，请求体就是
     traecli 二进制里内置的那份。它是所有事实的权威：有哪些模型、两个后端 key、两个上下文
     窗口、每个变体的输出上限、Max 是不是真的、能不能吃图、思考档位及默认档。
  2. **traecli 缓存** `~/.trae/cli/models_cache.json` —— 不走网络，但只有 traecli 跑过才会更新；
     它的 `input_modalities` 对每个模型都写 `["text","image"]`（Codex fork 的常量，不是能力），
     所以能不能吃图这一项取插件内置表里的标记。
  3. **插件内置表**（`src/trae/catalog.ts`，20 个模型）—— 兜底，保证断网也有选择器。
     已于 2026-10-16 和上游对齐过。

  拿到的目录里：**14 个模型直接按 1M 上下文（Max）提供**，不再额外列小窗口的版本；剩下 6 个
  用各自的标准窗口（Doubao 系 184K/200K，其余 200K）。**思考档位**在对话框模型菜单里选，
  词表是 `light / high / extra_high`（界面上的 轻 / 高 / 极高）。

  > 想看插件现在用的是哪一份：`GET /api/dsh-trae2api/catalog` 会返回模型列表、来源
  > （`upstream` / `cache` / `builtin`）和取到的时间；加 `?refresh` 当场重新问一次上游。
  > 刷新失败不会清空目录，继续用上一次拿到的那份。

- 内置了 trae2api 里那几道兜底：工具调用历史修复（避免 `4027`）、把模型写成文本的
  `<invoke>` 工具调用捞回来、重复塌缩截断、空回合重试、上游错误码翻译。

  > 「捞回来」只认模型自己发起的那一个：代码块（``` ```）和行内反引号里的、正文中间
  > 后面还有正文的、以及这一轮已经有原生 `tool_calls` 的，一律当文本留在回答里。所以
  > 讲解 XML 工具格式的回答、或模型转述别处读到的这类标记，都不会变成真实调用。
  > `recoverTextToolCalls: false` 可以整个关掉。

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

> **一条会话里换模型或换思考档位，下一轮会开一条新的上游会话。** 上游是按
> `conversation_id` 保存服务端状态（包括 `use_prompt_cache_pool` 那份共享前缀缓存）的，
> 而这份状态绑死在这条会话最初用的模型上：同一个 `conversation_id` 下改
> `model_name` 或 `reasoning_effort`，上游当没改，表现就是「切了模型没反应」。所以插件
> 给每个（会话 × 模型 × 思考档位）各发一个 `conversation_id`
> （`conversationUuid`，`src/trae/wire.ts`）。代价是换挡那一轮没有缓存可用、按完整
> prompt 计费；换回原来的模型和档位，又会回到它自己那条上游会话。换挡时模型选择器旁边
> 会提示一下，宿主侧日志也会记一行。

卸载：`dsh plugin --profile desktop remove dsh-trae2api`。

### 用 tgz 安装（发给别人）

`dsh-trae2api-0.5.4.tgz` 是预构建好的包，不需要构建权限：

```sh
dsh plugin --profile desktop add ./dsh-trae2api-0.5.4.tgz
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
| `appId` / `ideVersionCode` / `clientVersion` | 20260908 那一代 | 身份头，和模型名后缀（`__dev`）配对 |
| `catalogSource` | `auto` | 模型目录来源：`auto` = 上游 → traecli 缓存 → 内置；也可锁成 `upstream` / `cache` / `builtin` |
| `modelsCacheFile` | 空 | traecli 模型缓存路径；空 = `~/.trae/cli/models_cache.json` |
| `consoleEmailEnv` | `TRAE_CONSOLE_EMAIL` | 控制台邮箱在凭据库里的引用名（卡片写这里） |
| `consoleEmail` | 空 | 控制台邮箱的配置兜底（凭据库里没有时才用） |
| `consolePasswordEnv` | `TRAE_CONSOLE_PASSWORD` | 控制台密码在凭据库里的引用名 |
| `consoleHost` | `https://console.enterprise.trae.cn` | 企业控制台地址 |
| `readTimeoutMs` | `300000` | 上游两次数据之间的最长间隔 |
| `emptyRetries` | `1` | 空回合/瞬时故障的额外重试次数 |
| `loopGuardChars` | `600` | 重复塌缩截断的触发长度；0 关闭 |
| `recoverTextToolCalls` | `true` | 把模型写成 `<invoke>` 文本的工具调用恢复成真实调用；`false` 一律当文本留在回答里 |
| `suggestions` | `true` | 回答完后在输入框上方给出下一步选择卡片（点按钮直接发送）；`false` 关闭 |
| `suggestModel` | 空 | 生成建议用的模型；空 = 用刚回答的那个模型 |
| `suggestTimeoutMs` | `20000` | 生成一轮选择卡片的最长等待 |
| `reportCue` | `true` | 把选择卡片的「显示 / 采纳」上报到 Trae 的 Cue 统计（见下文）；`false` 关闭 |
| `cueUserId` | 空 | 覆盖上报用的 Trae user id；空 = 环境变量 `TRAE_USER_ID`，再空 = 自动从 `GetUserInfo` 取 |

> ⚠️ 模型名后缀（`__dev`）和 `ideVersionCode`（`20260908`）是一对，必须同代。Trae 升级后若
> 大量模型报 `4023` / `4001`，说明身份头过时了，需要更新插件（或临时改这几个字段）。
> 单个模型报 `4023` 基本只有一种情况：目录没刷新到。重载一次插件，或
> `GET /api/dsh-trae2api/catalog?refresh`；`catalogSource: builtin` 锁死在内置表时也会这样，
> 那就换回 `auto`。2026-10-16 被下线的是 Qwen3.7-Plus、GLM-5V-Turbo、Kimi-K2.7-Code、
> DeepSeek-V4-Pro（`DeepSeek-V4-Pro 正式版` 还在），上游把它们标成 `is_invisible_to_user`。

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

（把 IDE 两条路径在各个地址、两套请求头下的原始响应，以及控制台的两条接口全打出来。）

模型目录那两条接口同样有个探针，拿 `~/.trae/cli/auth.json` 里的会话直接问：

```sh
python3 -I tools/probe_catalog.py
```

## 下一步选择卡片

Trae 模型回答完一轮后，输入框上方（和 todo、排队消息同一个位置）会出现**下一步选择卡片**，
样子类似 Claude 回合结束时的那个选择框：

- **一件事一张卡片**：回答里报了几个问题、提了几件可以做的事（比如「安装路径写错了」和
  「缺一段配置说明」），就出几张卡片，最多 3 张，卡片顶上标「下一步 · 1/2」。同一件事的几种做法才放在
  同一张卡片里；模型被要求不出「两个都改」「接下来做什么」这种把几件事捆在一起的卡片或按钮。
- 每张卡片是一个问题加几个按钮，**问题和按钮都是模型给的**，不固定是「要 / 不要」：可能是
  「用 pino / 用 winston / 用 console 封装」，也可能是「改路径 / 先查可执行名」。每张最多 4 个，
  模型推荐的排第一个（实心按钮）。不会有「暂不 / 跳过」这类按钮——不想做就点 `×`。
- 点按钮：按钮背后那句话（模型以你的口吻写的，鼠标悬停可以看到）**直接作为你的下一条消息发出去**。
- 点 **「其他建议」**（每张卡片最后那个虚线按钮）：卡片里展开一个输入框，写你自己的想法，**回车发送**，
  Shift+回车换行，Esc 收起；中文输入法选字时的回车不会误发。发出去后卡片全部收起。
- 点卡片右上角 `×`：只收起这一张，什么都不发。
- 样式用的是 DSH 自己的设计变量（和它原生提问框同一套底色、圆角、阴影、主按钮色），跟着亮色 / 暗色主题走。
- 在输入框里打字时卡片先让开，清空后再回来；发送新消息 / 模型开始工作时全部清掉，等下一轮回答完再出。
- 模型在收尾前一步刚用 DSH 自带的提问框（`ask_user_question`）问过你的话，这一轮不出卡片——
  它收尾的那段文字通常是在追问同一件事，再出卡片就问了第三遍。提问之后又接着干了别的、最后才收尾的，照常出卡片。

实现方式：宿主端的 adapter 在一轮主循环请求（带工具的那种）以纯文本回答收尾时，用**同一个模型、
最低思考档位、不带工具、独立的上游 session** 发一个很小的补全请求——只喂最近 3 条用户消息和这轮
的最终回答——让它输出一个 JSON 数组：`[{ "question", "choices": [{ "label", "reply" }] }]`。
模型没按 JSON 回答时，第一行文字当成只有一个按钮的卡片；什么都解析不出来就不出卡片。结果按会话存在
内存里，经 `/api/dsh-trae2api/suggestion`（同样走登录态隔离的 Connection 路由）给浏览器端；
浏览器端在会话由运行转为空闲时去取，生成还没完成时最多等 20 秒。标题生成、上下文压缩这类不带工具的
旁路请求不会触发。

> 每轮回答会多花一次很小的请求额度。不想要可以在 `cordis.patch.yml` 里给 `id: trae2api`
> 设 `suggestions: false`，或用 `suggestModel` 指定一个更便宜的模型。
>
> 卡片挂在 DSH 输入框的 `conversation.input.dock` 插槽上，按钮通过输入框自己的
> `inputActions.setDraft` + `submit` 发送，和你手动输入再回车走的是同一条路。

### 计入 Trae 的 Cue 统计（默认开启）

默认无需任何配置：卡片**真的显示出来**时报一条 `code_gen_shown`，**真的点了某个按钮**
时报一条 `code_gen_accept`，走 Trae 补全客户端用的同一个业务上报接口：

```
POST {host}/api/ide/v1/report/clients        (multipart，字段 body = JSON 字符串)
Authorization: Cloud-IDE-JWT <和 llm_raw_chat 同一个 token>
X-App-Id: <appId>
```

- 同一轮卡片的 shown / accept 共用一个 `resp_id`（每轮卡片生成时的 UUID），`accept_content`
  是被点按钮发出去的那句话（用「其他建议」自己写的不算采纳，不上报），`conversation_id`
  是**产生这轮卡片的那次 `llm_raw_chat` 请求用的 `session_id`**（由适配器随回合一起交给
  建议模块）。同一条 DSH 会话换了模型或档位就换了 `conversation_id`，所以这里不能由
  会话 id 自己推。
- 每轮卡片 shown、accept 各最多一次，去重和「显示了多久」（`suggestion_visible_duration`）都在
  宿主端算，浏览器只说「显示了 / 点了第几张卡片的第几个按钮」；过期的 id 一律不报。
- `user_id` 是 IDE 登录态里的账号 id（客户端 `User.idOrDefault`），**JWT 里没有**。插件和 IDE 登录时
  一样调 `POST {consoleHost}/cloudide/api/v3/trae/GetUserInfo`（请求头 `x-cloudide-token`，空 body），
  取 `Data.UserInfo.UserID`，每个 JWT 只问一次。`cueUserId` / `TRAE_USER_ID` 只是覆盖这个 id；
  不要填租户 id（`TenantID`）或 TEA 的 device id / 匿名 uuid。
- 同一个回答里的 `Data.PrivacyMode` 打开时，**什么都不报**（和 IDE 的隐私模式闸门一致），配了 `cueUserId`
  也一样。GetUserInfo 失败时这一条不报，只在日志里记一行。
- `code_gen_shown` 的 payload 只带 `resp_id` / `type` / `conversation_id`，字段是按 accept 的结构推的，
  未对照真实客户端抓包。

不想上报（例如把 tgz 发给别人、对方不希望计入）时，在 profile 的 `cordis.patch.yml` 里关掉：

```yaml
- id: trae2api
  config:
    reportCue: false
```

> 注意：这些是聊天里的「下一步选择」，按 `code_gen_*` 报上去后会和真正的代码补全混在一起计数，
> 企业控制台里的 Cue 用量 / 采纳率会因此变化。

## 已知限制

- **图片仅限多模态模型与 user 消息**：图片以 `data:` URI 内联发给目录标记
  `multimodal: true` 的模型（20 个里 15 个，GLM-5.3/GLM-5.2/DeepSeek 全系/MiniMax-M2.7
  除外）；纯文本模型与 tool 结果里的图片仍是占位文本（上游接口只在 user 消息接受
  `image_url`，发给纯文本模型会被 `1210` 拒绝还伪装成限流）。读取失败的单张图片降级为
  占位文本而不是让整轮失败。图片按每边 1024px / 2MiB 预算由附件服务缩放。
- 这是 Trae 未公开的内部接口，后端改协议插件就会断——和 trae2api 的 direct 模式同样的前提。
- **Max 的实际效果未经证实**：trae2api 实测这条私有接口对 `context_window_size` 和 `__max` key
  没有可观测差异（两者 `extra_info.model` 相同）。路由是真的（15 个模型的 `4023` 就是靠它修好的），
  但「真能吃下 1M」没被实测过——目录里标着 Max 的那 14 个模型 dsh 会按 1M 规划上下文，万一后端
  不认，很长的会话可能在上游被截断。真遇到了把 `catalogSource` 锁成 `builtin`，再改
  `src/trae/catalog.ts` 里那个模型的 `max`。

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
- `src/trae/catalog.ts` —— 目录的数据结构，外加断网兜底用的 20 个模型（其中 14 个走 Max）。
- `src/trae/catalog-source.ts` —— 运行时目录：上游 `batch_get_detail_param` 与 traecli 缓存的
  解析、三级兜底、每次插件启动刷新一次的 `TraeCatalog`。
- `src/trae/wire.ts` —— 消息转换、SSE、错误分类、重复检测、文本工具调用嗅探。
- `src/trae/quota.ts` —— 额度查询：CheckLogin 发现支付网关、v1/v2 兜底、宽容解析、企业席位判定。
- `src/trae/tob.ts` —— 企业版额度：控制台密码登录 + 个人配额/按模型用量两条接口。
- `client/client.js` —— 浏览器端：Models 页和插件页里的 PAT 卡片、额度块、输入框额度徽标。

已在 `@deepseek-ai/dsh@0.2.0-rc.2` 的 Web 界面里验证：Trae 卡片只有 PAT 一个字段，未填时
连接状态显示明确提示。24 项单元测试覆盖协议转换、各项兜底、额度解析与路由注册，以及**出货
bundle 里每个模型的上下文窗口和思考档位**。真实 PAT 兑换、模型调用与额度查询已在
`api.enterprise.trae.cn` 环境用真实 PAT 验证通过。
