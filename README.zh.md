# dsh-client-ui-git-branch

[English](README.md) | 中文

一个 dsh（DeepSeek Harness）out-of-tree 插件：在对话输入栏中、**模型选择的正左侧**
（`conversation.input.right`）添加一个 **git 分支选择器**。

## 功能特性

- 座位位于**模型选择左侧**，chip 与菜单外观与模型选择完全一致
- 仅当本机安装了 `git` **且**当前会话工作区是 git 仓库时才显示
- 分支**模糊搜索**（子串或按序子序列匹配），带清除按钮
- 列表**最多同时展示 5 行**；更多分支通过列表内部滚动条查看（不滚动页面）
- **当前分支以不同颜色特别标注**（品牌蓝 + 勾选图标）
- **上游关联信息（VSCode 风格）**：每个分支显示其远程短名（`origin/main`），配彩色
  领先/落后提交计数（`↑2` 琥珀色 / `↓3` 绿色），上游被删除时显示红色 `gone` 标记；
  纯本地分支不显示任何关联信息。当前分支不同步时，触发器 chip 上也会显示同样的徽标
- **本地 / 远程分组**——见 [分支分组](#分支分组)
- **新建分支**：弹窗输入分支名，从 HEAD 创建并自动签出（`git switch -c`）；非法名实时
  提示，重名冲突显示 git 原始报错
- 切换分支带冲突检测：切换失败（通常是未提交改动会被覆盖）弹出 Toast 显示 git 原始报错
- 完整 **中 / 英 i18n** 与多主题自动适配（全部基于 `--dsw-*` 设计令牌）
- 分离 HEAD 安全（触发器回退显示 `HEAD`）；无提交的新仓库也能列出当前分支

## 分支分组

列表在两个 sticky 标题下分组展示：

- **本地分支**——全部本地分支。有关联远程的分支保留其上游映射
  （`master → origin/master`，含领先/落后计数）。
- **远程分支**——仅显示**远程存在、本地没有对应分支**的分支
  （`origin/HEAD` 符号引用与裸远程 ref 已排除）。

交互行为：

- 模糊**搜索同时作用于两个分组**；无匹配项的分组自动折叠隐藏。
- 点击**远程**分支：创建本地跟踪分支并切换（`git switch --track origin/feature` →
  本地 `feature` 跟踪 `origin/feature`），随后该分支移入本地分组。
- 点击**本地**分支：切换工作树（`git switch`）；切换被阻止（通常是未提交改动会被覆盖）
  时弹出 Toast 显示 git 原始报错。

## 安装

1. 构建并打包插件：

   ```sh
   pnpm install
   pnpm run typecheck
   pnpm test
   pnpm run build
   npm pack          # dsh-client-ui-git-branch-0.4.0.tgz
   ```

2. 将包装入你的 profile：

   ```sh
   dsh plugin --profile web add ./dsh-client-ui-git-branch-0.4.0.tgz
   ```

3. 在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 中挂载：

   ```yaml
   - insert:
       - id: ui-git-branch              # 插件 id（保持不变）
         name: dsh-client-ui-git-branch # npm 包名
   ```

4. 重启 profile 并刷新浏览器页面。打开工作区为 git 仓库的会话，模型选择左侧即出现分支
   chip。

## 验证

```sh
dsh --profile <name> --dump-config | Select-String ui-git-branch
```

重启后，输入栏显示分支 chip；展开可见分组列表、搜索框与「新建分支」入口。

## 开发

```sh
pnpm run typecheck   # 严格 tsc（src + tests）
pnpm test            # vitest：host 逻辑（fake runner）+ 真实 git 集成 + jsdom 组件测试
pnpm run build       # esbuild 双产物 → lib/index.js（node ESM）+ lib/client.js（浏览器 CJS 闭包）
```

开发用独立测试 profile：`git-branch-dev`（与用户的 `web` profile 隔离），以
`dsh --profile git-branch-dev --port 3800` 启动。

## 许可证

MIT
