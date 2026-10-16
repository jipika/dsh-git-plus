# dsh-git-plus 方案（v2 · 完整 git 操作控制 · 供审阅）

> v2 变更：从「只读 diff 查看器」升级为**完整 git 操作控制台**。v1 的前提表、显隐机制、diff 渲染结论全部保留（见文末附录），本版新增操作面。

## 目标

会话详情页新增「Git」tab（有 `.git` 才出现，≤5s 自动出现），提供**日常 git 工作流的完整操作控制**：

浏览状态 → 查看 diff → stage/unstage → 丢弃改动 → 提交（含 amend）→ 历史提交 → 切换/新建分支 → fetch/pull/push。

## UI 信息架构（tab 内容区三子页签，官方 SegmentedTabs）

```
┌──────────────────────────────────────────────────────────┐
│ ⎇ main · ↑2↓0 · 3 changed          [Fetch] [Pull] [Push] │  ← 头部：仓库状态条 + 远程操作
│ ┌──────────┬──────────┬──────────┐                        │
│ │ 变更(3)  │ 历史     │ 分支     │   ← SegmentedTabs      │
└──────────────────────────────────────────────────────────┘

「变更」页（主工作面）：
┌──────────────────────────────────────────────────────────┐
│ ▾ Staged (1)                        [全部 unstage]        │
│   ● M  src/a.ts         +12 -3   [▾菜单]                  │  ← 菜单：unstage / 丢弃 / 查看diff
│ ▾ Changes (2)                       [全部 stage]          │
│   ● M  src/b.ts          +5 -1   [▾菜单]                  │  ← 菜单：stage / 丢弃 / 查看diff
│   ● ?? notes.md                  [▾菜单]                  │  ← 菜单：stage / 丢弃 / 查看diff
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ [☑amend]    │
│ │ commit message 输入框（Textarea）          │ [Commit]    │
│ └──────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────┘
     点文件行任意处 → 行内展开 diff（unified/split 切换）

「历史」页：
┌──────────────────────────────────────────────────────────┐
│ ● f3a9c21  fix: tab order   Ethan · 2h ago   [复制sha]    │
│ ● 8b2d4e0  init             Ethan · 1d ago                │
└──────────────────────────────────────────────────────────┘
     点提交 → 展开该提交 diff（git show，文件列表+逐文件diff）

「分支」页：
┌──────────────────────────────────────────────────────────┐
│ ✓ main          ↑2↓0    [当前]                           │
│   feat/git-tab           [切换]                          │
│   + 新建分支 [输入框] [创建并切换]                          │
└──────────────────────────────────────────────────────────┘
```

## 操作面（POST 动词路由，白名单表）

host 路由：`GET /dsh-git-plus/{health,git-info,status,file-diff,log,show-diff,branch-list}` + `POST /dsh-git-plus/action`。

| action | git 命令 | 参数 | 危险级 |
| --- | --- | --- | --- |
| `stage` / `stage-all` | `git add -- <f>` / `git add -A` | 文件相对路径 | 低 |
| `unstage` / `unstage-all` | `git restore --staged -- <f>` / `git reset` | 文件相对路径 | 低 |
| `discard` | `git restore -- <f>`（untracked 走 `fs.unlink`） | 文件相对路径 | **高·确认** |
| `commit` | `git commit -m <msg>` | message ≤2000 字符 | 中 |
| `amend` | `git commit --amend -m <msg>`（已推送的 amend 给警示文案） | message | 中·警示 |
| `switch` | `git switch <branch>`（工作区脏时拒绝并提示先 stage/commit） | 分支名（ref 格式校验） | 中 |
| `create-branch` | `git switch -c <branch>` | 分支名 | 低 |
| `fetch` | `git fetch --all --prune` | — | 低（网络） |
| `pull` | `git pull --ff-only`（冲突即失败提示，不做 merge/rebase 二选一） | — | 中（网络） |
| `push` | `git push`（无 upstream 时自动 `-u origin <branch>`） | — | **高·确认** |

### 写操作安全框架（硬约束）

1. **动词白名单**：POST body `{action, args}`，action 不在表内 → 400；每 action 的参数 schema 单独校验（文件路径 = 归一后仍在 cwd 内；分支名 = `git check-ref-format --branch` 预检；message = 长度截断）。
2. **不可逆操作两段确认**：`discard` / `push` / 已推送提交的 `amend` / 脏工作区 `switch`，client 侧走官方 `RiskConfirmation` + `Modal` 组件，确认文案写明后果（如「丢弃 src/a.ts 的全部未提交改动，不可恢复」）。
3. **串行队列**：host 侧写操作互斥（`AsyncMutex`，~15 行），避免并发 `git add`/`commit` 撞 `index.lock`；锁内命令 10s 超时；`index.lock` 残留（EEXIST）时明确报错提示而不是静默失败。
4. **回退线索**：每次写操作返回 `{ok, action, output, tip}`；commit/amend/switch 后 host 自动附 `git reflog -n 1` 输出，client 在 toast 里展示「已提交 f3a9c21 · 可 `git reset --soft HEAD@{1}` 回退」。（本期不做 UI 内 reset/undo —— reset 属于高危重写历史，放三期。）
5. **git 身份缺失**：`commit` 前探 `git config user.email`，缺失直接返回可读错误（「先配置 git user.email」），不产出半途状态。
6. **输出封顶**：全部命令 stdout 1MB / 10s 超时（写操作），stderr tail 4KB 原样透传给 client 呈现。

## 状态一致性

- 每个 POST 成功后 client **重新拉 status + git-info**（单次刷新，不轮询）；busy 期间所有操作按钮禁用 + 行内 spinner。
- 官方编辑器（模型的 write/edit）与本面板的变更列表可能出现竞态：status 每次都是现场拉取的快照，不存在缓存漂移；tab 重挂（会话切换回来）时强制刷新一次。
- `pull --ff-only` 失败（分叉）时给出原生 git 提示文案 + 建议（「工作区分叉，请在终端 merge/rebase，本面板不做三方合并」）—— 本期明确不实现 merge/rebase/conflict 解决 UI。

## 实现步骤

1. **host 半边** `lib/index.js`（~450 行）：GET 只读路由（v1 已设计）+ POST `/action`（白名单表逐 action handler、互斥锁、schema 校验、reflog tip、错误码映射）。
2. **client 半边** `lib/client.js`（~1100 行）：
   - a. Tab 注册 + 显隐控制器（v1 机制不变）。
   - b. 变更页（三段列表 + 行菜单 + commit 栏 + 行内 diff）。
   - c. 历史页（`git log --pretty=format:%H%x1f%an%x1f%at%x1f%s -n 50 -z` 解析 + 提交 diff 展开）。
   - d. 分支页（`git branch -vv --format` 解析 + 切换/新建 + fetch/pull/push 按钮组）。
   - e. 确认流（RiskConfirmation）、toast 反馈（官方 Toast）、i18n、样式锚 `.dgt-*`。
3. **挂载 + 验证**：
   - 探针 profile 全链路（`dsh probe-x --from-default-profile web` + token cookie）。
   - **只读正确性对拍**（v1 判据）：status/numstat/diff 与 `git` 原始输出逐项一致。
   - **操作回路实测**（临时 scratch 仓库）：stage→unstage→stage-all→commit→log 可见→amend→create-branch→switch→fetch→pull→push（推到本地 bare remote）→discard（untracked 与 tracked 各一）。
   - **安全用例**：`action:"rm -rf /"`（不在白名单 → 400）、`args.path:"../../etc"`（403）、分支名 `--upload-pack`（check-ref-format 拒绝）、message 5000 字符（截断）、并发双 commit（互斥锁串行）、`index.lock` 残留（可读错误）。
   - **确认流用例**：discard/push 不确认不发车；Esc/点击遮罩取消无副作用。
4. **回滚点**：单目录插件 + `cordis.patch.yml` 一行，删除即净回滚；写操作全部限定在会话 cwd 仓库内，无 DSH 数据写入。

## 分期边界（防 scope 膨胀）

| 期 | 内容 |
| --- | --- |
| 本期 | 状态浏览、diff、stage/unstage/discard、commit/amend、历史+提交diff、分支切换/新建、fetch/pull/push |
| 三期（不做） | reset/revert/cherry-pick、merge/rebase 与冲突解决 UI、stash、tag、submodule、remote 管理、diff 内行级 stage（hunk staging） |

## 待确认

1. **push/pull 的远端**：默认 `origin` + 当前分支 upstream，够不够？（多 remote 选择器放三期）
2. **commit 身份**：直接用仓库现有 `git config`，配置缺失时报错引导（不代填）—— 同意？
3. **v1 的三个问题合并到这里**：tab 位置默认「产物」之后；amend 已推送提交只给警示不阻止 —— 有异议说一声。

确认后按此实现。预计 host ~450 行 + client ~1100 行 + scratch 仓库操作回路全测。

---

## 附录 · v1 已核实前提（源码证据保留）

| # | 前提 | 证据 |
| --- | --- | --- |
| P1 | tab 行 = `conversation.view` list slot，每条目一个 tab | `ui-conversation/src/client/apply.ts:182,221` |
| P2 | `slots.register()` 返回 dispose，调即摘除 + 订阅刷新 | `ui-slots/src/index.ts:1300-1306` |
| P3 | viewTabs 无 per-session 过滤 → 显隐靠 register/dispose | `ui-conversation/src/client/apply.ts:183-189` |
| P4 | order 占用 chat=0 / trajectory=10 / artifacts=15 / context=20 / fleet=30，**16 空闲** | 源码 grep + 本机 artifacts-tab |
| P5 | 组件 props 有 sessionId；cwd 取 `useSessions((s)=>s.byId[sessionId]?.cwd)` | `dsh-artifacts-tab/lib/client.js:346` |
| P6 | host 路由 `webServer.register({kind:"prefix",path,handler})` 带 dispose；`req.url` 是完整路径 | `host/webserver/src/index.ts:334`、workspace-files 实装 `:331-375` |
| P7 | diff 形状 `WorkspaceFileDiff`（hunk `+/-/ `行）公开导出于 `@deepseek-ai/dsh-workspace-changes/types` | `workspace-changes/src/types.ts:43-76` |
| P8 | 官方 `FileDiff.tsx` 未导出 → 同构 ~150 行（hunk 展开 + Shiki + split/unified） | `ui-deliverables/src/client/index.ts` 导出面 |
| P9 | git 纪律：argv 数组、`-z`、超时、stdout 封顶 | `workspace-changes/src/git.ts:8-77` |
| P10 | primitives 备齐：SegmentedTabs/Modal/RiskConfirmation/Input/Menu/Toast/StateDot/Button | `ui-primitives/src/` 目录清单 |
