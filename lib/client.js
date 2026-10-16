/*
 * dsh-git-plus — browser half
 *
 * 会话头部标签行新增「Git」tab（order 16：chat=0 / trajectory=10 / artifacts=15 / 本插件 16 / context=20 / fleet=30）。
 * 显隐策略（默认注册 + 探测修正，「该出现绝不缺席」优先）：
 *   · apply 时直接注册 conversation.view 条目（slots.register 持 dispose）
 *   · Probe 隐形组件挂 conversation.session.header.utilities（session scope list slot，
 *     标准 props 自带 sessionId），探测当前会话 cwd 是否 git 仓库：非仓库 → dispose；仓库 → 保持注册。
 *   · 未注册态 5s 轮询（git init 后 ≤5s 恢复注册）。register/dispose 幂等（标志位守卫，StrictMode 安全）。
 *   · 会话切换瞬间 bridge 保留旧 isRepo 直到新检测完成 —— 有 git 会话零闪烁，无 git 会话短暂残留（1-2s）。
 * cwd 走模块级 bridge（probe 写，GitView 用 useSyncExternalStore 读 version 触发重渲后重读字段；
 * snapshot 返回 number，引用稳定）。
 * 面板 = 双栏（GitHub Desktop / Fork 形态）：左栏仓库+分支+提交时间轴（可搜索），
 * 右栏「工作区改动」（文件列表 + composer + diff 覆盖面板）或 commit 详情（内联展开 diff）。
 */
// 注册说明：不做全局布尔守卫 —— 宿主对同一 URL 的 rev 重注入（HMR/重连）会重新执行本脚本，
// 布尔守卫会让第二次执行静默短路，宿主判定 "loaded without registering" 而失活。
// 正确姿势：每次执行都调 load；同 id 重复注册由宿主抛 duplicate，捕获静默（幂等）。
try {
	window.__ModuleLoader__.load({
		id: "@jipika/dsh-git-plus",
		factory: (require) => {
			var module = { exports: {} };
			var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

			const React = require("react");
			const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React;
			const memo = React.memo;
			const h = React.createElement;
			const prim = require("@deepseek-ai/dsh-client-ui-primitives");
			const Menu = prim.Menu;
			const RiskConfirmation = prim.RiskConfirmation;
			const Toast = prim.Toast;
			const PathLabel = prim.PathLabel;
			const FileTypeIcon = prim.FileTypeIcon;
			const useCodeHighlighter = prim.useCodeHighlighter;
			const languageForPath = prim.languageForPath;
			const writeClipboard = prim.writeClipboard;

			// ── 图标：官方 inline SVG 规范（viewBox 0 0 24 24、stroke currentColor、round 线帽）──
			// 笔画随显示尺寸分档（小尺寸加粗保持视觉重量，≈1.8px 墨迹），对齐官方 1.2–2.4 的浮动习惯。
			const ICON_D = {
				branch: [h("line", { x1: 6, y1: 3, x2: 6, y2: 15 }), h("circle", { cx: 18, cy: 6, r: 3 }), h("circle", { cx: 6, cy: 18, r: 3 }), h("path", { d: "M18 9a9 9 0 0 1-9 9" })],
				chevronDown: [h("path", { d: "m6 9 6 6 6-6" })],
				chevronLeft: [h("path", { d: "m15 18-6-6 6-6" })],
				refresh: [h("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }), h("path", { d: "M21 3v6h-6" })],
				download: [h("path", { d: "M12 3v12" }), h("path", { d: "m7 10 5 5 5-5" }), h("path", { d: "M21 21H3" })],
				upload: [h("path", { d: "M12 15V3" }), h("path", { d: "m7 8 5-5 5 5" }), h("path", { d: "M21 21H3" })],
				copy: [h("rect", { x: 9, y: 9, width: 12, height: 12, rx: 2 }), h("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" })],
				trash: [h("path", { d: "M3 6h18" }), h("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }), h("path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" })],
				sparkles: [h("path", { d: "M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" })],
				dots: [h("circle", { cx: 5, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }), h("circle", { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }), h("circle", { cx: 19, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" })],
				checkCircle: [h("circle", { cx: 12, cy: 12, r: 9 }), h("path", { d: "m8.5 12.5 2.5 2.5 5-5.5" })],
				spinner: [h("path", { d: "M21 12a9 9 0 1 1-9-9" })],
				repo: [h("path", { d: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" })],
				search: [h("circle", { cx: 11, cy: 11, r: 7 }), h("path", { d: "m21 21-4.35-4.35" })],
			};
			function icon(name, size, key) {
				const s = size || 14;
				return h("svg", { key, className: "dgt-ico", width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: Math.round((43 / s) * 10) / 10, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, ICON_D[name]);
			}
			// 相对时间（GitHub Desktop / Fork 惯例）：完整戳放 title，正文只显「N 前」。
			// 宿主 ctx.locale 的 t 支持 {n} 插值（locale/src/client/index.ts:470），直接传 params。
			function relTime(ms, t) {
				const diff = Date.now() - ms;
				if (diff < 60e3) return t("justNow");
				if (diff < 3600e3) return t("minutesAgo", { n: Math.floor(diff / 60e3) });
				if (diff < 86400e3) return t("hoursAgo", { n: Math.floor(diff / 3600e3) });
				if (diff < 7 * 86400e3) return t("daysAgo", { n: Math.floor(diff / 86400e3) });
				return new Date(ms).toLocaleDateString();
			}
			// 日期分组标签（左栏提交时间轴）：今天 / 昨天 / 本地日期
			function dayLabel(ms, t) {
				const d = new Date(ms); const now = new Date();
				const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
				if (same(d, now)) return t("today");
				const y = new Date(now.getTime() - 86400e3);
				if (same(d, y)) return t("yesterday");
				return d.toLocaleDateString();
			}
			// 提交者头像（三层兜底）：host /log 已算好 URL（GitHub noreply → github.com/<u>.png，
			// 其余 → Gravatar md5，d=404）；URL 为空或图片加载失败（404/断网/被墙）→ 首字母圆。
			// 容器尺寸固定，回退不引起布局跳动；img 原生 lazy 限流滚动区外的请求。
			function Avatar(props) {
				const { url, name, big } = props;
				const [failed, setFailed] = useState(false);
				const [prevUrl, setPrevUrl] = useState(url);
				if (prevUrl !== url) { setPrevUrl(url); setFailed(false); } // 选中切换时复位（React 官方 props 变调 state 写法）
				const cls = "dgt-ava" + (big ? " dgt-avaBig" : "");
				if (!url || failed) return h("span", { className: cls }, (name || "?").slice(0, 1).toUpperCase());
				return h("span", { className: cls }, h("img", { className: "dgt-avaImg", src: url, alt: "", loading: "lazy", decoding: "async", onError: () => setFailed(true) }));
			}
			// 动作 id → STRINGS key（toast 全中文用；取值集合 = host ACTION_ALIASES 白名单）
			const ACTION_LABEL = {
				stage: "stage", "stage-all": "stageAll", unstage: "unstage", "unstage-all": "unstageAll",
				discard: "discard", commit: "commit", amend: "amend", switch: "switchTo",
				"create-branch": "createSwitch", fetch: "fetch", pull: "pull", push: "push",
			};

			const NS = "gittab";
			const VIEW_SLOT = "conversation.view";
			// probe 挂 utilities（kind:'list'，apply.ts:406）：single slot（header.corner，
			// apply.ts:407）整个 slot 是一个 cell、只渲染最低 priority 条目 —— probe 与官方
			// ExpandButton（priority 0）同 cell 竞争必输 → 永不渲染 → useEffect 不跑 →
			// isRepo 恒 false（非 git 会话 tab 不摘除 + git 会话内容不显示，2026-10-15 回归）。
			// list slot 每 id 一 cell、全部 cell 渲染（renderer.ts:149），"git-probe" 独占
			// 自己的 cell 必然渲染；probe 本体 return null 不占位。session scope 槽位由框架
			// 注入 sessionId（ui-slots index.ts:614），Probe 的探测逻辑不变。
			const PROBE_SLOT = "conversation.session.header.utilities";
			const VIEW_ID = "git";
			const VIEW_ORDER = 16;
			const ROUTE = "/dsh-git-plus";

			const STRINGS = {
				zh: {
					title: "Git",
					checking: "检测仓库…",
					notRepo: "当前目录不是 Git 仓库",
					emptyRepo: "工作区干净 · 无未提交改动",
					staged: "已暂存",
					changes: "更改",
					untracked: "未跟踪",
					stageAll: "全部暂存",
					unstageAll: "全部取消暂存",
					stage: "暂存",
					unstage: "取消暂存",
					discard: "丢弃改动",
					viewDiff: "查看 diff",
					hideDiff: "收起 diff",
					commitMsg: "提交消息…",
					commit: "提交",
					amend: "修订上一次提交",
					dirtyWorktree: "先暂存改动再提交",
					history: "历史",
					branch: "分支",
					changesTab: "变更",
					fetch: "拉取",
					pull: "同步",
					push: "推送",
					genMsg: "生成提交信息",
					genMsgBusy: "正在生成…",
					genEmpty: "暂存区为空，先生成需要已暂存的改动",
					switchTo: "切换",
					current: "当前分支",
					newBranch: "输入新分支名…",
					createSwitch: "创建并切换",
					copySha: "复制 sha",
					binary: "二进制文件，不显示 diff",
					oversized: "文件过大，diff 省略",
					truncated: "diff 超长被截断",
					coarse: "对比超时，粗粒度展示",
					unified: "统一视图",
					split: "分栏视图",
					discardTitle: "丢弃未提交改动？",
					discardDesc: "将永久丢弃 {path} 的未提交改动（含暂存区），无法从本面板恢复。",
					acknowledge: "我已了解该操作不可恢复",
					cancel: "取消",
					confirm: "确认执行",
					close: "关闭",
					pushTitle: "推送到远程？",
					pushDesc: "将把当前分支推送到远程仓库。",
					confirmPush: "确认推送",
					upstreamNone: "（无 upstream，将自动 -u origin）",
					amendWarnTitle: "amend 已推送的提交？",
					amendWarnDesc: "该提交已推送到远程，amend 后需要 force push 才能同步，会影响其他协作者。",
					busy: "处理中…",
					created: "已创建分支",
					switched: "已切换",
					done: "完成",
					reload: "重试",
					failed: "失败",
					genWarn: "生成结果首行不含常规类型标记，已按原样填入，可自行修改",
					more: "更多操作",
					binaryShort: "二进制",
					files: "个文件",
					justNow: "刚刚",
					minutesAgo: "{n} 分钟前",
					hoursAgo: "{n} 小时前",
					daysAgo: "{n} 天前",
					actionDone: "{action}完成",
					noCommits: "尚无提交",
					noRemote: "未配置远程仓库",
					notRepoSub: "在 Git 仓库目录的会话中会自动出现",
					emptyRepoSub: "改动的文件会出现在这里",
					noCommitsSub: "提交历史会出现在这里",
					workingChanges: "工作区改动",
					branchesTitle: "分支",
					commitsTitle: "提交记录",
					searchCommits: "搜索提交信息…",
					noMatches: "无匹配结果",
					today: "今天",
					yesterday: "昨天",
				},
				en: {
					title: "Git",
					checking: "Detecting repository…",
					notRepo: "Current directory is not a Git repository",
					emptyRepo: "Working tree clean · nothing to commit",
					staged: "Staged",
					changes: "Changes",
					untracked: "Untracked",
					stageAll: "Stage all",
					unstageAll: "Unstage all",
					stage: "stage",
					unstage: "unstage",
					discard: "Discard changes",
					viewDiff: "View diff",
					hideDiff: "Hide diff",
					commitMsg: "Commit message…",
					commit: "Commit",
					amend: "amend last commit",
					dirtyWorktree: "Stage changes before committing",
					history: "History",
					branch: "Branches",
					changesTab: "Changes",
					fetch: "Fetch",
					pull: "Pull",
					push: "Push",
					genMsg: "Generate message",
					genMsgBusy: "Generating…",
					genEmpty: "Stage changes first — generation needs staged diffs",
					genWarn: "Generated message lacks a conventional type prefix; edit as needed",
					more: "More actions",
					switchTo: "Switch",
					current: "Current",
					newBranch: "New branch name…",
					createSwitch: "Create & switch",
					copySha: "Copy sha",
					binary: "Binary file — diff not shown",
					oversized: "File too large — diff omitted",
					truncated: "Diff truncated (too large)",
					coarse: "Comparison timed out — coarse view",
					unified: "统一视图",
					split: "分栏视图",
					discardTitle: "Discard uncommitted changes?",
					discardDesc: "This permanently discards uncommitted changes of {path} (staged included). Not recoverable from this panel.",
					acknowledge: "I understand this cannot be undone",
					cancel: "Cancel",
					confirm: "Confirm",
					close: "Close",
					pushTitle: "Push to remote?",
					pushDesc: "Push the current branch to the remote repository.",
					confirmPush: "Push now",
					upstreamNone: "(no upstream — will push -u origin)",
					amendWarnTitle: "Amend a pushed commit?",
					amendWarnDesc: "This commit is already pushed. Amending requires force push and affects collaborators.",
					busy: "Working…",
					binaryShort: "binary",
					created: "Branch created",
					justNow: "just now",
					minutesAgo: "{n} min ago",
					hoursAgo: "{n} h ago",
					daysAgo: "{n} d ago",
					actionDone: "{action} done",
					noCommits: "No commits yet",
					noRemote: "No remote configured",
					notRepoSub: "Appears automatically in sessions opened in a Git repository",
					emptyRepoSub: "Changed files will appear here",
					noCommitsSub: "Commit history will appear here",
					workingChanges: "Working Changes",
					branchesTitle: "Branches",
					commitsTitle: "Commits",
					searchCommits: "Search commits…",
					noMatches: "No matches",
					today: "Today",
					yesterday: "Yesterday",
					switched: "Switched",
					done: "Done",
					reload: "Retry",
					files: "files",
					failed: "Failed",
				},
			};

			// ── 样式（全部锚 .dgt-*）────────────────────────────────────
			function installStyle() {
				// 幂等策略：移除旧元素再注入（不做存在性短路——旧版本残留的 style 元素
				// 内容可能是过时/空 CSS，存在性守卫会让新样式永远注入不进去）
				const existing = document.getElementById("dsh-git-plus-style");
				if (existing !== null) existing.remove();
				const el = document.createElement("style");
				el.id = "dsh-git-plus-style";
				// 设计基准：macOS source-control 工具（Xcode / Fork / GitHub Desktop）× Apple HIG。
				//   · 双栏：左 260px（仓库 chip + 搜索 + 分支 section + 提交时间轴），右主区（工作区视图 / commit 详情视图）
				//   · 文件行 = 复选框 | 徽标 | 文件名+目录 | ±统计 | ⋯；commit 文件行点击内联展开 diff
				//   · 工作区 diff 详情 = 覆盖面板推入/推出同路（spatial consistency）
				//   · 颜色 / 圆角 / 阴影 / 字号全部走 --dsw-* 官方 token，换主题自动跟随
				el.textContent = [
					// ── 骨架 ─────────────────────────────────────────
					// 高度：宿主 .Sy5rKG_root[data-phase=active] 把 viewArea 覆盖为 flex:1 0 auto（随内容撑高、
					// 整页滚），height:100% 会塌陷 → 无法内滚。策略：默认 flex:1 0 auto（父级若给了约束高就
					// 自然填满）；GitView 运行时量测外层 scroller，若 root 被内容撑高困在页滚里（trapped），
					// 切 position:absolute 脱离文档流 + inline height=scroller 可视高（inset 0 对齐 scrollBody
					// 内容盒，与产物页同机制），从此 root 自身 overflow:hidden 内滚，永不回撑。
					`.dgt-root{position:relative;display:flex;flex-direction:column;flex:1 0 auto;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}`,
					`.dgt-root ::-webkit-scrollbar{width:8px;height:8px}`,
					`.dgt-root ::-webkit-scrollbar-thumb{border-radius:4px;background:var(--dsh-scrollbar-thumb)}`,
					`.dgt-root ::-webkit-scrollbar-thumb:hover{background:var(--dsh-scrollbar-thumb-hover)}`,
					`.dgt-root ::-webkit-scrollbar-track{background:transparent}`,
					// ── 双栏骨架（GitHub Desktop / Fork 形态）─────────────
					`.dgt-cols{flex:1;min-height:0;display:flex;overflow:hidden}`,
					`.dgt-side{flex:none;width:260px;display:flex;flex-direction:column;border-right:0.5px solid var(--dsw-alias-border-l2)}`,
					`.dgt-sideHead{flex:none;display:flex;align-items:center;gap:6px;padding:8px 12px 0}`,
					`.dgt-repoChip{display:inline-flex;align-items:center;gap:5px;min-width:0;height:26px;padding:0 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}`,
					`.dgt-repoChip .dgt-chipName{color:var(--dsw-alias-label-primary);font-weight:500;max-width:96px}`,
					`.dgt-chipName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-searchWrap{flex:none;position:relative;margin:8px 12px 2px}`,
					`.dgt-searchIco{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:inline-flex;color:var(--dsw-alias-label-tertiary);pointer-events:none}`,
					`.dgt-search{width:100%;height:28px;padding:0 8px 0 26px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);box-sizing:border-box;transition:border-color .12s ease}`,
					`.dgt-search::placeholder{color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}`,
					// 左栏两段各自内滚：分支区限高上滚（分支多时不顶掉时间轴），时间轴吃满剩余高度。
					`.dgt-brScroll{flex:none;max-height:38%;overflow:auto}`,
					`.dgt-tlScroll{flex:1;min-height:0;overflow:auto;padding-bottom:12px}`,
					`.dgt-sideSection{margin-top:10px}`,
					`.dgt-sideHead2{padding:4px 12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-strong-11);letter-spacing:.04em;text-transform:uppercase}`,
					`.dgt-sideEmpty{padding:8px 12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}`,
					// ── 左栏分支行 ────────────────────────────────────
					`.dgt-brRow{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 12px;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;transition:background .12s ease}`,
					`.dgt-brRow:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-brRow:disabled{cursor:default}`,
					`.dgt-brRow:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}`,
					`.dgt-brRowCurrent{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent)}`,
					`.dgt-brName{flex:1;display:flex;align-items:center;gap:7px;min-width:0;color:var(--dsw-alias-label-primary)}`,
					`.dgt-brName .dgt-ico{color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-brLabel{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-brPill{flex:none;display:inline-flex;align-items:center;height:16px;padding:0 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary);font:var(--dsw-font-xxxs-strong-11)}`,
					`.dgt-newBranch{display:flex;gap:6px;align-items:center;padding:6px 12px 0}`,
					`.dgt-input{flex:1;min-width:0;height:28px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);transition:border-color .12s ease}`,
					`.dgt-input::placeholder{color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}`,
					`.dgt-primaryBtn{display:inline-flex;align-items:center;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xxs-12);cursor:pointer;transition:background .12s ease,transform .1s ease;white-space:nowrap}`,
					`.dgt-primaryBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}`,
					`.dgt-primaryBtn:active:not(:disabled){transform:scale(.98)}`,
					`.dgt-primaryBtn:disabled{opacity:.35;cursor:not-allowed}`,
					// ── 左栏提交时间轴 ────────────────────────────────
					`.dgt-tlItem{display:flex;width:100%;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}`,
					`.dgt-tlItem:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px;border-radius:var(--dsw-radius-sm)}`,
					`.dgt-tlRail{flex:none;width:20px;display:flex;flex-direction:column;align-items:center;padding-top:13px}`,
					`.dgt-tlDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-bg-base);border:1.5px solid var(--dsw-alias-label-tertiary);flex:none}`,
					`.dgt-tlLine{flex:1;width:1px;background:var(--dsw-alias-border-l2);margin-top:2px}`,
					`.dgt-tlCard{flex:1;min-width:0;display:flex;align-items:center;gap:8px;margin:3px 8px 3px 4px;padding:6px 8px;border-radius:var(--dsw-radius-sm);transition:background .12s ease}`,
					`.dgt-tlItem:hover .dgt-tlCard{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-tlSel .dgt-tlCard{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}`,
					`.dgt-tlSel .dgt-tlDot{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary)}`,
					`.dgt-tlSel .dgt-tlSubject{color:var(--dsw-alias-state-business-primary)}`,
					`.dgt-tlText{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}`,
					`.dgt-tlSubject{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-tlMeta{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-tlSha{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:10px}`,
					`.dgt-tlDay{padding:8px 12px 2px 24px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}`,
					`.dgt-ava{flex:none;width:22px;height:22px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);color:var(--dsw-alias-state-business-primary);font:var(--dsw-font-xxxs-strong-11)}`,
					`.dgt-avaBig{width:32px;height:32px;font:var(--dsw-font-xs-strong-13)}`,
					`.dgt-avaImg{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}`,
					// ── 右主区 ────────────────────────────────────────
					`.dgt-main{flex:1;min-width:0;position:relative;display:flex;flex-direction:column;overflow:hidden}`,
					`.dgt-wHead{flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 12px 0 16px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}`,
					`.dgt-wTitle{font:var(--dsw-font-xs-strong-13)}`,
					`.dgt-iconBtn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;min-width:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease}`,
					`.dgt-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
					`.dgt-iconBtn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}`,
					`.dgt-iconBtn:disabled{opacity:.4;cursor:not-allowed}`,
					`.dgt-iconBtn:focus-visible,.dgt-miniBtn:focus-visible,.dgt-menuBtn:focus-visible,.dgt-qbtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}`,
					`.dgt-badgeN{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-strong-11);font-variant-numeric:tabular-nums}`,
					`.dgt-body{flex:1;min-height:0;overflow:auto;padding:8px 0 14px;box-sizing:border-box}`,
					`.dgt-listView{display:flex;flex-direction:column;transition:transform .26s cubic-bezier(.32,.72,0,1),opacity .26s ease}`,
					`.dgt-listPushed{transform:translateX(-12%);opacity:.4;pointer-events:none}`,
					`.dgt-toolRow{display:flex;align-items:center;gap:10px;height:30px;padding:0 12px 0 16px;flex:none}`,
					`.dgt-toolStat{display:flex;align-items:baseline;gap:5px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}`,
					`.dgt-toolStat .dgt-add{color:var(--dsw-alias-state-success-primary);font-weight:500;font-variant-numeric:tabular-nums}`,
					`.dgt-toolStat .dgt-del{color:var(--dsw-alias-state-error-primary);font-weight:500;font-variant-numeric:tabular-nums}`,
					`.dgt-toolStat .dgt-files{color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-toolSpacer{flex:1}`,
					`.dgt-section{margin-bottom:4px}`,
					`.dgt-sectionHead{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px 0 16px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-strong-11);letter-spacing:.04em;text-transform:uppercase;border-bottom:0.5px solid var(--dsw-alias-border-l2)}`,
					`.dgt-sectionCount{color:var(--dsw-alias-label-tertiary);font-weight:400;text-transform:none;letter-spacing:0}`,
					`.dgt-sectionSpacer{flex:1}`,
					`.dgt-miniBtn{display:inline-flex;align-items:center;height:22px;padding:0 9px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;text-transform:none;letter-spacing:0;white-space:nowrap;transition:background .12s ease,color .12s ease}`,
					`.dgt-miniBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
					`.dgt-miniBtn:disabled{opacity:.4;cursor:not-allowed}`,
					`.dgt-miniBtnPrimary{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary))}`,
					`.dgt-card{margin:0;padding:0;list-style:none}`,
					`.dgt-row{display:flex;align-items:center;min-height:30px;padding:0 12px 0 16px;transition:background .12s ease}`,
					`.dgt-row:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-rowActive{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-check{flex:none;width:16px;height:16px;margin:0 10px 0 0;padding:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}`,
					`.dgt-check:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}`,
					`.dgt-rowBtn{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}`,
					`.dgt-rowBtn:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}`,
					`.dgt-badge{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;border-radius:5px;font-size:10px;font-weight:700;line-height:1}`,
					`.dgt-badgeM{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent)}`,
					`.dgt-badgeA{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent)}`,
					`.dgt-badgeD{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent)}`,
					`.dgt-badgeR{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent)}`,
					`.dgt-badgeU{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-active)}`,
					`.dgt-fileicon{flex:none;display:flex;color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-nameWrap{min-width:0;display:flex;align-items:baseline;gap:6px;overflow:hidden;white-space:nowrap}`,
					`.dgt-baseName{flex:none;font-weight:500}`,
					`.dgt-dirName{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}`,
					`.dgt-stat{flex:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;white-space:nowrap}`,
					`.dgt-stat .dgt-add{color:var(--dsw-alias-state-success-primary)}`,
					`.dgt-stat .dgt-del{color:var(--dsw-alias-state-error-primary)}`,
					`.dgt-kebab{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer;opacity:0;transition:opacity .12s ease,background .12s ease,color .12s ease}`,
					`.dgt-row:hover .dgt-kebab,.dgt-kebab[aria-expanded="true"],.dgt-kebab:focus-visible{opacity:1}`,
					`.dgt-kebab:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}`,
					// ── commit 详情视图 ───────────────────────────────
					`.dgt-cd{padding:14px 16px 4px}`,
					`.dgt-cdHead{display:flex;align-items:flex-start;gap:10px}`,
					`.dgt-cdTitleWrap{flex:1;min-width:0}`,
					`.dgt-cdSubject{font-size:14px;font-weight:600;line-height:22px;overflow-wrap:anywhere}`,
					`.dgt-cdMeta{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);margin-top:2px}`,
					`.dgt-shaChip{flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);cursor:pointer;transition:background .12s ease,color .12s ease}`,
					`.dgt-shaChip:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}`,
					`.dgt-shaMono{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace)}`,
					`.dgt-cdBody{margin:10px 0 0 42px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);white-space:pre-wrap;overflow-wrap:anywhere}`,
					`.dgt-cdSum{padding:14px 0 6px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);font-variant-numeric:tabular-nums}`,
					`.dgt-cdFile{border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);margin-bottom:6px;overflow:hidden}`,
					`.dgt-cdRow{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 12px;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .12s ease}`,
					`.dgt-cdRow:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-cdRow:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}`,
					`.dgt-caret{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .12s ease}`,
					`.dgt-cdRow[aria-expanded="true"] .dgt-caret{transform:rotate(180deg)}`,
					`.dgt-cdDiff{border-top:0.5px solid var(--dsw-alias-border-l2);overflow-x:auto;padding:2px 0 6px}`,
					// ── 提交区 composer（仅工作区视图）──────────────────
					`.dgt-footer{flex:none;border-top:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}`,
					`.dgt-commitInner{margin:0;padding:10px 12px 12px 16px;display:flex}`,
					`.dgt-commitCard{flex:1;min-width:0;border-radius:var(--dsw-radius-md);border:0.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);transition:border-color .12s ease}`,
					`.dgt-commitCard:focus-within{border-color:var(--dsw-alias-state-business-primary)}`,
					`.dgt-msg{display:block;width:100%;min-height:44px;max-height:140px;resize:none;padding:9px 12px 2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);box-sizing:border-box}`,
					`.dgt-msg::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-markdown-placeholder))}`,
					`.dgt-msg:focus{outline:none}`,
					`.dgt-msgRow{display:flex;align-items:center;gap:10px;padding:4px 10px 9px}`,
					`.dgt-genBtn{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-link,var(--dsw-alias-brand-primary));font:var(--dsw-font-xxs-12);font-weight:500;cursor:pointer;transition:background .12s ease}`,
					`.dgt-genBtn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}`,
					`.dgt-genBtn:disabled{opacity:.45;cursor:default}`,
					`.dgt-msgSpacer{flex:1}`,
					`.dgt-amend{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;user-select:none}`,
					`.dgt-amend input{margin:0;accent-color:var(--dsw-alias-brand-primary)}`,
					`.dgt-commitBtn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 16px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xs-strong-13);cursor:pointer;transition:background .12s ease,transform .1s ease;white-space:nowrap}`,
					`.dgt-commitBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}`,
					`.dgt-commitBtn:active:not(:disabled){transform:scale(.98)}`,
					`.dgt-commitBtn:disabled{opacity:.35;cursor:not-allowed}`,
					`.dgt-branchIcon{display:inline-flex;color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-ico{display:inline-block;flex:none;vertical-align:-2px}`,
					`.dgt-spin{display:inline-flex;animation:dgtSpin .9s linear infinite}`,
					`@keyframes dgtSpin{to{transform:rotate(360deg)}}`,
					`.dgt-track{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}`,
					// ── diff 覆盖面板（工作区文件详情）──────────────────
					`.dgt-panel{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);animation:dgtPanelIn .28s cubic-bezier(.32,.72,0,1) both}`,
					`.dgt-panelOut{animation:dgtPanelOut .22s cubic-bezier(.32,.72,0,1) both}`,
					`@keyframes dgtPanelIn{from{transform:translateX(18%);opacity:.4}to{transform:none;opacity:1}}`,
					`@keyframes dgtPanelOut{to{transform:translateX(24%);opacity:0}}`,
					`.dgt-panelBar{flex:none;display:flex;align-items:center;gap:10px;height:44px;padding:0 12px;background:var(--dsw-alias-bg-base);border-bottom:0.5px solid var(--dsw-alias-border-l2)}`,
					`.dgt-backBtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;cursor:pointer;transition:background .12s ease,color .12s ease}`,
					`.dgt-backBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
					`.dgt-backBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}`,
					`.dgt-panelFile{display:flex;align-items:baseline;gap:7px;min-width:0;overflow:hidden;white-space:nowrap;font-weight:500}`,
					`.dgt-panelBar .dgt-toolSpacer{flex:1}`,
					`.dgt-panelBar .dgt-stat{font:var(--dsw-font-xxs-12)}`,
					`.dgt-menuBtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:pointer;transition:background .12s ease,color .12s ease}`,
					`.dgt-menuBtn:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}`,
					`.dgt-qbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}`,
					`.dgt-qbtn:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}`,
					`.dgt-qbtnDanger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}`,
					`.dgt-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}`,
					// ── diff 行渲染（对齐官方 FileDiff.module.css）──────
					`.dgt-diffBody{padding:8px 0 16px;font:var(--dsw-font-markdown-code-block)}`,
					`.dgt-line{display:grid;grid-template-columns:3px 3.5em minmax(max-content,100%);box-sizing:border-box;min-width:100%;width:max-content;min-height:22px;line-height:22px;white-space:pre}`,
					`.dgt-marker{width:3px}`,
					`.dgt-markerAdd{background:var(--dsw-alias-file-diff-added-marker)}`,
					`.dgt-markerDel{background:var(--dsw-alias-file-diff-deleted-marker)}`,
					`.dgt-no{padding-right:8px;text-align:right;color:var(--dsw-alias-label-tertiary);user-select:none;font-variant-numeric:tabular-nums}`,
					`.dgt-code{padding-right:16px;min-width:0;white-space:pre}`,
					`.dgt-lineAdd{background:var(--dsw-alias-file-diff-added-bg)}`,
					`.dgt-lineDel{background:var(--dsw-alias-file-diff-deleted-bg)}`,
					`.dgt-lineAdd .dgt-no{background:var(--dsw-alias-file-diff-added-gutter);color:var(--dsw-alias-file-diff-added-marker)}`,
					`.dgt-lineDel .dgt-no{background:var(--dsw-alias-file-diff-deleted-gutter);color:var(--dsw-alias-file-diff-deleted-marker)}`,
					`.dgt-ctxCode{color:var(--dsw-alias-label-secondary)}`,
					`.dgt-wDel{background:color-mix(in srgb,var(--dsw-alias-file-diff-deleted-marker) 26%,transparent);color:inherit;border-radius:2px}`,
					`.dgt-wAdd{background:color-mix(in srgb,var(--dsw-alias-file-diff-added-marker) 26%,transparent);color:inherit;border-radius:2px}`,
					`.dgt-hunk{padding:4px 16px;color:var(--dsw-alias-label-tertiary);white-space:pre}`,
					`.dgt-hunkGap{height:8px}`,
					// ── 空态 / 错误 / toast ────────────────────────────
					`.dgt-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:220px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);text-align:center}`,
					`.dgt-emptyText{display:flex;flex-direction:column;align-items:center;gap:2px}`,
					`.dgt-emptySub{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}`,
					`.dgt-emptyIcon{display:inline-flex;color:var(--dsw-alias-label-tertiary);opacity:.45}`,
					`.dgt-content{max-width:920px;margin:0 auto}`,
					`.dgt-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:9999;max-width:60%;padding:8px 16px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-toast-bg,var(--dsw-alias-label-primary));color:var(--dsw-alias-toast-label,var(--dsw-alias-bg-base));font:var(--dsw-font-xxs-12);box-shadow:var(--dsw-elevation-prominent,0 6px 20px rgba(0,0,0,.18));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-toastErr{background:var(--dsw-alias-state-error-primary);color:#fff}`,
					`@media (prefers-reduced-motion:reduce){.dgt-panel,.dgt-panelOut{animation:none}.dgt-spin{animation:none}.dgt-listView{transition:none}.dgt-commitBtn,.dgt-miniBtn,.dgt-iconBtn,.dgt-genBtn,.dgt-kebab,.dgt-check,.dgt-row,.dgt-msg,.dgt-input,.dgt-search,.dgt-backBtn,.dgt-brRow,.dgt-tlCard,.dgt-menuBtn,.dgt-primaryBtn,.dgt-qbtn,.dgt-caret{transition:none}}`,
				].join("\n");
				document.head.appendChild(el);
			}

			// ── API ─────────────────────────────────────────────────────
			async function apiGet(pathname, params) {
				const res = await fetch(ROUTE + pathname + "?" + new URLSearchParams(params));
				return res.json();
			}
			async function apiAction(sessionId, action, args) {
				const res = await fetch(ROUTE + "/action", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action, sessionId, args: args ?? {} }),
				});
				return res.json();
			}

			// ── 显隐 bridge（probe 写，GitView 读；snapshot 为 number，稳定）──
			const bridge = {
				sessionId: null,
				cwd: null,
				isRepo: false,
				version: 0,
				listeners: new Set(),
				patch(next) {
					let changed = false;
					for (const k of Object.keys(next)) {
						if (this[k] !== next[k]) { this[k] = next[k]; changed = true; }
					}
					if (changed) {
						this.version += 1;
						for (const fn of this.listeners) fn();
					}
					return changed;
				},
				subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
				snapshot() { return this.version; },
			};

			// diff 内容缓存：点开过的文件秒开（path+area 键）
			const diffCache = new Map(); // key -> { diff, at }
			const DIFF_CACHE_MAX = 40;
			function diffCachePut(key, diff) {
				if (diffCache.size >= DIFF_CACHE_MAX) diffCache.delete(diffCache.keys().next().value);
				diffCache.set(key, { diff, at: Date.now() });
			}

			// ── 仓库数据缓存（VSCode SCM 模式：状态常驻内存，切视图不重查）──
			// repoCache 按 cwd 分区：GitView 挂载先同步渲染缓存（stale），后台刷新（revalidate）。
			// probeCache 按 sessionId：切换会话时 probe 先用缓存值同步 patch bridge，再异步验证。
			const repoCache = new Map(); // cwd -> { status, commits, branches, at }
			const REPO_CACHE_MAX = 30;
			const probeCache = new Map(); // sessionId -> { cwd, isRepo, at }
			const PROBE_CACHE_TTL = 60_000;

			function repoCachePut(cwd, data) {
				if (repoCache.size >= REPO_CACHE_MAX) repoCache.delete(repoCache.keys().next().value);
				repoCache.set(cwd, { ...data, at: Date.now() });
			}
			function repoCacheGet(cwd) {
				return repoCache.get(cwd) ?? null;
			}

			// ── diff 行展开（照官方 FileDiff hunkRows/splitRows 同构）───
			function hunkRows(hunk) {
				let oldNo = hunk.oldStart;
				let newNo = hunk.newStart;
				return hunk.lines.map((line) => {
					const text = line.slice(1);
					if (line.startsWith("+")) return { kind: "add", old: undefined, new: newNo++, text };
					if (line.startsWith("-")) return { kind: "del", old: oldNo++, new: undefined, text };
					return { kind: "context", old: oldNo++, new: newNo++, text };
				});
			}
			function splitRows(rows) {
				const out = [];
				let i = 0;
				while (i < rows.length) {
					const row = rows[i];
					if (row.kind === "context") {
						out.push({ left: { no: row.old, text: row.text, kind: "context" }, right: { no: row.new, text: row.text, kind: "context" } });
						i += 1;
						continue;
					}
					const dels = [];
					const adds = [];
					while (i < rows.length && rows[i].kind === "del") { dels.push(rows[i]); i += 1; }
					while (i < rows.length && rows[i].kind === "add") { adds.push(rows[i]); i += 1; }
					const pair = Math.max(dels.length, adds.length);
					for (let k = 0; k < pair; k += 1) {
						out.push({
							left: dels[k] ? { no: dels[k].old, text: dels[k].text, kind: "del" } : undefined,
							right: adds[k] ? { no: adds[k].new, text: adds[k].text, kind: "add" } : undefined,
						});
					}
				}
				return out;
			}

			/**
			 * 行内 word-diff（简化版）：对配对的 -/+ 行做公共前/后缀提取，中段差异着色。
			 * 前后缀字符级比对（中文/代码均适用）；配不上（N:M 多行）返回 null 走整行渲染。
			 */
			function wordDiff(delText, addText) {
				if (typeof delText !== "string" || typeof addText !== "string") return null;
				if (delText === "" || addText === "") return null;
				const minLen = Math.min(delText.length, addText.length);
				let start = 0;
				while (start < minLen && delText[start] === addText[start]) start += 1;
				if (start > 40 || (minLen - start) < 2) return null; // 前缀过长/几乎相同：不值得着色
				let end = 0;
				while (end < minLen - start && delText[delText.length - 1 - end] === addText[addText.length - 1 - end]) end += 1;
				const delMid = delText.slice(start, delText.length - end);
				const addMid = addText.slice(start, addText.length - end);
				if (delMid === "" && addMid === "") return null;
				return { pre: delText.slice(0, start), delMid, addMid, post: delText.slice(delText.length - end) };
			}

			/** 把 hunk 行重组为渲染单元：context 直渲染；相邻 del 块+add 块按序配对做 word-diff。 */
			function buildDiffUnits(lines) {
				const units = [];
				let i = 0;
				while (i < lines.length) {
					const line = lines[i];
					if (line[0] === " ") { units.push({ type: "ctx", text: line.slice(1) }); i += 1; continue; }
					if (line[0] === "\\") { i += 1; continue; } // "\ No newline at end of file" 不渲染
					const dels = [];
					const adds = [];
					while (i < lines.length && lines[i][0] === "-") { dels.push(lines[i].slice(1)); i += 1; }
					while (i < lines.length && lines[i][0] === "+") { adds.push(lines[i].slice(1)); i += 1; }
					if (dels.length === 0 && adds.length === 0) { i += 1; continue; }
					const pair = Math.min(dels.length, adds.length);
					for (let k = 0; k < pair; k += 1) {
						const wd = wordDiff(dels[k], adds[k]);
						if (wd !== null) units.push({ type: "pair", wd });
						else {
							units.push({ type: "del", text: dels[k] });
							units.push({ type: "add", text: adds[k] });
						}
					}
					for (let k = pair; k < dels.length; k += 1) units.push({ type: "del", text: dels[k] });
					for (let k = pair; k < adds.length; k += 1) units.push({ type: "add", text: adds[k] });
				}
				return units;
			}

			function spansRender(spans, fallback) {
				if (!Array.isArray(spans) || spans.length === 0) return fallback;
				return spans.map((span, i) => h("span", { key: i, style: span.style }, span.text));
			}

			// ── DiffView v3：单侧行号 + 左缘改动指示条 + word-diff 行内高亮（Xcode 风格）──
			let tRef = (k) => k;

			function DiffView(props) {
				const { diff } = props;
				const highlighter = typeof useCodeHighlighter === "function"
					? useCodeHighlighter(typeof languageForPath === "function" ? languageForPath(diff.path) : undefined)
					: undefined;
				const ctxSpans = useMemo(() => {
					if (typeof highlighter !== "function" || !diff.hunks) return null;
					const src = [];
					for (const hunk of diff.hunks) {
						for (const line of hunk.lines) {
							if (line[0] === " ") src.push(line.slice(1));
						}
					}
					if (src.length === 0) return null;
					return highlighter(src.join("\n"));
				}, [highlighter, diff]);
				let ctxIdx = 0;
				const ctxSpanOf = () => {
					const sp = ctxSpans && ctxSpans[ctxIdx];
					ctxIdx += 1;
					return Array.isArray(sp) && sp.length > 0 ? sp : null;
				};

				if (diff.kind === "binary") return h("div", { className: "dgt-empty" }, tRef("binary"));
				if (diff.kind === "oversized") return h("div", { className: "dgt-empty" }, tRef("oversized"));

				return h("div", { className: "dgt-diffBody" },
					diff.hunks.map((hunk, hi) => {
						const hunkHead = h("div", { className: "dgt-hunk", key: "h" + hi },
							"@@ -" + hunk.oldStart + "," + hunk.oldLines + " +" + hunk.newStart + "," + hunk.newLines + " @@");
						const units = buildDiffUnits(hunk.lines);
						const rows = [];
						let oldNo = hunk.oldStart;
						let newNo = hunk.newStart;
						for (let ui = 0; ui < units.length; ui += 1) {
							const u = units[ui];
							const key = hi + "-" + ui;
							if (u.type === "ctx") {
								const spans = ctxSpanOf();
								rows.push(h("div", { className: "dgt-line", key },
									h("span", { className: "dgt-marker" }),
									h("span", { className: "dgt-no" }, String(newNo)),
									h("span", { className: "dgt-code dgt-ctxCode" }, spansRender(spans, u.text)),
								));
								oldNo += 1; newNo += 1;
							} else if (u.type === "pair") {
								rows.push(h("div", { className: "dgt-line dgt-lineDel", key: key + "d" },
									h("span", { className: "dgt-marker dgt-markerDel" }),
									h("span", { className: "dgt-no" }, String(oldNo)),
									h("span", { className: "dgt-code" },
										h("span", null, u.wd.pre),
										h("span", { className: "dgt-wDel" }, u.wd.delMid),
										h("span", null, u.wd.post),
									),
								));
								rows.push(h("div", { className: "dgt-line dgt-lineAdd", key: key + "a" },
									h("span", { className: "dgt-marker dgt-markerAdd" }),
									h("span", { className: "dgt-no" }, String(newNo)),
									h("span", { className: "dgt-code" },
										h("span", null, u.wd.pre),
										h("span", { className: "dgt-wAdd" }, u.wd.addMid),
										h("span", null, u.wd.post),
									),
								));
								oldNo += 1; newNo += 1;
							} else if (u.type === "del") {
								rows.push(h("div", { className: "dgt-line dgt-lineDel", key },
									h("span", { className: "dgt-marker dgt-markerDel" }),
									h("span", { className: "dgt-no" }, String(oldNo)),
									h("span", { className: "dgt-code" }, u.text),
								));
								oldNo += 1;
							} else {
								rows.push(h("div", { className: "dgt-line dgt-lineAdd", key },
									h("span", { className: "dgt-marker dgt-markerAdd" }),
									h("span", { className: "dgt-no" }, String(newNo)),
									h("span", { className: "dgt-code" }, u.text),
								));
								newNo += 1;
							}
						}
						return [hunkHead, rows];
					}),
				);
			}

			// ── 内滚高度：运行时量测外层 scroller ──────────────────────
			// 宿主 active phase 把 viewArea 覆盖为 flex:1 0 auto（随内容撑高，整页交给 scrollBody 滚），
			// 于是 height:100% / flex:1 都拿不到约束高 → 左右两栏无法内滚。
			// 做法：沿 parentElement 找第一个真正能纵向滚动的祖先（官方 .Sy5rKG_scrollBody：
			// overflow-y:auto），量「scroller 可视底边 − root 在内容流中的顶」写回 inline height。
			// 不依赖 hash class、不设 100vh 地板；设高后 root 不再撑高文档，offsetTop 收敛，一次算准。
			// ResizeObserver 同时盯 scroller（窗口/分割条/composer 变化）与 root（tab 条高度变化）。
			function useFillHeight(rootRef, dep) {
				const [px, setPx] = useState(0);
				useLayoutEffect(() => {
					const el = rootRef.current;
					if (el === null) return;
					let scroller = null;
					for (let p = el.parentElement; p !== null; p = p.parentElement) {
						const oy = getComputedStyle(p).overflowY;
						// 第一个 overflowY:auto/scroll 祖先即设计上的 scroller（宿主 .Sy5rKG_scrollBody）。
						// 不做"真的能滚吗"(scrollHeight>=clientHeight) 二次校验：挂载瞬间内容未加载，
						// 该校验必然为假，只会把合法 scroller 误杀（fillPx 恒 0 的真根因是 effect 时机，
						// 见下方 dep —— 守卫与此无关，2026-10-16 实验两度坐实）。
						if (oy === "auto" || oy === "scroll") { scroller = p; break; }
					}
					if (scroller === null) return;
					const measure = () => {
						const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
						const avail = Math.floor(scroller.clientHeight - top - parseFloat(getComputedStyle(scroller).paddingBottom || "0"));
						setPx((cur) => (avail > 200 && cur !== avail ? avail : cur > 0 ? cur : 0));
					};
					measure();
					const ro = new ResizeObserver(measure);
					ro.observe(scroller);
					ro.observe(el);
					return () => ro.disconnect();
				}, [rootRef, dep]);
				return px;
			}
			// ── FileRow：复选框 | 徽标 | 图标 | 主名/目录 | ±stat | ⋯（GitHub Desktop 序）──
			// memo 前提：回调一律收原始值（path/area），不传 row 闭包；row 用内容比较（每轮刷新是新对象）
			function FileRowBase(props) {
				const { t, row, section, expanded, onToggle, onAction, onCheck } = props;
				const [menuOpen, setMenuOpen] = useState(false);
				const letter = section === "untracked" ? "U" : section === "staged" ? (row.x === "?" ? "U" : row.x) : (row.y === " " ? row.x : row.y);
				const badgeClass = letter === "M" ? "dgt-badgeM" : letter === "A" ? "dgt-badgeA"
					: letter === "D" ? "dgt-badgeD" : letter === "R" || letter === "C" ? "dgt-badgeR" : "dgt-badgeU";
				const items = [];
				if (section === "changes" || section === "untracked") items.push({ id: "stage", label: t("stage") });
				if (section === "staged") items.push({ id: "unstage", label: t("unstage") });
				items.push({ id: "diff", label: t("viewDiff") });
				items.push({ id: "discard", label: t("discard"), danger: true });
				const area = section === "staged" ? "staged" : section === "untracked" ? "untracked" : "unstaged";
				const showStat = !row.binary && row.label !== "??" && (row.add !== null || row.del !== null);
				// 主名 = basename；副文本 = 目录（tertiary，超长右截断）
				const slash = row.path.lastIndexOf("/");
				const base = slash === -1 ? row.path : row.path.slice(slash + 1);
				const dir = slash === -1 ? "" : row.path.slice(0, slash);
				// 复选框状态：staged 区=勾选；changes/untracked 区=未勾选
				const checked = section === "staged";
				return h("li", null,
					h("div", { className: "dgt-row" },
						h("input", {
							type: "checkbox", className: "dgt-check", checked,
							"aria-label": (checked ? t("unstage") : t("stage")) + " " + row.path,
							onChange: () => onCheck(checked ? "unstage" : "stage", row.path),
						}),
						h("button", { type: "button", className: "dgt-rowBtn" + (expanded ? " dgt-rowActive" : ""), onClick: () => onToggle(row.path, area), "aria-expanded": expanded, title: row.orig ? row.orig + " → " + row.path : row.path },
							h("span", { className: "dgt-badge " + badgeClass }, letter),
							h(FileTypeIcon, { path: row.path, size: 14, className: "dgt-fileicon" }),
							h("span", { className: "dgt-nameWrap" },
								h("span", { className: "dgt-baseName" }, base),
								dir !== "" ? h("span", { className: "dgt-dirName" }, dir) : null,
							),
							h("span", { className: "dgt-stat" },
								row.binary ? t("binaryShort") : showStat ? [h("span", { className: "dgt-add", key: "a" }, "+" + (row.add ?? 0)), " ", h("span", { className: "dgt-del", key: "d" }, "−" + (row.del ?? 0))] : null),
						),
						h("button", { type: "button", className: "dgt-kebab", onClick: () => setMenuOpen((v) => !v), "aria-haspopup": "menu", "aria-expanded": menuOpen, title: t("more"), "aria-label": t("more") }, icon("dots", 14)),
					),
					menuOpen ? h(Menu, {
						open: true,
						anchor: h("span", null),
						items,
						onSelect: (id) => { setMenuOpen(false); onAction(id, row.path, area); },
						onClose: () => setMenuOpen(false),
					}) : null,
					expanded ? h("div", { className: "dgt-expandRow" }, props.children) : null,
				);
			}

			// ── 确认对话框（官方 RiskConfirmation）─────────────────────
			// row 每次刷新都是新对象 → 按内容比较，避免整列表随无关 state 重渲染
			function sameRow(a, b) {
				return a === b || (a.path === b.path && a.x === b.x && a.y === b.y && a.label === b.label
					&& a.add === b.add && a.del === b.del && a.binary === b.binary && a.orig === b.orig);
			}
			const FileRow = memo(FileRowBase, (a, b) => a.t === b.t && a.section === b.section
				&& a.expanded === b.expanded && sameRow(a.row, b.row) && a.children === b.children
				&& a.onToggle === b.onToggle && a.onAction === b.onAction && a.onCheck === b.onCheck);

			// 时间轴单项：props 全原始值 + 稳定回调（VS Code 式长列表渲染纪律）
			const CommitItem = memo(function CommitItem(props) {
				const { sha, subject, author, rel, avatar, selected, onPick } = props;
				return h("button", { type: "button", className: "dgt-tlItem" + (selected ? " dgt-tlSel" : ""), onClick: () => onPick(sha) },
					h("span", { className: "dgt-tlRail" }, h("span", { className: "dgt-tlDot" }), h("span", { className: "dgt-tlLine" })),
					h("span", { className: "dgt-tlCard" },
						h(Avatar, { url: avatar, name: author }),
						h("span", { className: "dgt-tlText" },
							h("span", { className: "dgt-tlSubject" }, subject),
							h("span", { className: "dgt-tlMeta" }, author + " · " + rel),
						),
						h("span", { className: "dgt-tlSha" }, sha.slice(0, 7)),
					),
				);
			});
			function ConfirmHost(props) {
				const { t, state, onConfirm, onCancel } = props;
				const [ack, setAck] = useState(false);
				useEffect(() => { if (state !== null) setAck(false); }, [state]);
				if (state === null) return null;
				return h(RiskConfirmation, {
					open: true,
					title: state.title,
					description: state.description,
					acknowledgeLabel: t("acknowledge"),
					cancelLabel: t("cancel"),
					closeLabel: t("close"),
					confirmLabel: state.confirmLabel ?? t("confirm"),
					acknowledged: ack,
					onAcknowledgedChange: setAck,
					onCancel,
					onConfirm: () => onConfirm(state),
				});
			}

			// ── Toast（官方 Toast）──────────────────────────────────────
			function ToastHost(props) {
				const { toast, onDone } = props;
				if (toast === null) return null;
				return h(Toast, { text: toast.text, tone: toast.tone, onDone });
			}

			// ── GitView 主组件 ─────────────────────────────────────────
			function GitView(props) {
				// t 转发进 ref → 身份恒定（宿主每轮 inject 都造新 t，会让 memo 全部失效）。
				// locale 变化时最新 t 仍生效（ref 每轮同步）。
				const tRaw = typeof props.t === "function" ? props.t : (k) => k;
				const tRef = useRef(tRaw);
				tRef.current = tRaw;
				const t = useCallback((key, params) => tRef.current(key, params), []);
				useSyncExternalStore((fn) => bridge.subscribe(fn), () => bridge.version, () => bridge.version);
				const cwd = bridge.cwd;
				const isRepo = bridge.isRepo;

				const sessionId = bridge.sessionId;
				const [sel, setSel] = useState({ kind: "working" }); // {kind:"working"} | {kind:"commit",sha}
				const [q, setQ] = useState("");
				const [openFile, setOpenFile] = useState(null);
				const [statusData, setStatusData] = useState(null);
				const [remotes, setRemotes] = useState(null); // null=未知（不禁用），[]=确认无远程
				const [branches, setBranches] = useState([]);
				const [commits, setCommits] = useState([]);
				const [error, setError] = useState(null);
				const [busy, setBusy] = useState(false);
				const [shaFiles, setShaFiles] = useState(null);
				const [message, setMessage] = useState("");
				const [amend, setAmend] = useState(false);
				const [confirmState, setConfirmState] = useState(null);
				const [toast, setToast] = useState(null);
				const [newBranch, setNewBranch] = useState("");
				const [genBusy, setGenBusy] = useState(false);
				const [totals, setTotals] = useState(null);
				const [viewing, setViewing] = useState(null);
				const [panelClosing, setPanelClosing] = useState(false);
				const [panelDiff, setPanelDiff] = useState(null);
				const seqRef = useRef(0);
				const bodyRef = useRef(null);
				// 内滚量测：rootRef 只挂在主 return 的 .dgt-root 上（早返回分支不带 ref），
				// dep 必须能表达「主 root 已挂载」：isRepo 且（statusData 落地或 error 在场）
				// —— 与 1129/1130 两个早返回的补集精确等价；false→true 触发一次量测，
				// 后续尺寸变化交 ResizeObserver。
				const rootRef = useRef(null);
				const fillPx = useFillHeight(rootRef, isRepo && (statusData !== null || error !== null));

				const showToast = useCallback((text, tone) => {
					setToast({ text, tone });
					setTimeout(() => setToast((cur) => (cur !== null && cur.text === text ? null : cur)), 3600);
				}, []);

				const refresh = useCallback(async (alsoBranches, silent) => {
					if (!cwd || !isRepo) return;
					const seq = ++seqRef.current;
					// /overview 聚合：status+commits+branches 一个往返（host 内并行 + TTL 防连击）
					const ov = await apiGet("/overview", { sessionId });
					if (seq !== seqRef.current) return; // 过期响应丢弃（cwd 变更后被顶掉的静默刷新也走这里）
					if (!ov.ok) {
						// 静默刷新失败 → 转显式刷新：用户看到错误条 + 重试，乐观值不会长期骗人
						if (silent) { if (refreshRef.current !== null) void refreshRef.current(true, false); return; }
						setError(ov.error); return;
					}
					if (ov.status !== null) { setStatusData(ov.status); setError(null); } else setError(ov.statusError);
					setCommits(ov.commits ?? []);
					setTotals(ov.totals ?? null);
					setRemotes(Array.isArray(ov.remotes) ? ov.remotes : []);
					if (alsoBranches) setBranches(ov.branches ?? []);
					bridge.patch({ isRepo: ov.isRepo === true });
					repoCachePut(cwd, { status: ov.status, commits: ov.commits ?? [], branches: ov.branches ?? [], totals: ov.totals ?? null, remotes: ov.remotes ?? [] });
				}, [cwd, isRepo, sessionId]);
				const refreshRef = useRef(null);
				useEffect(() => { refreshRef.current = refresh; }, [refresh]);

				// diff 预加载：列表就绪后 idle 时机串行拉前 8 个文件的 diff（点击秒开）。
				// 时机纪律：requestIdleCallback 保证对话主渲染完成后再跑；host 端 git 在独立进程，不占 GUI 线程。
				const preloadRef = useRef({ cwd: null });
				useEffect(() => {
					if (!sessionId || !cwd || !isRepo || statusData === null) return;
					if (preloadRef.current.cwd === cwd) return; // 该工作区本轮已预载
					const files = [
						...statusData.staged.map((r) => ({ path: r.path, area: "staged" })),
						...statusData.changes.map((r) => ({ path: r.path, area: "unstaged" })),
						...statusData.untracked.map((r) => ({ path: r.path, area: "untracked" })),
					].filter((f) => !diffCache.has(f.area + ":" + f.path)).slice(0, 8);
					preloadRef.current.cwd = cwd;
					if (files.length === 0) return;
					let cancelled = false;
					const run = (list) => {
						if (cancelled || list.length === 0) return;
						const head = list[0];
						const key = head.area + ":" + head.path;
						const next = () => { if (!cancelled) run(list.slice(1)); };
						if (diffCache.has(key)) { next(); return; }
						apiGet("/file-diff", { sessionId, f: head.path, area: head.area })
							.then((r) => { if (!cancelled && r.ok) diffCachePut(key, r.diff); next(); })
							.catch(next);
					};
					const kick = () => { if (!cancelled) run(files); };
					if (typeof requestIdleCallback === "function") requestIdleCallback(kick, { timeout: 4000 });
					else setTimeout(kick, 900);
					return () => { cancelled = true; };
				}, [sessionId, cwd, isRepo, statusData]);
				// 写操作成功后：area 可能翻转（unstaged→staged），允许下一轮重新预载新组合
				const markPreloadStale = useCallback(() => { preloadRef.current.cwd = null; }, []);

				// diff 面板：viewing 变化 → 拉该文件 diff（缓存先行）
				useEffect(() => {
					if (viewing === null || !sessionId) { setPanelDiff(null); return; }
					const key = viewing.area + ":" + viewing.path;
					const hit = diffCache.get(key);
					if (hit !== undefined) { setPanelDiff(hit.diff); return; }
					setPanelDiff(null);
					let live = true;
					apiGet("/file-diff", { sessionId, f: viewing.path, area: viewing.area }).then((r) => {
						if (!live) return;
						const d = r.ok ? r.diff : { kind: "oversized", path: viewing.path };
						diffCachePut(key, d);
						setPanelDiff(d);
					});
					return () => { live = false; };
				}, [sessionId, viewing]);

				// cwd / isRepo 变化：缓存命中 → 立即渲染旧数据（秒显），后台 revalidate；
				// 无缓存 → 短占位。切换会话回来不再闪 loading。
				useEffect(() => {
					setSel({ kind: "working" }); setOpenFile(null); setShaFiles(null);
					if (!cwd || !isRepo) { setStatusData(null); setRemotes(null); return; }
					const cached = repoCacheGet(cwd);
					if (cached !== null) {
						setStatusData(cached.status);
						setCommits(cached.commits);
						setBranches(cached.branches);
						setTotals(cached.totals ?? null);
						setRemotes(cached.remotes ?? null); // 旧结构缓存=未知，不误禁用
						setError(null);
					} else {
						setStatusData(null);
						setError(null);
					}
					void refresh(true);
				}, [cwd, isRepo, refresh]);

				// 展开提交 → 拉 show-diff
				useEffect(() => {
					const selSha = sel.kind === "commit" ? sel.sha : null;
					if (selSha === null || !cwd) { setShaFiles(null); return; }
					let live = true;
					apiGet("/show-diff", { sessionId, sha: selSha }).then((r) => {
						if (live) setShaFiles(r.ok ? r.files : []);
					});
					return () => { live = false; };
				}, [cwd, sessionId, sel]);

				const busyRef = useRef(false);
				const runAction = useCallback(async (action, args) => {
					if (busyRef.current || !cwd) return null;
					busyRef.current = true;
					setBusy(true);
					try {
						const r = await apiAction(sessionId, action, args);
						if (r.ok) {
							markPreloadStale();
							// 切分支/建分支：乐观改 chip 与 current 标记，后台静默刷新以权威值覆盖
							if (action === "switch" || action === "create-branch") {
								const target = String(args?.branch ?? "");
								if (target !== "") {
									setStatusData((cur) => (cur === null ? cur : { ...cur, branch: target }));
									setBranches((cur) => cur.map((b) => ({ ...b, current: b.name === target })));
								}
							}
							if (action === "commit" || action === "amend") {
								// 提交语义要求列表/ composer 与仓库一致后才算完：保持 busy 到刷新结束
								await refresh(true);
								setMessage("");
								setAmend(false);
							} else {
								void refresh(true, true); // 不阻塞：按钮立刻可用，数据随后到位
							}
							const label = t("actionDone", { action: t(ACTION_LABEL[action] ?? action) });
							const which = (action === "switch" || action === "create-branch") && args?.branch ? " · " + String(args.branch) : "";
							showToast((r.tip ? label + " · " + r.tip : label) + which, "success");
						} else {
							showToast(t("failed") + "：" + (r.hint ? r.hint + " · " : "") + String(r.error ?? "").slice(0, 160), undefined);
						}
						return r;
					} finally {
						busyRef.current = false;
						setBusy(false);
					}
				}, [cwd, refresh, showToast, t, markPreloadStale]);

				const onFileAction = useCallback((id, path, area) => {
					if (id === "diff") {
						setViewing({ path, area });
						return;
					}
					if (id === "stage") return void runAction("stage", { paths: [path] });
					if (id === "unstage") return void runAction("unstage", { paths: [path] });
					if (id === "discard") {
						setConfirmState({
							title: t("discardTitle"),
							description: t("discardDesc", { path }),
							action: "discard",
							args: { paths: [path] },
						});
					}
				}, [runAction, t]);

				const toggleRow = useCallback((path, area) => {
					setViewing({ path, area });
				}, []);
				const openPanel = useCallback((row, area) => {
					setViewing({ path: row.path, area });
				}, []);
				const closePanel = useCallback(() => {
					if (viewing === null) return;
					setPanelClosing(true);
					setTimeout(() => { setViewing(null); setPanelClosing(false); }, 220);
				}, [viewing]);
				const onCheck = useCallback((what, path) => {
					void runAction(what, { paths: [path] });
				}, [runAction]);

				const doGenerate = useCallback(async () => {
					if (genBusy || !sessionId) return;
					setGenBusy(true);
					try {
						const res = await fetch(ROUTE + "/gen-message", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ action: "gen-message", sessionId, cwd }),
						}).then((x) => x.json());
						if (res.ok) {
							setMessage(res.message);
							showToast(res.formatOk ? t("done") + " · " + (res.model ?? "") : t("genWarn"), "success");
						} else {
							showToast(t("failed") + "：" + String(res.error ?? "").slice(0, 160));
						}
					} catch (error) {
						showToast(t("failed") + "：" + String(error));
					} finally {
						setGenBusy(false);
					}
				}, [genBusy, sessionId, cwd, showToast, t]);

				const doCommit = useCallback(() => {
					const action = amend ? "amend" : "commit";
					const upstreamSynced = statusData && statusData.upstream && statusData.ahead === 0;
					if (amend && upstreamSynced) {
						setConfirmState({ title: t("amendWarnTitle"), description: t("amendWarnDesc"), action, args: { message } });
						return;
					}
					void runAction(action, { message });
				}, [amend, message, runAction, statusData, t]);

				// 选择/切换回调：必须定义在下面的早返回之前（Hook 顺序不可条件化）
				const selectWorking = useCallback(() => {
					setSel({ kind: "working" }); setOpenFile(null);
					if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
				}, []);
				const selectCommit = useCallback((sha) => {
					setSel((cur) => (cur.kind === "commit" && cur.sha === sha ? cur : { kind: "commit", sha }));
					setOpenFile(null);
					if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
				}, []);
				const switchBranch = useCallback((b) => { void runAction("switch", { branch: b }); }, [runAction]);

				if (!isRepo) return h("div", { className: "dgt-root" }, h("div", { className: "dgt-empty" }, h("span", { className: "dgt-emptyIcon" }, icon("branch", 28)), h("span", { className: "dgt-emptyText" }, h("span", null, t("notRepo")), h("span", { className: "dgt-emptySub" }, t("notRepoSub")))));
				if (statusData === null && error === null) return h("div", { className: "dgt-root" }, h("div", { className: "dgt-empty" }, t("checking")));

				const renderSection = (section) => {
					const rows = section === "staged" ? statusData.staged : section === "changes" ? statusData.changes : statusData.untracked;
					// 空段整段隐藏（GitHub Desktop 惯例）：三段全空时 renderWorkingSections 已有 emptyRepo 兜底
					if (rows.length === 0) return null;
					const area = section === "staged" ? "staged" : section === "untracked" ? "untracked" : "unstaged";
					return h("div", { className: "dgt-section", key: section },
						h("div", { className: "dgt-sectionHead" },
							h("span", null, t(section === "untracked" ? "untracked" : section === "staged" ? "staged" : "changes")),
							h("span", { className: "dgt-sectionCount" }, "(" + rows.length + ")"),
							h("span", { className: "dgt-sectionSpacer" }),
							section === "staged"
								? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("unstage-all", {}) }, t("unstageAll"))
								: null,
						),
						rows.length > 0 ? h("ul", { className: "dgt-card" }, rows.map((row) => {
							return h(FileRow, {
								key: row.path + ":" + row.label,
								t, row, section,
								expanded: viewing !== null && viewing.path === row.path && viewing.area === area,
								onToggle: toggleRow,
								onAction: onFileAction,
								onCheck,
							});
						})) : null,
					);
				};


				// 左栏过滤：大小写不敏感，命中 subject / 作者 / sha
				const ql = q.trim().toLowerCase();
				const visibleCommits = ql === "" ? commits : commits.filter((c) =>
					(c.subject || "").toLowerCase().includes(ql) || (c.author || "").toLowerCase().includes(ql) || (c.sha || "").toLowerCase().startsWith(ql));

				const renderWorkingSections = () => {
					if (statusData.staged.length === 0 && statusData.changes.length === 0 && statusData.untracked.length === 0) {
						return h("div", { className: "dgt-empty" }, h("span", { className: "dgt-emptyIcon" }, icon("checkCircle", 28)), h("span", { className: "dgt-emptyText" }, h("span", null, t("emptyRepo")), h("span", { className: "dgt-emptySub" }, t("emptyRepoSub"))));
					}
					const tt = totals ?? { files: 0, add: 0, del: 0 };
					return h("div", null,
						h("div", { className: "dgt-toolRow" },
							h("span", { className: "dgt-toolStat" },
								h("span", { className: "dgt-add" }, "+" + tt.add.toLocaleString()),
								h("span", { className: "dgt-del" }, "−" + tt.del.toLocaleString()),
								h("span", { className: "dgt-files" }, " · " + tt.files + " " + t("files")),
							),
							h("span", { className: "dgt-toolSpacer" }),
							statusData.changes.length > 0 || statusData.untracked.length > 0
								? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("stage-all", {}) }, t("stageAll"))
								: null,
						),
						renderSection("staged"), renderSection("changes"), renderSection("untracked"),
					);
				};

				// commit 详情视图：头部（头像+subject+sha）+ 文件列表（点击内联展开 diff）
				const renderCommitDetail = (c) => {
					const files = shaFiles ?? [];
					let add = 0, del = 0;
					for (const f of files) { add += f.add ?? 0; del += f.del ?? 0; }
					return h("div", null,
						h("div", { className: "dgt-cd" },
							h("div", { className: "dgt-cdHead" },
								h(Avatar, { url: c.avatar, name: c.author, big: true }),
								h("span", { className: "dgt-cdTitleWrap" },
									h("div", { className: "dgt-cdSubject" }, c.subject),
									h("div", { className: "dgt-cdMeta" }, c.author + " · " + new Date(c.time).toLocaleString() + " · " + relTime(c.time, t)),
								),
								h("button", { type: "button", className: "dgt-shaChip", title: t("copySha"), onClick: () => { void writeClipboard(c.sha); showToast(t("copySha") + " ✓"); } },
									h("span", { className: "dgt-shaMono" }, c.sha.slice(0, 7)), icon("copy", 11)),
							),
							c.body ? h("div", { className: "dgt-cdBody" }, c.body) : null,
							files.length > 0
								? h("div", { className: "dgt-cdSum" },
									files.length + " " + t("files") + " · ",
									h("span", { className: "dgt-add" }, "+" + add), " ",
									h("span", { className: "dgt-del" }, "−" + del))
								: null,
							shaFiles === null ? h("div", { className: "dgt-empty" }, t("checking")) : files.map((f) => {
								const open = openFile === f.path;
								return h("div", { className: "dgt-cdFile", key: f.path },
									h("button", { type: "button", className: "dgt-cdRow", "aria-expanded": open, onClick: () => setOpenFile(open ? null : f.path) },
										h(FileTypeIcon, { path: f.path, size: 14, className: "dgt-fileicon" }),
										h("span", { className: "dgt-nameWrap" },
											h("span", { className: "dgt-baseName" }, f.path.slice(f.path.lastIndexOf("/") + 1)),
											f.path.includes("/") ? h("span", { className: "dgt-dirName" }, f.path.slice(0, f.path.lastIndexOf("/"))) : null,
										),
										h("span", { className: "dgt-stat" }, f.binary ? t("binaryShort")
											: [h("span", { className: "dgt-add", key: "a" }, "+" + (f.add ?? 0)), " ", h("span", { className: "dgt-del", key: "d" }, "−" + (f.del ?? 0))]),
										h("span", { className: "dgt-caret" }, icon("chevronDown", 12)),
									),
									open ? h("div", { className: "dgt-cdDiff" }, h(DiffView, { t, diff: f })) : null,
								);
							}),
						),
					);
				};

				// 活跃文件行（面板返回后高亮）
				const branch = statusData?.branch ?? "…";
				const repoName = cwd ? cwd.slice(cwd.lastIndexOf("/") + 1) : "…";
				const isWorking = sel.kind === "working";
				const dirtyCount = statusData !== null ? statusData.staged.length + statusData.changes.length + statusData.untracked.length : 0;
				const ahead = statusData?.ahead ?? 0;
				const behind = statusData?.behind ?? 0;
				// 无远程仓库时 fetch/pull/push 必失败 → 禁用并给原因；null=加载中，不误禁
				const hasRemote = remotes === null || remotes.length > 0;
				const remoteTitle = hasRemote ? undefined : t("noRemote");
				const selCommit = isWorking ? null : commits.find((c) => c.sha === sel.sha) ?? null;
				let lastDay = null;

				return h("div", { className: "dgt-root", ref: rootRef, role: "tabpanel", "aria-label": t("title"), style: fillPx > 0 ? { height: fillPx + "px", flex: "none" } : undefined },
					h("div", { className: "dgt-cols" },
						// ── 左栏：仓库 + 分支 + 提交时间轴 ──────────────
						h("div", { className: "dgt-side" },
							h("div", { className: "dgt-sideHead" },
								h("span", { className: "dgt-repoChip", title: cwd ?? "" },
									icon("repo", 12), h("span", { className: "dgt-chipName" }, repoName)),
								h("span", { className: "dgt-repoChip", title: t("branch") },
									icon("branch", 12), h("span", { className: "dgt-chipName" }, branch)),
							),
							h("div", { className: "dgt-searchWrap" },
								h("span", { className: "dgt-searchIco" }, icon("search", 12)),
								h("input", { className: "dgt-search", type: "search", value: q, placeholder: t("searchCommits"), onChange: (e) => setQ(e.target.value), "aria-label": t("searchCommits") }),
							),
							h("div", { className: "dgt-brScroll" },
								h("div", { className: "dgt-sideSection" },
									h("div", { className: "dgt-sideHead2" }, t("branchesTitle")),
									branches.map((b) => h("button", {
										type: "button", key: b.name,
										className: "dgt-brRow" + (b.current ? " dgt-brRowCurrent" : ""),
										disabled: busy || b.current, title: b.upstream ? b.upstream + " ↑" + b.ahead + " ↓" + b.behind : b.name,
										onClick: () => { if (!b.current) switchBranch(b.name); },
									},
										h("span", { className: "dgt-brName" },
											icon(b.current ? "checkCircle" : "branch", 12),
											h("span", { className: "dgt-brLabel" }, b.name),
										),
										b.current ? h("span", { className: "dgt-brPill" }, t("current")) : null,
									)),
									h("div", { className: "dgt-newBranch" },
										h("input", {
											className: "dgt-input", value: newBranch, placeholder: t("newBranch"),
											onChange: (e) => setNewBranch(e.target.value),
											onKeyDown: (e) => {
												if (e.key === "Enter" && newBranch.trim() !== "" && !busy) {
													void runAction("create-branch", { branch: newBranch.trim() }).then((r) => { if (r && r.ok) setNewBranch(""); });
												}
											},
										}),
										h("button", {
											type: "button", className: "dgt-primaryBtn", disabled: busy || newBranch.trim() === "",
											onClick: () => void runAction("create-branch", { branch: newBranch.trim() }).then((r) => { if (r && r.ok) setNewBranch(""); }),
										}, t("createSwitch")),
									),
								),
							),
							h("div", { className: "dgt-tlScroll" },
								h("div", { className: "dgt-sideSection" },
									h("div", { className: "dgt-sideHead2" }, t("commitsTitle")),
									// 工作区改动固定节点（设计稿缺口修补：未提交改动必须有入口）
									h("button", { type: "button", className: "dgt-tlItem" + (isWorking ? " dgt-tlSel" : ""), onClick: selectWorking },
										h("span", { className: "dgt-tlRail" }, h("span", { className: "dgt-tlDot" })),
										h("span", { className: "dgt-tlCard" },
											h("span", { className: "dgt-tlText" }, h("span", { className: "dgt-tlSubject" }, t("workingChanges"))),
											dirtyCount > 0 ? h("span", { className: "dgt-badgeN" }, String(dirtyCount)) : null,
										),
									),
									visibleCommits.length === 0
										? h("div", { className: "dgt-sideEmpty" }, commits.length === 0 ? t("noCommits") : t("noMatches"))
										: visibleCommits.map((c) => {
											const day = dayLabel(c.time, t);
											const head = day !== lastDay; lastDay = day;
											return h("div", { key: c.sha },
												head ? h("div", { className: "dgt-tlDay" }, day) : null,
												h(CommitItem, {
													sha: c.sha, subject: c.subject, author: c.author,
													rel: relTime(c.time, t), avatar: c.avatar,
													selected: sel.kind === "commit" && sel.sha === c.sha,
													onPick: selectCommit,
												}),
											);
										}),
								),
							),
						),
						// ── 右主区 ────────────────────────────────────
						h("div", { className: "dgt-main" },
							isWorking
								? h("div", { className: "dgt-wHead" },
									h("span", { className: "dgt-wTitle" }, t("workingChanges")),
									dirtyCount > 0 ? h("span", { className: "dgt-badgeN" }, String(dirtyCount)) : null,
									h("span", { className: "dgt-toolSpacer" }),
									h("button", { type: "button", className: "dgt-iconBtn", disabled: busy || !hasRemote, onClick: () => void runAction("fetch", {}), title: hasRemote ? t("fetch") : remoteTitle }, icon("refresh", 14)),
									h("button", { type: "button", className: "dgt-iconBtn", disabled: busy || !hasRemote, onClick: () => void runAction("pull", {}), title: hasRemote ? t("pull") : remoteTitle }, icon("download", 14), behind > 0 ? h("span", { className: "dgt-badgeN" }, String(behind)) : null),
									h("button", { type: "button", className: "dgt-iconBtn", disabled: busy || !hasRemote, onClick: () => void runAction("push", {}), title: hasRemote ? t("push") : remoteTitle }, icon("upload", 14), ahead > 0 ? h("span", { className: "dgt-badgeN" }, String(ahead)) : null),
								)
								: null,
							h("div", { className: "dgt-body", ref: bodyRef, id: "dgt-body", role: "tabpanel" },
								error !== null
									? h("div", { className: "dgt-content" }, h("div", { className: "dgt-empty" }, String(error),
										h("button", { type: "button", className: "dgt-miniBtn", onClick: () => void refresh(true) }, t("reload"))))
									: h("div", { className: "dgt-listView" + (viewing !== null ? " dgt-listPushed" : "") },
										isWorking ? renderWorkingSections()
											: selCommit !== null ? renderCommitDetail(selCommit)
											: h("div", { className: "dgt-empty" }, t("checking")),
									),
							),
							isWorking
								? h("div", { className: "dgt-footer" + (viewing !== null ? " dgt-listPushed" : "") },
									h("div", { className: "dgt-commitInner" },
										h("div", { className: "dgt-commitCard" },
											h("textarea", { className: "dgt-msg", value: message, placeholder: t("commitMsg"), onChange: (e) => setMessage(e.target.value), rows: 2 }),
											h("div", { className: "dgt-msgRow" },
												h("button", {
													type: "button", className: "dgt-genBtn", disabled: genBusy || (statusData !== null && statusData.staged.length === 0),
													onClick: doGenerate,
													title: statusData !== null && statusData.staged.length === 0 ? t("genEmpty") : undefined,
												}, genBusy ? [h("span", { className: "dgt-spin", key: "s" }, icon("spinner", 12)), t("genMsgBusy")] : [icon("sparkles", 12, "i"), t("genMsg")]),
												h("span", { className: "dgt-msgSpacer" }),
												h("label", { className: "dgt-amend" },
													h("input", { type: "checkbox", checked: amend, onChange: (e) => setAmend(e.target.checked) }),
													t("amend"),
												),
												h("button", { type: "button", className: "dgt-commitBtn", disabled: busy || message.trim() === "" || (statusData !== null && statusData.staged.length === 0), onClick: doCommit, title: statusData !== null && statusData.staged.length === 0 ? t("dirtyWorktree") : undefined }, busy ? t("busy") : t("commit")),
											),
										),
									),
								)
								: null,
							// Diff 详情面板（覆盖 body+footer；推入/推出动效）
							viewing !== null
								? h("div", { className: "dgt-panel" + (panelClosing ? " dgt-panelOut" : ""), role: "dialog", "aria-label": viewing.path },
									h("div", { className: "dgt-panelBar" },
										h("button", { type: "button", className: "dgt-backBtn", onClick: closePanel, "aria-label": t("hideDiff") }, icon("chevronLeft", 16)),
										h("span", { className: "dgt-panelFile" },
											h("span", { className: "dgt-badge " + (viewing.area === "staged" ? "dgt-badgeA" : viewing.area === "untracked" ? "dgt-badgeU" : "dgt-badgeM") },
												viewing.area === "staged" ? "A" : viewing.area === "untracked" ? "U" : "M"),
											h("span", null, viewing.path),
										),
										h("span", { className: "dgt-toolSpacer" }),
										viewing.area === "staged"
											? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("unstage", { paths: [viewing.path] }) }, t("unstage"))
											: h("button", { type: "button", className: "dgt-miniBtn dgt-miniBtnPrimary", disabled: busy, onClick: () => void runAction("stage", { paths: [viewing.path] }) }, t("stage")),
										h("button", { type: "button", className: "dgt-qbtn dgt-qbtnDanger", title: t("discard"), "aria-label": t("discard"), onClick: () => onFileAction("discard", { path: viewing.path }, viewing.area) }, icon("trash", 14)),
									),
									h("div", { className: "dgt-scroll" },
										panelDiff !== null
											? h(DiffView, { diff: panelDiff })
											: h("div", { className: "dgt-empty" }, t("checking")),
									),
								)
								: null,
						),
					),
					h(ConfirmHost, {
						t, state: confirmState,
						onCancel: () => setConfirmState(null),
						onConfirm: (st) => { setConfirmState(null); void runAction(st.action, st.args); },
					}),
					h(ToastHost, { toast, onDone: () => setToast(null) }),
				);
			}

			// ── Probe（header.utilities 隐形探测）────────────────────────
			// cwd 由 host 侧 sessions 服务解析（sessionId → header.cwd，三级回退先例）；
			// client 侧 useSession snapshot 无 cwd 字段（实测），不赌。
			function Probe(props) {
				const sessionId = props.sessionId;

				useEffect(() => {
					let cancelled = false;
					let timer = null;
					const diag = (msg, extra) => {
						try {
							const log = JSON.parse(localStorage.getItem("dsh-git-plus-diag") ?? "[]");
							log.push({ at: new Date().toISOString(), msg, extra: extra === undefined ? null : extra });
							localStorage.setItem("dsh-git-plus-diag", JSON.stringify(log.slice(-20)));
						} catch { /* 取证失败不影响运行 */ }
					};
					const check = async () => {
						if (cancelled) return;
						if (sessionId === undefined || sessionId === null || sessionId === "") {
							diag("no session");
							return;
						}
						// 缓存先行：切换会话瞬间同步恢复上次判定（不闪 loading）
						const hit = probeCache.get(sessionId);
						if (hit !== undefined) {
							bridge.patch({ sessionId, cwd: hit.cwd, isRepo: hit.isRepo });
							syncRegistration();
							if (Date.now() - hit.at < PROBE_CACHE_TTL) return; // TTL 内不重查
						}
						try {
							const info = await apiGet("/git-info", { sessionId });
							if (cancelled) return;
							const probed = info.ok === true; // 探测本身成功（含 isRepo:false 的合法结果）
							const isRepo = probed && info.isRepo === true;
							diag("checked", JSON.stringify({ sessionId, isRepo, branch: info.branch ?? null, raw: info.ok ? info.isRepo : info.error }));
							probeCache.set(sessionId, { cwd: info.cwd ?? null, isRepo, at: Date.now() });
							bridge.patch({ sessionId, cwd: info.cwd ?? bridge.cwd, isRepo });
							syncRegistration();
							// 只有探测成功且确认非 repo 才摘；探测失败（网络/host 重启）保持注册 + 5s 重试
							if (probed && !isRepo && timer === null) timer = setInterval(() => { void check(); }, 5000);
							if (isRepo && timer !== null) { clearInterval(timer); timer = null; }
						} catch (error) {
							diag("fetch error", String(error));
						}
					};
					void check();
					return () => {
						cancelled = true;
						if (timer !== null) { clearInterval(timer); timer = null; }
					};
				}, [sessionId]);

				return null;
			}

			// ── apply：全走官方 inject「等声明」语义 ────────────────────
			// slots.inject(key, cb) 在 slot 未声明时不执行 cb、订阅 declaration、
			// 声明出现后自动 reconcile（registry.ts:209-271）—— 根治注册时序问题：
			//   · probe: 等 header.utilities 声明（= 会话 header 渲染）才挂探测组件
			//   · git tab: probe 检测到 repo 后直接 slots.register（此时声明必在）
			// 无会话 → 无声明 → probe 不跑 → 无 tab；有会话非 repo → probe 摘除。
			let gitDispose = null;
			const probeSyncRef = { fn: () => {} };
			function syncRegistration() { probeSyncRef.fn(); }

			function apply(ctx) {
				installStyle();
				ctx.effect(() => {
					const offZh = ctx.locale.register(NS, "zh", STRINGS.zh);
					const offEn = ctx.locale.register(NS, "en", STRINGS.en);
					return () => { if (typeof offZh === "function") offZh(); if (typeof offEn === "function") offEn(); };
				}, "dsh-git-plus: dictionaries");
				const t = ctx.locale.bind(NS);
				tRef = t;

				function registerGitTab() {
					if (gitDispose !== null) return;
					try {
						gitDispose = ctx.slots.register(
							{
								name: VIEW_SLOT,
								id: VIEW_ID,
								order: VIEW_ORDER,
								label: () => t("title"),
								locale: NS,
								inject: () => ({ t }),
							},
							GitView,
						);
						console.log("[dsh-git-plus] git tab registered (order " + VIEW_ORDER + ")");
					} catch (error) {
						console.error("[dsh-git-plus] register failed", error);
					}
				}
				function disposeGitTab() {
					if (gitDispose === null) return;
					try { gitDispose(); } catch { /* 已被卸载 */ }
					gitDispose = null;
					console.log("[dsh-git-plus] git tab disposed");
				}
				function sync() {
					if (bridge.isRepo) registerGitTab();
					else disposeGitTab();
				}
				probeSyncRef.fn = sync;

				// 默认注册：slots.inject 等 conversation.view 声明（声明出现 = ui-conversation 已 apply
				// 且已 subscribe），revaluate 执行 callback → 同步 register，markDirty 正常传播。
				// probe 只负责「确认非 repo 后摘除」；探测链路故障时宁可显示（组件内有空态兜底）。
				ctx.slots.inject(VIEW_SLOT, () => {
					registerGitTab();
					return () => {};
				});

				// 取证：本插件 slot 条目渲染错误 → localStorage（cordis logger 不进 console）
				try {
					const offEntryError = ctx.slots.onEntryError((key, registration, error) => {
						const text = "[git-entry-error] slot=" + key + " err=" + (error && (error.stack || error.message) || String(error));
						console.error(text);
						try {
							window.__dshGitPlusErrors = (window.__dshGitPlusErrors || []).concat(text).slice(-10);
							localStorage.setItem("dsh-git-plus-errors", JSON.stringify(window.__dshGitPlusErrors));
						} catch { /* 忽略 */ }
					});
					ctx.effect(() => offEntryError, "dsh-git-plus: entry-error probe");
				} catch { /* 未提供 onEntryError */ }

				// probe 条目：inject 等 utilities 声明（会话 header 渲染时声明出现）；
				// callback 里 register Probe。utilities 是 list slot（每 id 一 cell，
				// 全部 cell 渲染），"git-probe" 独占自己的 cell 必然渲染 —— useEffect
				// 得以运行，这是 tab 动态显隐与仓库数据加载的唯一驱动源。
				// 教训（2026-10-15）：别把需要跑 effect 的隐形组件挂 single slot：
				// single 只渲染最低 priority 条目，priority 100 的 probe 永远不渲染。
				ctx.slots.inject(PROBE_SLOT, () => ctx.slots.register(
					{
						name: PROBE_SLOT,
						id: "git-probe",
						order: 100,
						locale: NS,
						inject: () => ({}),
					},
					Probe,
				));

				ctx.effect(() => () => disposeGitTab(), "dsh-git-plus: dispose git entry");
			}

			exports.name = "dsh-git-plus";
			exports.inject = ["slots", "locale"];
			exports.apply = apply;
			return module.exports;
		},
	});
} catch (error) {
	// 同 id 重复注册（脚本在 rev 更新后重执行）= 已注册过，无害；其余错误照抛
	if (!(error instanceof Error) || !/duplicate factory registration/.test(error.message)) throw error;
}
