# dsh-client-ui-git-branch 插件设计文档

> 状态：设计定稿。目标产物是一个**完全独立于 deepseek-harness 仓库**的 out-of-tree 插件，
> 不改 deepseek-harness 的任何基础代码（不碰 `packages/`、bundle patch、RPC map）。

## 1. 目标与范围

在 dsh Web 对话页的**输入栏（composer）**中，模型选择（ModelSelect）的**左侧**新增一个 Git
分支选择器：

- 仅当「本机安装了 git」且「当前会话的工作区（cwd）位于某个 git 工作树内」时显示；
- 触发器为 chip 形态（分支图标 + 当前分支名 + 展开箭头），与模型选择同排、紧邻其左；
- 展开项为一个菜单：顶部**搜索框**（模糊搜索分支），下方分支列表**最多同时展示 5 行**，
  超出 5 行使用**内部滚动条**下滑查看；
- **当前分支以不同颜色特别标注**（品牌蓝 + 选中勾），其余分支常规样式；
- 点击非当前分支 → 切换到该分支；**切换失败（如未提交改动冲突）弹出 Toast 提示** git 的报错；
- UI 复用 house 风格（`--dsw-*` 设计令牌，自动适配多主题），文案支持 **zh/en i18n**。

## 2. 硬约束

1. **不改 deepseek-harness 任何基础代码**：不修改 `packages/` 任何文件，不新增 RPC 进 host 的
   `rpc-map`，不改 bundle。
2. 插件以独立 npm 包存在（scoped 包 `@dsh-mixxed/dsh-client-ui-git-branch`），通过 dsh 官方支持
   的 out-of-tree 挂载路径安装：包内自带 `cordis.patch.yml` 并声明 `dsh.bundle.patch`，
   `dsh plugin add` 自动把包追加进 profile 的 `dsh.profile.bundles` 层栈（无需手改
   `cordis.patch.yml`）。

## 3. 可行性结论（全部在真实源码核实）

| 需求 | 结论 | 依据（deepseek-harness 现有机制，rc.6） |
|---|---|---|
| 对话页模型选择左边的座位 | ✅ 可行 | `conversation.input.right` 槽（list、session 作用域）在 InputBar 的 `.trailing` 行内渲染于模型座位正左方：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` L754-756（`{rightItems}` 之后才是 `renderSlot('conversation.input.model')`），`.trailing` 为普通 flex（`InputBar.module.css` L321-324，无 row-reverse），DOM 序 = 视觉序。槽声明在 `contract/slots.ts` L187（owner `InputZone`），运行时声明在 `apply.ts` L208 |
| 客户端 out-of-tree 注入该槽 | ✅ 可行 | 与设置页插件同一机制：`ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name, id, order, locale }, Component))`；SlotMap 类型经 **type-only** import `@deepseek-ai/dsh-client-ui-conversation/client` 合并（参考 `ui-model-selection/src/client/index.ts` 对 `conversation.input.model` 的注册） |
| 获取当前会话工作区路径 | ✅ 可行 | 标准 kit 全局座 `useSessions(s => s.byId[sessionId]?.cwd)`（`dsh-client-runtime` 的 `GlobalStandardProps` 合并，`packages/client/runtime/src/client/index.ts` L146-150；同型用法：`ui-conversation/skeleton/DetailsPanel.tsx` L70、`chat/ChatView.tsx` L155） |
| host 侧执行 git + 数据通道 | ✅ 可行 | node half 用 `ctx.webServer.register({ kind: 'prefix', path: '/plugin/ui-git-branch', handler })`（`packages/host/webserver/src/index.ts` L94-101，返回 disposer，配合 `ctx.effect` 卸载）；git 经 `node:child_process` `execFile`（host 进程内直接执行，参数数组无 shell 注入）；浏览器同源 fetch（参考 `ui-settings-skills` 的 `/plugin/settings-skills/*` 路由） |
| 冲突无法切换时弹提示 | ✅ 可行 | `git switch <branch>` 非零退出时 stderr 含冲突原因（"would be overwritten" / "local changes"）；host 返回统一错误体 `{ error: { code, message } }`，客户端弹 ui-primitives `Toast`（锚定 `[data-composer-card]`，与 ModelSelect 被拒选择同款） |
| i18n | ✅ 可行 | `ctx.locale.register(NS, { zh, en })` + `LocaleNamespaceMap` 声明合并 + `PropsLocale` 的 `t` 座位（参考 `ui-settings-skills/src/client/locales.ts` 与 `ui-model-selection` NS `model`） |
| 多主题 | ✅ 可行 | 全部颜色走 `--dsw-*` 设计令牌（`--dsw-specific-menu`、`--dsw-alias-*`、`--dsw-shadow-lv3`、`--dsh-scrollbar-*` 悬浮面滚动条契约，见 `ModelSelect.module.css` 与 `ui-theme/styles/design-platform.css` 明暗两套取值） |
| client bundle 分发 | ✅ 可行 | `dsh.client` manifest（`platform: "web"`、`inject: [runtime, locale, ui-conversation, ui-slots]`）+ `exports["./client"]`；`client-modules` 按 loader 条目名解析包并 serve `/plugins/<id>/client.js`（`packages/client/modules/src/index.ts` L383-401；bundle 内 `__ModuleLoader__.load` 的 id 必须等于图行 id = 条目名 = 可解析包名） |

## 4. 架构总览

```
浏览器 (Web Client)                              host 进程 (dsh --profile <name>)
┌──────────────────────────────────────┐        ┌────────────────────────────────┐
│ dsh-client-ui-git-branch (client half)│  fetch │ dsh-client-ui-git-branch (node) │
│  GitBranchSelect                      │ ① ②   │  inject: ['webServer']          │
│  ├ 触发器 chip（图标+分支名+箭头）      │ ─────▶ │  GET  /plugin/ui-git-branch/   │
│  ├ 菜单: 搜索框(模糊) + 列表(≤5行滚动)  │ ◀───── │    status?cwd=<会话工作区>      │
│  │  · 当前分支品牌色高亮 + 勾           │  JSON  │  POST /plugin/ui-git-branch/   │
│  │  · 点击非当前分支 → 切换             │        │    switch { cwd, branch }      │
│  │  · 失败 → Toast(锚定 composer 卡片)  │        │  git 经 child_process execFile │
│  └ 挂载于 conversation.input.right      │        └────────────────────────────────┘
│    （模型选择正左方，order 100）          │
└──────────────────────────────────────┘
```

- **双面包**：一个 npm 包同时含 node half（`apply` 注册路由）与 client half（`dsh.client` manifest
  + `exports["./client"]`）。
- **cwd 来源**：客户端标准 kit `useSessions` 读取会话工作区路径（会话列表行 `cwd` 字段），随请求
  传给 host；host 不缓存任何状态，请求时现跑 git。
- **wire 契约**：`src/wire.ts` 纯类型文件，绝不携带运行时代码进 bundle。

### 4.1 数据模型（wire）

```ts
StatusResponse {
  gitAvailable: boolean       // git 可执行文件存在
  repo: boolean               // cwd（或其祖先）位于 git 工作树内
  branch: string | null       // 当前分支名；分离 HEAD 时 null
  branches: string[]          // 本地分支（git branch --format=%(refname:short)）
}
SwitchRequest  { cwd: string; branch: string }
SwitchResponse { ok: true; branch: string }
ErrorResponse  { error: { code: string; message: string } }
```

- `GET /plugin/ui-git-branch/status?cwd=...` → 200 `StatusResponse`；cwd 缺失 → 400 统一错误体。
- `POST /plugin/ui-git-branch/switch` → 200 `{ ok: true, branch }`；git 非零退出 → 409
  `{ error: { code: 'switch-conflict' | 'switch-failed', message: <git stderr> } }`；cwd/branch
  非法 → 400。
- `POST /plugin/ui-git-branch/create`（0.2.0）→ 200 `{ ok: true, branch }`（`git switch -c <name>`，
  从 HEAD 创建并签出）；同名分支 → 409 `branch-exists`，其他失败 → 409 `create-failed`。

### 4.2 host 侧 git 调用（`src/git.ts`）

`GitRunner` 接口抽象 `execFile('git', args, { cwd, windowsHide, timeout, maxBuffer })`：

- `--version` 失败且 `errno === 'ENOENT'` → `gitAvailable: false`（UI 隐藏，不算错误）；
- `rev-parse --is-inside-work-tree` 非零 → `repo: false`（UI 隐藏）；
- `branch --show-current` 空输出 → 分离 HEAD（触发器显示 i18n 回退文案）；
- `switch -- <branch>`（`--` 防止以 `-` 开头的分支名被当选项）非零退出 → stderr 原文回传，
  按 `/would be overwritten|local changes/i` 归类为 `switch-conflict`，否则 `switch-failed`。

### 4.3 client 侧交互

- **显隐**：`gitAvailable && repo` 才渲染触发器；cwd 未知（无会话/无工作区）不渲染。
- **菜单**：向上弹出、右对齐（同 ModelSelect）；打开时刷新 status；含搜索框（自动聚焦，
  `IconSearchOutline16`）、列表（`max-height: 5×38px`，`overflow-y: auto` 内部滚动）、
  加载/错误+重试/空/无匹配四态。
- **模糊搜索**：小写化后「包含」或「子序列」匹配（`fuzzyMatch`）。
- **当前分支**：`--dsw-alias-state-business-primary`（品牌蓝）标注名称与勾选图标 + 浅色行底
  （`--dsw-alias-interactive-bg-hover-accent`），与普通行明显区分。
- **切换**：点击非当前分支 → POST switch（busy 期间禁用列表）→ 成功关菜单并刷新；
  失败 → `Toast`（`IconWarningOutline16`，锚定 `[data-composer-card]`）展示 git 报错，菜单保持。
- **键盘**：Escape 关闭、↑/↓ 在可见行间移动焦点（复用 ModelSelect 的 moveFocus 模式）。

## 5. 挂载方式（不改仓库）

```sh
# 1) 构建 + 打包
pnpm run typecheck && pnpm test && pnpm run build && npm pack        # → dsh-mixxed-dsh-client-ui-git-branch-<version>.tgz

# 2) 装进独立测试 profile（不碰用户 web profile）——包声明 dsh.bundle.patch（包内
#    cordis.patch.yml），dsh plugin add 的 reconcile 步骤自动把包追加进 profile 的
#    dsh.profile.bundles，下次启动自动挂载——无需手改 cordis.patch.yml（该文件是用户层，
#    CLI 永不自动改写，这是设计使然）
dsh plugin --profile git-branch-dev add ./dsh-mixxed-dsh-client-ui-git-branch-<version>.tgz

# 3) 验证：--dump-config 出现 ui-git-branch 行（含 # == @dsh-mixxed/... 层注释），且
#    profile package.json 的 dsh.profile.bundles 含该包
dsh --profile git-branch-dev --dump-config | Select-String ui-git-branch
```

要点：

- scoped 包名 `@dsh-mixxed/dsh-client-ui-git-branch`（npm 名）与 cordis 插件 id `ui-git-branch`
  （`src/index.ts` 的 `name` 导出）分离：loader 条目 `name` 取 scoped npm 名，`client-modules`
  的图行 id、`/plugins/<id>/client.js` 路由、bundle 内 `__ModuleLoader__.load({ id })` 三者一致
  （`modules/src/index.ts` L384-401 + `system.ts` L99-111 的注册校验）。
- 插件集变更需重启 profile 才被客户端 `pkgMeta` 缓存发现；以 boot manifest 能否 serve
  `/plugins/@dsh-mixxed/dsh-client-ui-git-branch/client.js` 为准验证。
- 测试用独立 profile + 独立端口（用户 web 实例占 3080 → 测试用 3800）；重新验证前清残留实例。

## 6. 被否决的方案（记录）

- **`conversation.input.left`**：位于工具行最左端（附加以色列/计划之后），不在模型选择旁边；
  需求是「模型选择的左边」→ 否决。
- **`conversation.composer.dock`**：卡片下方整行横幅，是「只读氛围读数」座位，不适合需要点击
  的控件 → 否决。
- **typert gateway 自定义 RPC**：RPC 描述符注册在基础代码 `rpc-map`，无法注入 → 否决；
  `ctx.webServer` HTTP 路由是公开扩展点（保底方案 A，与参考插件一致）。
- **改 web-app bundle 新增座位**：违反硬约束 → 否决。

## 7. 诚实边界

1. **cwd 由客户端提交**：host 信任客户端传来的工作区路径（本地单用户工具，会话列表 cwd 即
   权威来源）；分支名经 argv 传递（无 shell），`--` 防选项注入。
2. **切换语义 = `git switch`**：不做 stash/force；未提交改动与目标分支冲突时如实失败并展示
   git 原文，符合「无法切换弹出提示」的需求。
3. **分支列表 = 本地分支**：不列远程分支（`git branch --format=%(refname:short)`）；若未来需要
   远程分支可加 `-a` 或 `-r`，属插件内改动。
4. **触发时机**：会话 cwd 变化（切换工作区）或菜单打开时刷新 status；不轮询。
5. **多仓库工作区**：`git -C <cwd>` 自动向上寻找仓库根；工作区根恰为仓库子目录时也能工作。
6. **分离 HEAD**：`branch --show-current` 为空 → 触发器显示 i18n 回退文案（`HEAD`），仍可切换。

## 8. 工程布局（仓库外）

```
dsh-client-ui-git-branch/
├── package.json                 # name/exports{".","./client"}/dsh.client{platform:"web"}/dsh.bundle/files
├── tsconfig.json                # 严格配置（对齐参考插件）
├── vitest.config.ts             # node + jsdom 双环境；inline ui-primitives
├── cordis.patch.yml             # bundle 补丁：id 挂载行（随包发布，dsh.bundle.patch 指向）
├── scripts/build.mjs            # esbuild 双产物（node ESM + client CJS 闭包工厂）
├── src/
│   ├── index.ts                 # node half: webServer 路由（status / switch）
│   ├── git.ts                   # GitRunner 抽象 + execFile 实现（可注入测试）
│   ├── wire.ts                  # 纯类型 wire 契约
│   └── client/
│       ├── index.ts             # client half: locale 注册 + conversation.input.right 注册
│       ├── GitBranchSelect.tsx
│       ├── GitBranchSelect.module.css
│       ├── locales.ts           # zh/en 词典 + LocaleNamespaceMap 合并
│       └── css-modules.d.ts
└── tests/
    ├── host.git.spec.ts         # host 逻辑（fake runner）+ 真实 git 集成测试（git 缺失时跳过）
    └── client.git-branch.client.spec.tsx  # jsdom 组件测试
```

## 9. 验证方案

| 层 | 方法 |
|---|---|
| host 逻辑 | 单元测试：fake GitRunner 脚本化响应（git 缺失/非仓库/仓库/分离 HEAD/切换冲突）；真实 git 集成：临时目录 `git init` 建分支后断言 status/switch 全链路 |
| client 组件 | jsdom：无 cwd 隐藏、非仓库隐藏、触发器文案、菜单开合、模糊搜索过滤、>5 分支滚动容器、当前分支高亮类、点击切换调用、失败 Toast 文案 |
| 组装验证 | 安装进 `git-branch-dev` profile（`dsh plugin add` 自动挂载 bundle）→ `--dump-config` 见行 → 3800 端口启动 → boot manifest serve `/plugins/@dsh-mixxed/dsh-client-ui-git-branch/client.js` → API 用 curl 验证真实 git 数据（在 git 仓库目录上）→ 页面打开会话（工作区为 git 仓库）见触发器与菜单 |

## 10. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| `@deepseek-ai/dsh-client-*` rc.6 与已装 dsh rc.6 运行时对齐（类型随版本演进） | 编译失败/槽位类型漂移 | 全部锁 `0.1.0-rc.6`（与已装运行时一致）；升级需重跑构建链 |
| client bundle 纯化门禁 | 跨插件 value import 被禁 | 对 `@deepseek-ai/dsh-client-ui-conversation` 仅 type-only import；其余 `@deepseek-ai/*` 只允许平台模块 external（与 shell `PLATFORM_MODULES` 逐字对齐） |
| 插件集变更需重启 | 开发迭代体验下降 | 文档化；bundle 内容更新可走 `rebuilt()` 热通知 |
| git 在用户 PATH 缺失 | 控件隐藏而非报错 | status 路由区分 `git-unavailable`（200 且 `gitAvailable:false`），客户端不渲染 |
