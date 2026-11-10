# Paseo 研究团队插件设计草案

组织模型已在讨论中确认：用户预先配置固定成员，成员采用可扩展的 Role 和 Paseo Agent Profile，每位成员保留独立的长期会话。Orchestrator 从名单中选择并唤醒成员；成员之间直接使用 Paseo 原生通信。本次实现已加入 v2 配置、Profile 选择、成员会话管理和关系图，并使用用户配置的 Antigravity CLI 与 Codex Profiles 完成原生通信联调。

## 已确认的协作行为

- 一个团队使用一个 Workspace，所有成员共享同一份项目文件，各自保留会话上下文。
- Role 的名称和数量可由用户扩展；anchor、programmer、mathematician 是初始示例。
- 用户预先为成员选择 Role 和 Agent Profile。同一 Role 可以有多位成员；同一 Profile 也可以被多位成员采用。
- 用户指定一位具体成员担任 Orchestrator。Anchor 指这个负责人在示例中的角色名称。
- Orchestrator 从已配置的成员中选择并派发任务，不自行扩充成员名单或替换启动参数。
- 成员主动整理结论、证据、影响和阻塞后，再向 Anchor 发送报告。普通交流与运行通知不会自动抄送进 Anchor 的对话。
- 用户可以查看并直接进入任何成员的会话，补充指令、调整任务或停止当前工作。
- 关系图展示具体成员以及成员之间的协作关系，支持从节点打开会话。

## Role 与成员的身份

| 概念 | 内容 | 身份约束 |
| --- | --- | --- |
| Role | 职责、补充 system prompt、协作和汇报约定 | `roleId` 在团队内唯一 |
| Agent Profile | Paseo 保存的启动参数模板 | Profile ID 属于所在 Host |
| 团队成员 | 用户指定的 Role、Profile 配置和显示名称 | `memberId` 在团队内唯一，多个成员可以引用同一 Role |
| Role session | 某位成员当前使用的 Paseo agent 及其上下文 | 实际 `agentId` 是运行态，重置后可以变化 |

长期身份绑定到成员。例如 `programmer-codex` 和 `programmer-pi` 采用同一份 programmer 角色 prompt，但保留不同的启动参数、任务和会话。负责人通过 `orchestratorMemberId` 指向具体成员，避免同一负责人 Role 有多个成员时产生歧义。

`.forge/CONTEXT.md` 定义 Role 的职责与本地 prompt 文件，以及具有独立身份和 Profile 参数的团队成员；Project、Workspace、Orchestrator 和 Role session 继续沿用仓库中的术语。

## 本地 Team definition

采用每个 Workspace 一个团队文件的约定，将 Role 定义与成员启动配置分开；同一结构也可以存放在 `.agents/team.json`。以下 JSON 用于说明结构；模型占位值需由用户选择的 Profile 填充，不能直接用于启动。

```json
{
  "version": 2,
  "id": "research-team",
  "goal": "由用户指定研究目标",
  "workspace": "research",
  "commonPromptFiles": ["prompts/research-team-common.md"],
  "orchestratorMemberId": "anchor-main",
  "roles": [
    { "id": "anchor", "name": "Anchor", "promptFiles": ["prompts/anchor.md"] },
    { "id": "programmer", "name": "Programmer", "promptFiles": ["prompts/programmer.md"] },
    { "id": "mathematician", "name": "Mathematician", "promptFiles": ["prompts/mathematician.md"] }
  ],
  "members": [
    {
      "id": "anchor-main",
      "roleId": "anchor",
      "launchSnapshot": { "provider": "claude", "model": "<model from selected Profile>" }
    },
    {
      "id": "programmer-codex",
      "roleId": "programmer",
      "launchSnapshot": { "provider": "codex", "model": "<model from selected Profile>" }
    },
    {
      "id": "programmer-pi",
      "roleId": "programmer",
      "launchSnapshot": { "provider": "pi", "model": "<model from selected Profile>" }
    },
    {
      "id": "theory-main",
      "roleId": "mathematician",
      "launchSnapshot": { "provider": "antigravity-cli", "model": "<model from selected Profile>" }
    }
  ]
}
```

`launchSnapshot` 从用户选择的 Agent Profile 生成，包含 `provider`、`model`，并原样保留存在的 `modeId`、`thinkingOptionId` 和 `featureValues`。示例中的 harness 分配仅用于说明多成员关系，最终由用户选择。

新增 Role 时，用户添加 prompt 文件、Role 定义和对应成员，应用后刷新团队名册与关系图。现有成员的会话继续保留。

## Agent Profile 的读取和应用

服务端通过 `paseo.config.get()` 读取 `config.agentProfiles`，仅向客户端返回 Profile 所需字段。插件不代替用户编辑全局 Profile。

Paseo 的 Profile 不包含 system prompt，且应用 Profile 是复制启动参数。Profile 后续修改不会自动改变已经启动的 agent。实现沿用这一语义：团队文件保存已选参数快照，本机运行态记录来源 Profile ID，用户明确重新应用 Profile 后才更新成员配置。跨 Host 使用团队时，以快照校验本机可用性，来源 Profile 需要在对应 Host 重新绑定。

Profile 的 `model` 在 Paseo 协议中可以缺省。此插件创建成员前需要完整、可验证的模型配置；缺少模型时在编辑器提示用户补全，不交由 Anchor 临时选择。

现有 `agentModeOf` 和 `agentFeaturesOf` 会自动选择 mode 或 Auto Accept。新成员配置应尊重 Profile 的已选参数，缺省字段交给 provider 默认值，不再用这些推断覆盖用户选择。

依据：[Agent Profile schema](https://github.com/getpaseo/paseo/blob/v0.13.0/packages/protocol/src/agent-profile.ts)、[配置读取接口](https://github.com/getpaseo/paseo/blob/v0.13.0/packages/client/src/index.ts#L473)、[Profile 更新语义](https://github.com/getpaseo/paseo/blob/v0.15.3/public-docs/agent-profiles.md#apply-settings-in-one-click)。

## Prompt 组合与会话准备

所有 prompt 路径相对于 Project 根目录解析，支持 `prompts/` 或用户选择的隐藏目录。Role 职责由用户提供；插件生成部分只包含团队身份、最新成员目录的位置、原生通信约定和负责人信息。

创建时将 common prompt、该 Role 的 prompt 和生成的团队信息组合为 `config.systemPrompt`。实际研究任务通过后续消息送入会话，研究状态文件按任务读取，不把它们永久复制进 system prompt。读取失败时报告具体文件问题，不带着缺失 prompt 启动该成员。

实际注入位置取决于 harness：Codex 将补充内容放入 `developerInstructions`，Antigravity CLI 的 ACP 路径使用 `_meta.antigravity.systemPrompt.append`，两者均保留 harness 的基础指令。2026-11-10 已只读核对三个测试成员：common 与各自 Role 文件的完整原文均存在于 Paseo 保存配置，配置指纹一致，没有混入其他 Role 文件；两位 Codex 成员的原生 rollout `developer` 消息，以及 Anchor 的原生会话数据库，均含完整拼接内容。此次检查没有发送模型任务。

Apply 为预配置成员创建或复用长期会话。新建普通成员时不提交研究任务，使其等待唤醒；负责人可以先返回就绪信息。SDK 的创建接口允许省略初始 `prompt`，并支持单独传入 `config.systemPrompt`。

会话匹配使用团队和成员身份，再核对 Workspace、启动参数及 prompt 版本。不能仅按 `role=programmer` 查找或选择最新会话。创建和恢复需要覆盖列表分页，并避免重复 Apply 或并发唤醒产生重复成员会话。

成员带有团队、成员标签，并保留 `role` 标签。负责人带 `workspace-agents=orchestrator`，方便 Paseo 识别负责人身份。成员之间的业务调度关系独立于 Paseo 的父子生命周期，重置负责人不应连带归档其他成员。

运行态建议存放于不进入版本控制的 `.agents/.runtime/paseo-agent-team/`，记录 Host、Workspace、团队、成员到 `agentId` 的映射，以及来源 Profile 绑定和实际配置摘要。它不包含会话正文。每次发送前读取最新目录，避免重置成员后继续使用旧 `agentId`。

修改 prompt 或 Profile 后，界面显示配置待应用。当前实现提供显式重置该成员会话的方式；普通任务、查看会话、刷新关系图都不触发重置。旧会话历史保留，新会话更新同一成员的运行态映射。

依据：[会话创建配置](https://github.com/getpaseo/paseo/blob/v0.13.0/packages/client/src/index.ts#L237)、[创建参数](https://github.com/getpaseo/paseo/blob/v0.15.3/packages/client/src/index.ts#L249)。

## 唤醒与主动汇报

Anchor 从 Team definition 了解成员职责，从最新运行态目录取得具体 `agentId`，再调用 Paseo 原生 `send_agent_prompt`。固定的是成员名单，不是永久不变的 `agentId`。

成员之间的咨询、答复和报告均走同一原生通信机制。common prompt 约定 `notifyOnFinish: false`，由接收方主动撰写回复，避免默认完成回调把整段最终输出带给发送方或 Anchor。插件不另建研究消息转发服务，也不把运行事件改写成研究结论。

成员主动汇报的重要内容包括结论变化、阶段性成果、阻塞和需要负责人决策的问题。报告建议说明结论、证据或文件引用、对研究的影响和需要的决策。普通问答无需抄送 Anchor；运行错误、权限等待和进程失效留在界面中展示。

这类汇报行为由各 Role 的 instructions 和实际发送操作实现。界面可以记录消息来源、事件类别和已发送内容，但仅凭运行状态无法证明 agent 已经整理过信息。

依据：[原生发送工具](https://github.com/getpaseo/paseo/blob/v0.15.3/packages/server/src/server/agent/tools/paseo-tools.ts#L1871)。

## 关系图和用户介入

以成员为节点，显示 Role、Profile 启动参数、当前任务和运行状态。Role 用作标签或分组，同一 Role 下的多位成员始终分别可见。静态关系表示负责人调度和成员协作；动态图中的连线活动来自实际消息记录，不由 running 状态推断。

Paseo Timeline 中的 `agentMessage` 提供事件类别、发送者和文本，接收方由当前 Timeline 所属 agent 确定。只将团队成员间实际的 `message` 事件计入普通交流，完成、错误、权限和关闭通知单独分类。消息记录与会话列表联合解析为成员身份，避免把会话重建误认为新增成员。

Timeline 订阅只提供实时事件，需要结合 `refetch()` 补拉历史，按原生事件身份和游标去重，重连时补齐缺口。只观察本团队会话，订阅在界面关闭后释放。

独立的“时间线”页汇总当前和归档会话，使用 `identities` 将重置前后的会话对应到同一成员。当前会话订阅实时更新，归档会话只补拉历史。默认按最新优先展示成员消息；“全部活动”包含用户指令、会话回复、工具和事件。搜索常驻，成员、发送者、接收者、活动类型和日期时间选择器通过“筛选”按需展开。点击图上连线数量进入对应交流，展开记录后可查看原文、工具详情、打开原生会话或按参与者筛选。每次展示 20 条记录，可继续加载；历史范围与时间精度说明收在“关于历史记录”中。

用户指令、实际成员消息、成员自身会话回复、工具调用和通知事件分别展示；普通回复不推断接收者。记录按 Paseo 的时间戳排序，同会话在时间相同时保留序号顺序。实测发现 Antigravity CLI 恢复历史时可能给多条记录重建相同时间戳，因此界面明确说明跨会话时间顺序的精度限制。没有时间的记录放在末尾，并在指定时间范围时排除。

历史补拉使用 SDK 的 `seqStart`、message/call ID 和 epoch 合并重叠记录。完成的工具调用替换运行中的行，投影合并后的回复替换被覆盖的文本片段；重连后跟随游标补齐，epoch 改变则重新拉取，游标异常显示错误与重试入口。已移出团队定义的成员不纳入聚合，其历史仍在 Paseo 归档中。

点击成员节点复用 `navigation.openAgent` 打开原生会话，用户直接查看或发送指令。运行中发送的 steering、排队或中断行为由对应 harness 和 Paseo 原生会话处理。用户指令影响协作时，由收到指令的成员整理变更，再通知相关成员或 Anchor。用户能查看所有会话，不意味着这些内容自动复制到 Anchor 的上下文。

客户端继续使用 React Native primitives，并通过 `theme.colors` 取色；新增界面文本同时覆盖 en、ko、ja、zh。

依据：[结构化消息](https://github.com/getpaseo/paseo/blob/v0.13.0/packages/protocol/src/agent-message.ts)、[Timeline SDK](https://github.com/getpaseo/paseo/blob/v0.15.3/packages/client/src/index.ts#L329)、[现有会话入口](../client/AgentDashboard.tsx)。

## 接口与版本核对

| 能力 | 已核对的接口 | 源码范围 |
| --- | --- | --- |
| 读取 Agent Profiles | `PluginHandlerContext.paseo.config.get()`，结果含 `agentProfiles` | Paseo 0.13.0 和 0.15.3 |
| 创建独立会话并注入 prompt | Workspace agent 创建接口，支持 `config.systemPrompt` 和可选初始 `prompt` | 当前工程调用链及 SDK |
| 观察通信来源 | Timeline item 的 `agentMessage` | Paseo 0.13.0 和 0.15.3 |
| 订阅与补拉历史 | `agent.timeline.subscribe()`、`agent.timeline.refetch()` | Paseo 0.13.0 和 0.15.3；恢复流程需联调 |
| 用户进入会话 | `navigation.openAgent({ agentId })` | 当前 Dashboard 已使用 |

这些基础原语已经存在于当前固定的 0.13.0 依赖中，尚无必要仅为它们提高最低版本。若实施时采用更晚加入的 API，需同步调整依赖与 `requirements.paseo`。服务端仍从插件 SDK 派生类型，不直接导入 `@getpaseo/client`。

## 实施顺序与验收

1. 扩展纯 shared 模型，拆开 Role 和成员，加入 Profile 快照、负责人引用和 prompt 文件契约。产品只提供这一套团队流程；v1 配置不参与读取、管理或迁移，已有文件保持在磁盘上。
2. 扩展服务端 Profile 读取、文件解析、成员目录和 Apply。先完成创建、复用、显式重置及失败状态处理，再接入真实 provider。
3. 更新负责人和成员 prompt，使用成员目录解析目标，通过 Paseo 原生工具唤醒和报告。新增成员后，负责人下一次调度读取最新名册。
4. 更新编辑器和 Dashboard，以成员为单位展示和导航，移除同 Role 只保留较新空闲会话的过滤规则，再接入实际消息事件。

优先验证以下行为：

- 同一 Role 的两个成员使用不同 Profile，各自复用自己的会话，消息不会因 Role 同名而发错。
- 新增自定义 Role 后可配置成员、被发现和唤醒，不需要新增写死的角色分支。
- Profile 中的可选设置完整保留，缺失字段不会被自动模式推断替换。
- 缺失 prompt、重复成员 ID、无效 Role 引用和无效负责人引用能在启动前指出。
- 重复 Apply 不创建重复成员；重置负责人不会重置其他成员。
- 普通成员交流和原始运行通知不会被插件自动发送给 Anchor；成员可主动提交整理后的报告。
- 同 Role 的多个空闲成员在图上均可见，用户能分别进入原生会话。
- 关系图重连补拉后不重复计算同一条消息，运行事件与普通消息可以区分。

验证从相关单元测试、服务端 mock 和图数据逻辑开始。实际 harness 的 prompt 注入、会话复用、消息送达、用户介入与恢复行为需要单独的 live smoke test。

## harness 环境与后续验证

- 2026-11-10 已读取用户配置的 Anchor、Programmer、Mathematician 三个 Profiles，并通过实际安装插件的 RPC 创建、复用与重置成员。
- 本机同时存在 `antigravity` 和 `antigravity-cli`。内置适配器不支持注入 Paseo 工具；已安装的 `antigravity-cli` ACP 路径支持共享 MCP 和附加 system prompt，工具共享默认关闭。本次 Anchor Profile 已启用共享，实测能够向 Codex 成员发送消息并接收报告。守护进程或 harness 重启后的恢复行为仍需单独验证。
- Codex `auto-review` 曾拒绝 Programmer 向 Mathematician 发送消息，原因是任务来自同伴消息，缺少 reviewer 认可的用户任务授权。用户明确批准这次只读算术测试后，测试把该范围授权送入两位 Codex 成员会话，随后原生消息链通过。测试没有修改 Profile、mode、sandbox 或其他权限参数。未来任务也需要符合所选 harness 的用户授权语义，插件不自动扩大权限。
- Pi 作为可选 harness，需要核对安装版本和 Paseo 注入工具的实际可用性，不仅依据 provider 显示 available 判断。

依据：[内置 Antigravity 限制](https://github.com/getpaseo/paseo/blob/v0.15.3/public-docs/supported-providers.md#antigravity)、[Antigravity CLI 适配器](https://github.com/lefos13/paseo-plugin-antigravity-cli)、[Pi 接入说明](https://github.com/getpaseo/paseo/blob/v0.15.3/docs/providers.md#direct)。

## 当前交付范围

已保存研究团队的 Agent team 页签展示团队配置，分为“成员”和“角色与 Prompt”：前者列出保存的 Profile 启动参数，后者列出 common、角色 prompt 文件及团队定义路径，支持直接编辑对应成员或角色。“编辑配置”进入独立编辑视图，按基本设置、角色、成员切换，一次只展开一个角色或成员，启动参数默认折叠，应用与取消按钮固定在顶部。

Agent dashboard 页签展示团队运行情况：“概览”包含紧凑成员卡片、关系图及最多五条最近消息，宽面板左右并排显示；完整历史位于其中的“时间线”页。两个页签可在同一 Workspace 内相互跳转。

产品统一采用用户预配置成员、Profile 和本地 prompt 的流程；没有旧版编辑器、规划器或配置转换入口。旧 v1 文件不参与团队识别，创建时会避开已有文件名。删除成员后再次 Apply 会归档该成员会话，历史由 Paseo 保留。

关系图显示配置成员、调度关系和当前成员会话中已观察到的通信，支持点击节点进入原生会话。重置前的归档会话历史仍在 Paseo 中，不纳入当前会话消息计数。

团队时间线覆盖仍在团队定义中的成员的当前与归档会话。这个观察视图只读 Paseo 数据，不调用模型，不发送消息，也不改变 Anchor 接收报告的规则。

## 验证记录

以下记录按实现阶段保留；旧版兼容记录描述的是当时行为。当前入口只注册成员/Profile 团队的读取、应用、重置、列表、重连、恢复和删除。

当前统一流程已通过类型检查和 460 项单元测试（9 项 live 测试默认跳过）。新增检查覆盖旧定义隔离、文件名避让、重复团队拒绝、归档失败后的删除重试，以及 Workspace 占用保护。实际 daemon 读取当前工程时返回空团队和空错误列表，读取保留的测试工程时返回原有三个成员 ID；桌面检查确认当前工程配置入口、侧栏新建入口、全部智能体状态筛选和既有团队运行图均可用，Programmer → Anchor 仍显示一条整理后的报告。未应用任何配置或发送模型任务。

- `npm run typecheck` 通过。
- 合并上游 v0.2.16 后，`npm test` 共 457 项通过，9 项 live E2E 默认跳过。其中包括 16 项历史投影、身份、筛选、游标补拉与重连验证，以及上游活动筛选测试和混合 v1/v2 团队的 Dashboard 兼容回归；en、ko、ja、zh 的键与占位符检查通过。
- 本地目录安装后，`paseo-agent-team` 显示 `running`。实际 daemon 的 `research.read` RPC 能读取当前 Project 和 Workspace，返回空错误列表。
- `tests/research-live.e2e.test.ts` 通过：创建临时 Project 和 Workspace，按下表保留已配置的 Profile 参数；重复 Apply 复用三个成员会话；原生消息完成 Anchor → Programmer → Mathematician → Programmer → Anchor，求和结果为 55。Programmer 主动整理 Conclusion、Evidence、Impact、Decision needed 后上报；三位成员各自的 prompt 标记均出现，未使用自动完成回调，也未由测试程序代转消息。
- 单独重置 Programmer 后，Anchor 和 Mathematician 的会话 ID 保持不变。测试结束取消临时成员并归档测试 Workspace，证据写入临时 Project 的 `smoke-report.json`；用户的开发团队配置未改写。
- Paseo 桌面界面已用此前的归档测试会话验证团队时间线：显示 24 条记录，成员消息筛选为 4 条，Programmer → Anchor 筛选为 1 条整理后的报告；展开原文、指定起始时间排除记录、清除筛选及跳转发送者原生会话均通过。只临时恢复测试 Workspace，成员仍保持归档，没有发送模型任务；结束后 Workspace 已重新归档，界面回到开发会话。
- 合并上游后的桌面检查已确认“全部智能体”页签和活动筛选正常，三位研究成员均显示为实际会话，没有重复的旧版等待卡片。研究 Dashboard 仍显示三个成员、四条通信边及 24 条历史；点击 Programmer → Anchor 连线数量后，时间线筛选为一条报告。v2 配置成员的等待状态继续由研究关系图显示，通用 Dashboard 的等待 Role 名单仅用于 v1 团队。
- 完整配置表单、运行中介入，以及 Claude/Pi 的同类实测仍待验证。此次历史视图修改和上游合并没有重跑模型通信测试；沿用此前已通过的通信记录进行只读检查。
- 界面简化后，桌面检查确认概览直接显示三个成员及四条最近通信，没有整张配置表；编辑配置的分区切换、单成员展开和取消返回通过；点击图上 Programmer → Anchor 的数量进入单条报告，筛选清除后为四条成员消息，全部活动先显示 20/24 条并可继续显示至 24/24。没有应用配置或重置成员，原会话和测试历史保持可查看。
- 两个页签职责拆分后，桌面检查确认 Agent team 展示配置摘要，成员和角色编辑均直接展开选中项，取消返回摘要；“打开运行面板”进入同一 Workspace 的 Agent dashboard，显示三个成员、四条通信边和四条成员消息，“团队设置”可返回配置页签。类型检查和 457 项单元测试通过，没有应用配置、重置会话或发送模型任务。

用户反馈需要直接查看联调历史后，已恢复最后一次成功测试的 Workspace `Research smoke ffd98b97` 及三位成员的原始测试会话，保留原会话 ID，并重新同步成员目录；三位成员均为 idle，供用户验收。联调脚本改为默认停止测试活动并保留 Workspace 和会话，只有 `PASEO_RESEARCH_ARCHIVE=1` 才在结束时归档。单成员重置仍会按设计归档旧 Programmer 会话，其历史可从团队时间线查看。

| 已配置 Profile | provider / model | mode / thinking |
| --- | --- | --- |
| Anchor | `antigravity-cli` / `gemini-4-argon` | `accept-edits` / `high` |
| Programmer | `codex` / `gpt-6.1-sol` | `auto-review` / `high` |
| Mathematician | `codex` / `gpt-6.1-sol` | `auto-review` / `high` |

Anchor 的 `featureValues` 保留为 `approvalPolicy: skip`、`sandbox: on`、`shareMcp: on`。本次测试启用命令如下；`PASEO_RESEARCH_PEER_APPROVAL=1` 仅用于用户已明确批准的这次算术通信范围，不能作为后续任意任务的授权。

```bash
PASEO_RESEARCH_E2E=1 PASEO_RESEARCH_PEER_APPROVAL=1 npx vitest run tests/research-live.e2e.test.ts
```
