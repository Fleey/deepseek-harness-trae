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

     这个接口是**按通道（`function`）回答**的，而模型是否上架是按「配置 × 通道」判的：
     只问一个通道，就看不到只在别的通道上架的模型。默认按 traecli 的原样只问 `chat`
     （**实测企业版只有 chat 上架模型**，见下）；`catalogFunctions` 里多填的通道会**单独发一次
     请求**问，两份取并集：
     - 在所有通道都标了 `is_invisible_to_user` 的，判**退役**，移出目录（原本就是 `4023` 的来源）；
     - 这边藏、那边上架的，**保留并钉到上架它的那个通道**（聊天请求的 `function` 字段按钉的
       来发——拿一个通道没上架的模型去问，回的就是 `4001`）；
     - 名册没提到的，一行不动。
     - 冲突按通道优先级，保留优先通道的那份拼写（`enabledModelIds` 是精确匹配，改名会让已启用
       的模型静默消失）。

     > **2026-10-27 用真实 ToB 会话在 `api.enterprise.trae.cn` 上实测过**
     > （`python3 -I tools/probe_catalog.py`）：`solo_work_remote` / `solo_work_lite` /
     > `solo_coder` / `chat_v3` 四个名字上游都认（各回 `HTTP 200` 和一个同名 group），但
     > **配置数全是 0**，而 `chat` 有 31 个（25 个可见）。也就是说企业席位上没有可并的东西，
     > 多问一个通道只是每次刷新多发一次 POST——所以默认是 `['chat']`。
     >
     > 并集这条路留着：按通道上架的 host 把通道名填进 `catalogFunctions` 即可。额外通道始终走
     > 第二次请求，问不到、被拒、回空都只记一行日志跳过，`chat` 那份目录照常用。
  2. **traecli 缓存** `~/.trae/cli/models_cache.json` —— 不走网络，但只有 traecli 跑过才会更新；
     它的 `input_modalities` 对每个模型都写 `["text","image"]`（Codex fork 的常量，不是能力），
     所以能不能吃图这一项取插件内置表里的标记。
  3. **插件内置表**（`src/trae/catalog.ts`，20 个模型）—— 兜底，保证断网也有选择器。
     已于 2026-10-16 和上游对齐过。

  拿到的目录里：**14 个模型直接按 1M 上下文（Max）提供**，不再额外列小窗口的版本；剩下 6 个
  用各自的标准窗口（Doubao 系 184K/200K，其余 200K）。**思考档位**在对话框模型菜单里选，
  上游目前下发的是 `light / high / extra_high`（界面上的 轻 / 高 / 极高）。

  > 能解析的档位词表是五档（`low|light / medium / high / extra_high|xhigh / max`，Trae 客户端
  > 自己就是这五档，按模型灰度下发）。**词表宽不等于声称宽**：某个模型能选哪几档，仍然只看
  > 上游为它下发的 `options`，2026-10-25 实测上游只给三档，所以这是「先备好」。
  > 请求的档位如果这个模型没有，就**不发**，让上游用它自己的默认——把它就近折到一个便宜档
  > 等于给出用户没要的答案，而且没有任何迹象。

  **本地上下文预算**：`contextBudgetTokens` 给 dsh 规划压缩用的窗口加一个上限（0 = 用模型
  自己的窗口；Max 模型想要默认窗口到 1M 之间的半步就填 `500000`）。它**只改压缩时机**：
  请求体里除了 Max 标记那个 `context_window_size` 之外没有窗口字段，调低预算不会让上游
  按更小的窗口服务、也不会便宜，只是让 dsh 更早压缩，不至于一上来就按整个 1M 的 prompt 发。
  预算真的压到窗口以下时，模型选择器那行会同时写出两个数（`1M 上下文（Max） · 本地预算 500K`）。

  > 想看插件现在用的是哪一份：`GET /api/dsh-trae2api/catalog` 会返回模型列表、来源
  > （`upstream` / `cache` / `builtin`）和取到的时间；加 `?refresh` 当场重新问一次上游。
  > 刷新失败不会清空目录，继续用上一次拿到的那份。

- 内置了 trae2api 里那几道兜底：工具调用历史修复（避免 `4027`）、把模型写成文本的
  `<invoke>` 工具调用捞回来、重复塌缩截断、空回合重试、上游错误码翻译。

  > 另外，**工具 schema 在出口统一归一化成 draft-4**。dsh 的 schemastery 产的是 draft-3 风格
  > ——`required: true` 写在属性**内部**；draft-4 起改成父级的字符串数组。上游是分后端校验的：
  > 智谱系放行，DeepSeek 系按 draft-4 严校验，回 `4027 … properties/X/required: invalid JSON
  > Schema`，而且 `tools` 是**按批校验**，一个属性不合格就整轮带工具的请求全挂。归一化是纯本地
  > 的递归提升（`items` / `anyOf` / `oneOf` / `allOf` / `$defs` 任意嵌套，与已有 `required`
  > 数组去重合并），**幂等**：本来就是 draft-4 的 schema 原样发出。

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

`dsh-trae2api-0.8.1.tgz` 是预构建好的包，不需要构建权限：

```sh
dsh plugin --profile desktop add ./dsh-trae2api-0.8.1.tgz
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
| `catalogFunctions` | `['chat']` | 问上游要目录的通道；多填的通道单独发一次请求，问不到就只用 `chat` 那份。企业版实测只有 `chat` 上架模型，可试的名字：`solo_work_remote` / `solo_work_lite` / `solo_coder` / `chat_v3` |
| `modelsCacheFile` | 空 | traecli 模型缓存路径；空 = `~/.trae/cli/models_cache.json` |
| `contextBudgetTokens` | `0` | 本地上下文预算上限（token）；0 = 用模型自己的窗口。只改压缩时机，不改上游服务的窗口 |
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
| `suggestSubagent` | `true` | 点卡片按钮时把这件事交给子会话（`subagent` 工具）去做，而不是在当前会话里直接动手；卡片下面会写明，也能当场切回当前会话 |
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

它第一段就是**按通道列模型**：每个 `function` 各发一次，打出这个 host 认不认这个名字、
该通道上架了几个配置、哪些可见。想验证 `catalogFunctions` 里那四个未取证的通道名，就看这段
（换一批名字：`TRAE_FUNCTIONS=chat,solo_coder python3 -I tools/probe_catalog.py`）。

## 会话 ID（查看 / 复制）

会话顶上那排标签（对话 / 轨迹 / 上下文 / …）里多一个「**会话 ID**」，三项各占一行、各有自己的复制按钮：

| 行 | 内容 |
| --- | --- |
| 会话 ID | dsh 这边的会话 ID |
| 上游会话 | 这条会话上一轮跑在哪条上游会话里，下面写明用的模型和思考档位 |
| 排查串 | 按 Trae 客户端给客服那套格式拼好的一整行（见下） |

还没发过一轮时，后两行写「这条会话还没发过一轮」，不给空的复制按钮。

**只有屏幕上有 Trae 会话时这个标签才在**。标签行是全局注册表（宿主用 `slots.entries('conversation.view')` 拼这一排，
没有「按会话过滤」这档事，唯一例外是「轨迹」跟着开发者模式走），所以插件改成**按需注册**：输入框旁边挂了一个
什么都不渲染的哨兵（`conversation.input.right` 里的 `trae-session-watch`），它报告当前挂载的每条会话选的是不是
Trae 模型；有 Trae 会话就注册这个标签，最后一条切走就注销，宿主订阅了这个槽，标签行自己跟着变
（标签消失时宿主的 `restoreView` 会退回「对话」）。

> 分屏同时开着一条 Trae 和一条别的会话时，标签对两边都在（全局注册表只能这样）。这时在非 Trae 那条里点开，
> 第一行写明「这条会话现在选的不是 Trae 模型」，会话 ID 那行照常可用。

两个 ID 不是一回事，提 bug、查日志时要的往往是后一个：上游按「会话 × 模型 × 思考档位」分别开
conversation（见 `conversationUuid`），所以上游那条 ID 是从会话 ID 派生出来的，**不等于也猜不出**
会话 ID；换模型或换档位后同一条会话会有多个上游 ID，标签页里显示的是**最近一轮主循环请求真的发出去的那个**。
标题生成、上下文压缩这类旁路请求用自己的临时 ID，不计入。

### 排查串（Trae 客户端自己那套格式）

TRAE SOLO CN 0.1.61 在回答的头部双击会复制一串给客服用的排查信息，外部账号拿到的是这个格式：

```
312308224:a9e9…839c_6ae1a91d…6bff.6ae1a91d…6c02.6ae1a91d…6c00:TraeWork CN.0.1.61.no_sid.no_ppe.T(2026/10/28 15:49:49)
└ userId  └ traceId     └ 会话 ID  └ 消息 ID    └ 被回复消息 ID  └ 应用名     └ 版本  └ Slardar └ PPE └ 本地时间
```

拼接规则（`region` 有值才带前缀，缺字段用 `no_sid` / `no_ppe` 这类占位符；字节内部账号拿到的是 JSON 不是这串）：

```
`${region ? region + '.' : ''}${userId}:${traceId}_${sessionId}.${messageId}.${replyId}:${appName}.${appVersion}.${sid}.${ppe}`
```

串里那三个 24 位十六进制是 MongoDB ObjectId，由 Trae 的聊天服务生成（前 4 字节是时间戳，和末尾 `T(...)` 对得上），
客户端只负责拼。

本插件直连 `llm_raw_chat`——这是聊天服务**下面一层**，根本没有 message id，所以这串按「有什么填什么、
没有的保留格式自己的 `no_*` 占位符」来拼，不编 ID（见 [src/trae/debug.ts](src/trae/debug.ts)）：

| 字段 | 这里填什么 |
| --- | --- |
| `userId` | `GetUserInfo` 的 `UserInfo.UserID`，和 IDE 上报用的是同一个；读不到填 `no_uid` |
| `traceId` | 上游回包里的 trace 头（`x-tt-logid` / `x-tt-trace-id` / `x-trace-id`），没有就用本插件这轮发出去的 `x-request-id`——两者都在上游访问日志里 |
| `sessionId` | 上游会话 ID（`conversationUuid`），这里是 UUID，不是 ObjectId |
| `messageId` / `replyId` | `no_mid`，裸接口没有这两个 |
| `appName` / `appVersion` | 照客户端自己的规则：`isCN ? (platform === 'trae-ide' ? 'TraeCode CN' : 'TraeWork CN') : (platform === 'trae-ide' ? 'TraeCode' : 'TraeWork')`——本插件不是 IDE 端，host 是 `.cn`，所以是 `TraeWork CN`；版本写死 `0.1.61`（读出这套格式的那个 SOLO 版本）。上游实际给这次请求记的身份是 `codex_exec` + traecli 版本，两者不一样，把这行和真实请求对上的是 `traceId` |
| `sid` / `ppe` | `no_sid` / `no_ppe`：没有 Slardar 会话，也没走 PPE |
| `T(...)` | 这一轮的本地时间 |

实现方式：宿主端记住最近 64 条会话各自上一轮的变体、上游 ID 和 trace，经同样走登录态隔离的
`/api/dsh-trae2api/session?session=<会话 ID>` 路由给浏览器端，返回
`{ session, conversation, model, effort, trace, at, debug }`；还没发过一轮的会话 `conversation`、`debug` 都是 `null`。
浏览器端在挂载、换模型／档位、一轮结束和每次点复制时各读一次，不轮询。

标签注册在 `conversation.view`（列表槽、会话作用域）上，`id: 'trae-session'`、`order: 100`（排在宿主自带的几个后面）、
`label` 用 thunk 所以跟着语言走；注册 / 注销由上面那个哨兵驱动。样式用宿主的设计变量，跟着亮色 / 暗色主题走。

> 剪贴板优先用 `navigator.clipboard`，拿不到权限（非安全来源之类）时退回老的选区复制；
> 两条都失败时按钮写「复制失败」，ID 本身就在页面上，可以直接选中复制。

> trace 头是实测过的：2026-10-28 对 api.enterprise.trae.cn 发一轮，`llm_raw_chat` 回的是
> `x-tt-logid: 2026102816265801000315823240915B1`，没有别的 trace 头（`ExchangeToken` 还把它写进了
> `access-control-expose-header`），所以 `traceOf()` 选的就是它；列表里其余几个是同系网关的别的写法，
> 留作兜底。想自己再测一次：`TRAE_PAT=<你的 PAT> node tools/probe_trace.mjs`，它把响应头全打出来并说明
> 会选哪个，PAT 和 JWT 都不打印。
>
> 注意这个 `x-tt-logid` 和 Trae 自家排查串里那个 32 位 `traceId` 不是一回事：后者是**上面一层**聊天服务的
> trace，裸接口这边没有；这里填的是网关给这次请求记的名字，也正是能拿去查这次请求的那个。

## 下一步选择卡片

Trae 模型回答完一轮后，输入框上方（和 todo、排队消息同一个位置）会出现**下一步选择卡片**，
样子类似 Claude 回合结束时的那个选择框：

- **一件事一张卡片**：回答里报了几个问题、提了几件可以做的事（比如「安装路径写错了」和
  「缺一段配置说明」），就出几张卡片，最多 3 张，卡片顶上标「下一步 · 1/2」。同一件事的几种做法才放在
  同一张卡片里；模型被要求不出「两个都改」「接下来做什么」这种把几件事捆在一起的卡片或按钮。
- 每张卡片是一个问题加几个按钮，**问题和按钮都是模型给的**，不固定是「要 / 不要」：可能是
  「用 pino / 用 winston / 用 console 封装」，也可能是「改路径 / 先查可执行名」。每张最多 4 个，
  模型推荐的排第一个（实心按钮）。不会有「暂不 / 跳过」这类按钮——不想做就点 `×`。
- 点按钮：按钮背后那句话（模型以你的口吻写的，鼠标悬停可以看到）**作为你的下一条消息发出去**，
  而且**带上卡片上那个问题**：发出去的是「关于「要把 README 里过时的安装路径改掉吗？」：把 README
  里过时的安装路径改成 DSH NEXT.app」。卡片上的问题是旁路补全问出来的，**主对话里从来没出现过**，
  所以只发一句「改吧」模型并不知道指的是它上一轮提到的哪件事。模型没给问句的卡片，发出去的就是那句话本身。
  建议模型也被要求别把按钮背后那句话写成「改吧 / 是的 / 第二个」这种光同意的话，而要写清做什么、改哪儿。
- **默认交给子会话做**（`suggestSubagent: true`）：发出去的那条消息会在那句话外面包一层
  「用 `subagent` 工具开个子会话去做，自己别直接动手，做完把结果要点和改了哪些文件告诉我」，
  并单起一行写上「背景：上一轮结束时待定的问题是「…」」。
  卡片右上角标一个「子会话处理」，卡片下面那行写明这一轮按钮会怎么处理，点那行左边的小按钮就能
  当场切成「当前会话处理」（这一轮有效，下一轮回到配置里的默认值）。切回当前会话后，发出去的就是
  上面那条「关于「…」：…」，不带委派那层。开子会话这件事由 DSH 宿主的委派工具做（`@deepseek-ai/dsh-subagent` +
  `dsh-tool-subagent`）——宿主没装委派工具的话，模型自己就把活干了，不会报错。
  这一档开着时，建议模型还会被额外要求把每个按钮背后那句话写成**自带上下文的任务**（点名文件、
  路径、命令、已经查到的结论），因为子会话看不到当前这段对话。
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
>
> 交给子会话也走这条路：插件不自己去起子会话（宿主的 `startActivation` 要求父会话的 agent
> 当场活着，而点卡片时这条会话正空闲），而是把「请委派给子会话」写进发出去的那条消息里，由
> 当前会话的模型调 `subagent` 工具派活。所以这件事在 Cue 统计里仍然只算一次 `code_gen_accept`，
> `accept_content` 记的是模型给的那句话本身，不含外面包的那层委派说明。

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
连接状态显示明确提示。77 项单元测试覆盖协议转换、各项兜底、额度解析与路由注册，以及**出货
bundle 里每个模型的上下文窗口和思考档位**。真实 PAT 兑换、模型调用与额度查询已在
`api.enterprise.trae.cn` 环境用真实 PAT 验证通过。

> **哪些没有实测过**：工具 schema 的 draft-4 归一化是按上游「分后端校验」的报告写的，本机没有
> 复现过 DeepSeek 后端那条 `4027`；五档词表里的 `medium` / `max` 上游尚未下发。目录通道那条
> 2026-10-27 已实测（四个额外通道回 200 但 0 配置，所以默认只问 `chat`）。四项改动各自做过
> 变异验证：把实现改回原样，对应的测试就转红。
>
> 另外，`src/trae/catalog.ts` 那份**内置兜底表（20 个模型）已经落后于上游**：同一次实测里
> `chat` 通道可见 23 个模型（除 `summary` 与 `custom_model_placeholder`），多出
> `DeepSeek-V4.1-Flash-1017`、`kimi-k3.1-pro`、`minimax-m3.1-flash` 三个。兜底表只在断网或
> 上游不可达时才用到，所以不影响正常使用。
