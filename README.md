# dsh-git-plus

会话详情页的「Git」tab —— 当前会话工作目录是 git 仓库、**或它的子目录里有仓库**时自动出现（`git init` 后 ≤5s），提供完整仓库操作控制台。

## 多仓库工作区（v0.3.0）

会话 cwd 是一个「容器目录」时（自身不是仓库，仓库都在子目录里，例如本机 `traffic/` 下 8 个：7 个一级 + `婚姻测算/婚姻报告` 二级）：

- host 侧 `find -maxdepth 3 -name .git`（剪枝 node_modules / dist / .next / target / vendor / Pods 等，实测本机 10ms 内）发现仓库，3s TTL 缓存
- `/git-info` 返回 `repos: [{ rel, name, branch }]`；`rel` 是相对 cwd 的路径，`""` 表示 cwd 自身是仓库
- 所有 GET/POST 接受 `repo` 参数，git 命令在**选中仓库根**执行；文件路径参数（`f`）以仓库根为基准
- 左栏仓库 chip 在多仓库时变成下拉切换器（显示仓库路径 + 当前分支），单仓库时保持静态 chip
- 切仓库重置视图状态与提交草稿（避免把 A 仓库的提交信息发到 B 仓库）

**安全边界**：`repo` 只按发现结果白名单精确匹配（不做路径拼接信任），命中后 realpath 必须仍落在 cwd 内；**多仓库工作区里写操作必须显式带 `repo`，缺省一律 400**（绝不回落到「第一个」—— discard/checkout/commit 打错仓库不可撤销）；单仓库目录允许缺省，旧行为完全不变。

## 功能

**双栏布局**（GitHub Desktop / Fork 形态）：左栏 260px —— 仓库 chip + 分支 chip、提交搜索框、分支 section（当前分支高亮、点击即切换、底部新建分支）、提交记录时间轴（「工作区改动」固定节点带脏计数 + 日期分组 + 头像 + subject + 作者·相对时间 + sha）；右栏随左栏选中切换两种视图。

**工作区视图**：头部（工作区改动 + 计数 + fetch/pull/push 图标组，无远程时禁用并提示）；Staged / Changes / 未跟踪分段（空段隐藏；摘要行右侧「全部暂存」）；行 = 复选框 | 状态徽标 | 文件图标 | 主名+目录 | ±统计 | ⋯菜单；点行开 diff 覆盖面板（推入/推出同路）；底部 composer 卡（消息 + 生成提交信息 + amend + 提交）。

**commit 详情视图**：头像 + subject + 完整/相对时间 + sha 复制芯片 + body 正文；文件列表卡（点击内联展开该文件 diff）；composer 隐藏。

## 窄屏 / H5（≤1023px，与 dsh-pocket 断点同档）

形态是**单栏 + 面板切换**，不是上下堆叠（旧版把左栏压到 40vh、右栏吃剩余，两边都只剩半截、工作区改动完全看不到）：

- `.dgt-cols` 在窄屏加 `dgt-narrow` 类，靠 `data-pane`（`main` / `side`）只显示一栏；默认 `main`（工作区改动 + 提交框首屏）
- 主区标题行左侧是「‹」返回按钮 → 回提交记录；commit 详情视图（无标题行）单独渲染一条返回条。桌面端两者都 `display:none`
- 点左栏任一提交 / 点文件行都会自动切到 `main`（diff 面板 absolute 覆盖在 `.dgt-main` 内，否则「点了没反应」）
- 触控尺寸：勾选框保持 16px 视觉（旧规则把 `min-width:44px` 套到 checkbox 上，H5 上是一个个空大方框），命中区交给 40px 行高；`miniBtn` / `kebab` / `iconBtn` 32–36px
- 输入类控件字号 16px（iOS 聚焦不自动缩放），提交卡窄屏换行、提交按钮贴右，footer 补 `safe-area-inset-bottom`
- 分支 / 仓库下拉改 `portal`：in-place absolute 会被 `.dgt-cols` 的 `overflow:hidden` 裁掉
- 断点用 `matchMedia`（`useNarrow`）订阅，横竖屏切换 / 桌面拖窄实时换形态

## 动态显隐机制

- client 半边在 `conversation.session.header.utilities`（list slot）挂隐形 Probe（渲染 null 不占位），探测当前会话 cwd 是否 git 仓库。⚠️ 勿挂 single slot：single 只渲染最低 priority 条目，Probe 会永不执行。
- 官方 `slots.inject` 的「等声明」语义保证时序（slot 未声明时不执行、声明后自动 reconcile）。
- 未注册态 5s 轮询 → `git init` 后 ≤5s tab 自动出现；非仓库会话 tab 摘除。
- ⚠️ 轮询必须 `check(true)` 强制绕过 60s probe 缓存：否则首次探测确认「无仓库」后 60s 内不刷新，≤5s 承诺不成立（2026-10-19 修）。
- cwd 由 **host 侧** sessions / sessionQuery 服务解析（`header.cwd`，照 dsh-video-preview 的 `sessionCwdOf` 三级回退）—— client 不依赖 snapshot 形状。

## 架构

```
~/.dsh/local-plugins/dsh-git-plus/
├── lib/index.js   host 半边：/dsh-git-plus 前缀路由（GET 只读 + POST /action 白名单）
└── lib/client.js  client 半边：tab 注册 + 显隐 Probe + 双栏 UI
```

host 路由（全部接受 `repo` 查询参数 / 字段）：

```
GET  /health /git-info /status /file-diff /log /show-diff /branch-list /overview
POST /action   {action: stage|stage-all|unstage|unstage-all|discard|commit|
                amend|switch|create-branch|fetch|pull|push, sessionId, repo, args}
POST /gen-message {sessionId, repo}
```

## 安全纪律

- git 全部 `execFile` argv 数组，无 shell；文件名 `-z` NUL 分隔
- cwd：`sessions.get(sessionId).header.cwd` → `sessionQuery.observeSession` 持久查询 → `cwd` 参数；realpath 归一 + 系统目录拒绝表（`/Volumes` 用户代码卷放行，仅拒 TM 备份挂点）
- 文件参数归一后必须仍在 cwd 内（`..`/绝对/符号链接逃逸 → 403）；分支名过 `git check-ref-format --branch`
- 写操作互斥队列（防 `index.lock` 并发）；读 10s / 写 10s / 网络 30s 超时；stdout 4MB 封顶（超限降级 oversized）
- discard / push / 已推送 amend 走官方 RiskConfirmation 两段确认

## 测试

```bash
node /tmp/dsh-git-plus-host-test.mjs          # 旧基线 55 项（解析器 + scratch 仓库全回路）
node /tmp/dsh-git-plus-multirepo-test.mjs     # 52 项：多仓库发现/排序/白名单/写操作严格 repo/detached HEAD/单仓旧行为/scratch 真写
node /tmp/dsh-git-plus-client-smoke.cjs       # 18 项：假宿主+假 React 渲染冒烟（Probe 探测、多仓库菜单、单仓库 chip）
```

注：`/tmp` 里的测试脚本是草稿，清理后需按本节重建（多仓库回归的核心断言：8 个仓库被发现、缺 repo 的写操作 400、stage 落到指定仓库而不是 alpha、单仓库不传 repo 仍可用）。

## 回滚

删除 desktop profile `cordis.patch.yml` 里的 `dsh-git-plus` insert 块 + `package.json` 依赖行，重启应用。
test-change

---

## ☕ 赞赏支持

如果 dsh-git-plus 对你的研究与测试有所帮助，欢迎请作者喝杯咖啡 ☕

<p align="center">
  <img src="assets/sponsor.jpg" width="260" alt="微信赞赏码" />
  <img src="assets/afdian_reward.jpg" width="200" alt="爱发电赞助码" />
</p>

<p align="center">
  <b>给项目点个 Star ⭐</b> 同样是对开发者最大的鼓励！
</p>
