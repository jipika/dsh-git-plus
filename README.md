# dsh-git-tab

会话详情页的「Git」tab —— 当前会话工作目录是 git 仓库时自动出现（`git init` 后 ≤5s），提供完整仓库操作控制台。

## 功能

**变更页**：Staged / Changes / 未跟踪三段文件列表，每行状态点 + 增删行数 + 操作菜单（stage / unstage / 丢弃 / 查看 diff）；行内展开 diff（Unified / Split 切换，Shiki 语法高亮）；底部 commit 栏（消息 + amend 勾选）。

**历史页**：最近 50 条提交，点提交展开逐文件 diff，一键复制 sha。

**分支页**：本地分支列表（当前分支 + upstream + ahead/behind）、一键切换、新建分支；头部 Fetch / Pull / Push。

## 动态显隐机制

- client 半边在 `conversation.session.header.corner` 挂隐形 Probe（渲染 null 不占位），探测当前会话 cwd 是否 git 仓库。
- 官方 `slots.inject` 的「等声明」语义保证时序（slot 未声明时不执行、声明后自动 reconcile）。
- 未注册态 5s 轮询 → `git init` 后 ≤5s tab 自动出现；非仓库会话 tab 摘除。
- cwd 由 **host 侧** sessions / sessionQuery 服务解析（`header.cwd`，照 dsh-video-preview 的 `sessionCwdOf` 三级回退）—— client 不依赖 snapshot 形状。

## 架构

```
~/.dsh/local-plugins/dsh-git-tab/
├── lib/index.js   host 半边：/dsh-git-tab 前缀路由（GET 只读 + POST /action 白名单）
└── lib/client.js  client 半边：tab 注册 + 显隐 Probe + 三页签 UI
```

host 路由：

```
GET  /health /git-info /status /file-diff /log /show-diff /branch-list
POST /action   {action: stage|stage-all|unstage|unstage-all|discard|commit|
                amend|switch|create-branch|fetch|pull|push, sessionId, args}
```

## 安全纪律

- git 全部 `execFile` argv 数组，无 shell；文件名 `-z` NUL 分隔
- cwd：`sessions.get(sessionId).header.cwd` → `sessionQuery.observeSession` 持久查询 → `cwd` 参数；realpath 归一 + 系统目录拒绝表（`/Volumes` 用户代码卷放行，仅拒 TM 备份挂点）
- 文件参数归一后必须仍在 cwd 内（`..`/绝对/符号链接逃逸 → 403）；分支名过 `git check-ref-format --branch`
- 写操作互斥队列（防 `index.lock` 并发）；读 10s / 写 10s / 网络 30s 超时；stdout 4MB 封顶（超限降级 oversized）
- discard / push / 已推送 amend 走官方 RiskConfirmation 两段确认

## 测试

```bash
node /tmp/dsh-git-tab-host-test.mjs   # 55 项：解析器 + scratch 仓库全回路 + 注入/逃逸/空仓库
```

## 回滚

删除 desktop profile `cordis.patch.yml` 里的 `dsh-git-tab` insert 块 + `package.json` 依赖行，重启应用。
