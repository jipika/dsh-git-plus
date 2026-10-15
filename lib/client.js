/*
 * dsh-git-tab — browser half
 *
 * 会话头部标签行新增「Git」tab（order 16：chat=0 / trajectory=10 / artifacts=15 / 本插件 16 / context=20 / fleet=30）。
 * 显隐策略（默认注册 + 探测修正，「该出现绝不缺席」优先）：
 *   · apply 时直接注册 conversation.view 条目（slots.register 持 dispose）
 *   · Probe 隐形组件挂 conversation.session.header.corner（session scope，标准 props 自带
 *     sessionId/useSession），探测当前会话 cwd 是否 git 仓库：非仓库 → dispose；仓库 → 保持注册。
 *   · 未注册态 5s 轮询（git init 后 ≤5s 恢复注册）。register/dispose 幂等（标志位守卫，StrictMode 安全）。
 *   · 会话切换瞬间 bridge 保留旧 isRepo 直到新检测完成 —— 有 git 会话零闪烁，无 git 会话短暂残留（1-2s）。
 * cwd 走模块级 bridge（probe 写，GitView 用 useSyncExternalStore 读 version 触发重渲后重读字段；
 * snapshot 返回 number，引用稳定）。
 * 面板 = 变更 / 历史 / 分支 三子页签（官方 SegmentedTabs）+ 完整操作面（host 半边白名单 action）。
 */
// 注册说明：不做全局布尔守卫 —— 宿主对同一 URL 的 rev 重注入（HMR/重连）会重新执行本脚本，
// 布尔守卫会让第二次执行静默短路，宿主判定 "loaded without registering" 而失活。
// 正确姿势：每次执行都调 load；同 id 重复注册由宿主抛 duplicate，捕获静默（幂等）。
try {
	window.__ModuleLoader__.load({
		id: "dsh-git-tab",
		factory: (require) => {
			var module = { exports: {} };
			var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

			const React = require("react");
			const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React;
			const h = React.createElement;
			const prim = require("@deepseek-ai/dsh-client-ui-primitives");
			const SegmentedTabs = prim.SegmentedTabs;
			const Menu = prim.Menu;
			const RiskConfirmation = prim.RiskConfirmation;
			const Toast = prim.Toast;
			const PathLabel = prim.PathLabel;
			const FileTypeIcon = prim.FileTypeIcon;
			const useCodeHighlighter = prim.useCodeHighlighter;
			const languageForPath = prim.languageForPath;
			const writeClipboard = prim.writeClipboard;

			const NS = "gittab";
			const VIEW_SLOT = "conversation.view";
			const PROBE_SLOT = "conversation.session.header.corner";
			const VIEW_ID = "git";
			const VIEW_ORDER = 16;
			const ROUTE = "/dsh-git-tab";

			const STRINGS = {
				zh: {
					title: "Git",
					checking: "检测仓库…",
					notRepo: "当前目录不是 git 仓库",
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
				},
				en: {
					title: "Git",
					checking: "Detecting repository…",
					notRepo: "Current directory is not a git repository",
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
					switched: "Switched",
					done: "Done",
					reload: "Retry",
					failed: "Failed",
				},
			};

			// ── 样式（全部锚 .dgt-*）────────────────────────────────────
			function installStyle() {
				// 幂等策略：移除旧元素再注入（不做存在性短路——旧版本残留的 style 元素
				// 内容可能是过时/空 CSS，存在性守卫会让新样式永远注入不进去）
				const existing = document.getElementById("dsh-git-tab-style");
				if (existing !== null) existing.remove();
				const el = document.createElement("style");
				el.id = "dsh-git-tab-style";
				// 设计基准：macOS source-control 工具（Xcode / Fork / GitHub Desktop）× Apple HIG。
				//   · 顶部 toolbar：分支 chip（左）+ 官方 SegmentedTabs（中）+ fetch/pull/push（右）
				//   · 分组卡片（Apple grouped list）承载文件段；行 = 复选框 | 徽标 | 文件名+目录 | ±统计 | ⋯
				//   · diff 详情 = 材质化面板推入/推出同路（spatial consistency）
				//   · 颜色 / 圆角 / 阴影 / 字号全部走 --dsw-* 官方 token，换主题自动跟随
				el.textContent = [
					// ── 骨架 ─────────────────────────────────────────
					`.dgt-root{position:relative;display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}`,
					`.dgt-root ::-webkit-scrollbar{width:8px;height:8px}`,
					`.dgt-root ::-webkit-scrollbar-thumb{border-radius:4px;background:var(--dsh-scrollbar-thumb)}`,
					`.dgt-root ::-webkit-scrollbar-thumb:hover{background:var(--dsh-scrollbar-thumb-hover)}`,
					`.dgt-root ::-webkit-scrollbar-track{background:transparent}`,
					// ── 顶部 toolbar（半透明材质，内容从其下滚过）────────
					`.dgt-toolbar{flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;padding:8px 16px;background:color-mix(in srgb,var(--dsw-specific-menu) 82%,transparent);backdrop-filter:var(--dsw-menu-backdrop-filter);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);border-bottom:0.5px solid var(--dsw-alias-border-l3);z-index:2}`,
					`.dgt-tbBranch{display:flex;align-items:center;min-width:0;justify-self:start}`,
					`.dgt-branchChip{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:240px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-strong-13);cursor:pointer;transition:background .12s ease}`,
					`.dgt-branchChip:hover{background:var(--dsw-alias-interactive-bg-active)}`,
					`.dgt-branchChip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}`,
					`.dgt-chipName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-chipCaret{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}`,
					`.dgt-tabsWrap{justify-self:center;min-width:0}`,
					`.dgt-tabs{width:min(320px,44vw)}`,
					`.dgt-sync{display:flex;align-items:center;justify-content:flex-end;gap:6px;justify-self:end;min-width:0}`,
					// 通用小按钮（toolbar 同步按钮 / 行内动作共用）
					`.dgt-iconBtn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease}`,
					`.dgt-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
					`.dgt-iconBtn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}`,
					`.dgt-iconBtn:disabled{opacity:.4;cursor:not-allowed}`,
					`.dgt-badgeN{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-strong-11);font-variant-numeric:tabular-nums}`,
					// ── 主体 ─────────────────────────────────────────
					`.dgt-main{flex:1;min-height:0;position:relative;display:flex;flex-direction:column;overflow:hidden}`,
					`.dgt-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 18px;box-sizing:border-box}`,
					`.dgt-bodyInner{max-width:920px;margin:0 auto}`,
					`.dgt-listView{display:flex;flex-direction:column;transition:transform .26s cubic-bezier(.32,.72,0,1),opacity .26s ease}`,
					`.dgt-listPushed{transform:translateX(-12%);opacity:.4;pointer-events:none}`,
					// ── 变更页顶部摘要行 ────────────────────────────────
					`.dgt-toolRow{display:flex;align-items:center;gap:10px;height:34px;padding:0 4px;flex:none}`,
					`.dgt-toolStat{display:flex;align-items:baseline;gap:5px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}`,
					`.dgt-toolStat .dgt-add{color:var(--dsw-alias-state-success-primary);font-weight:500;font-variant-numeric:tabular-nums}`,
					`.dgt-toolStat .dgt-del{color:var(--dsw-alias-state-error-primary);font-weight:500;font-variant-numeric:tabular-nums}`,
					`.dgt-toolStat .dgt-files{color:var(--dsw-alias-label-tertiary)}`,
					`.dgt-toolSpacer{flex:1}`,
					// ── 分组卡片（Apple grouped list）────────────────────
					`.dgt-section{margin-bottom:16px}`,
					`.dgt-sectionHead{display:flex;align-items:center;gap:6px;height:24px;margin-bottom:6px;padding:0 10px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-strong-11);letter-spacing:.06em;text-transform:uppercase}`,
					`.dgt-sectionCount{color:var(--dsw-alias-label-tertiary);font-weight:400;text-transform:none;letter-spacing:0}`,
					`.dgt-sectionSpacer{flex:1}`,
					`.dgt-miniBtn{display:inline-flex;align-items:center;height:22px;padding:0 9px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;text-transform:none;letter-spacing:0;transition:background .12s ease,color .12s ease}`,
					`.dgt-miniBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
					`.dgt-miniBtn:disabled{opacity:.4;cursor:not-allowed}`,
					`.dgt-miniBtn:focus-visible,.dgt-iconBtn:focus-visible,.dgt-menuBtn:focus-visible,.dgt-qbtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}`,
					`.dgt-miniBtnPrimary{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary))}`,
					`.dgt-card{margin:0;padding:4px;list-style:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-stroke,0 0 0 .5px var(--dsw-alias-border-l3))}`,
					// 行：check | 徽标 | 图标 | 名+目录 | ±stat | ⋯（GitHub Desktop 序）
					`.dgt-row{display:flex;align-items:center;height:34px;padding:0 6px 0 10px;border-radius:var(--dsw-radius-sm);transition:background .12s ease}`,
					`.dgt-row:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-rowActive{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-check{flex:none;position:relative;width:16px;height:16px;margin:0 10px 0 0;padding:0;appearance:none;-webkit-appearance:none;border:1.5px solid var(--dsw-alias-label-tertiary);border-radius:50%;background:transparent;cursor:pointer;transition:background .12s ease,border-color .12s ease}`,
					`.dgt-check:hover{border-color:var(--dsw-alias-brand-primary)}`,
					`.dgt-check:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}`,
					`.dgt-check:checked::after{content:"";position:absolute;left:4.5px;top:1.5px;width:4px;height:8px;border:solid var(--dsw-alias-label-primary-foreground);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}`,
					`.dgt-check:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}`,
					`.dgt-rowBtn{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}`,
					`.dgt-rowBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px;border-radius:var(--dsw-radius-sm)}`,
					`.dgt-badge{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;border-radius:5px;font-size:10px;font-weight:700;line-height:1}`,
					`.dgt-badgeM{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent)}`,
					`.dgt-badgeA{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent)}`,
					`.dgt-badgeD{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent)}`,
					`.dgt-badgeR{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent)}`,
					`.dgt-badgeU{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}`,
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
					`.dgt-menuBtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:pointer;opacity:0;transition:opacity .12s ease,background .12s ease,color .12s ease}`,
					`.dgt-logItem:hover .dgt-menuBtn,.dgt-menuBtn:focus-visible{opacity:1}`,
					`.dgt-menuBtn:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}`,
					// ── 提交区（材质 footer：composer + 状态栏）───────────────
					`.dgt-footer{flex:none;border-top:0.5px solid var(--dsw-alias-border-l3);background:color-mix(in srgb,var(--dsw-specific-menu) 72%,transparent);backdrop-filter:var(--dsw-menu-backdrop-filter);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter)}`,
					`.dgt-commitInner{max-width:920px;margin:0 auto;padding:10px 20px 6px;display:flex;gap:10px;align-items:flex-end}`,
					`.dgt-commitLeft{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}`,
					`.dgt-msg{width:100%;min-height:56px;max-height:140px;resize:none;padding:8px 12px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);box-sizing:border-box;transition:border-color .12s ease,box-shadow .12s ease}`,
					`.dgt-msg::placeholder{color:var(--dsw-alias-markdown-placeholder,var(--dsw-alias-label-tertiary))}`,
					`.dgt-msg:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}`,
					`.dgt-msgRow{display:flex;align-items:center;gap:10px}`,
					`.dgt-genBtn{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-link,var(--dsw-alias-brand-primary));font:var(--dsw-font-xxs-12);font-weight:500;cursor:pointer;transition:background .12s ease}`,
					`.dgt-genBtn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}`,
					`.dgt-genBtn:disabled{opacity:.45;cursor:default}`,
					`.dgt-msgSpacer{flex:1}`,
					`.dgt-amend{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;user-select:none}`,
					`.dgt-commitBtn{flex:none;height:56px;min-width:88px;padding:0 18px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xs-strong-13);cursor:pointer;transition:background .12s ease,transform .1s ease}`,
					`.dgt-commitBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}`,
					`.dgt-commitBtn:active:not(:disabled){transform:scale(.98)}`,
					`.dgt-commitBtn:disabled{opacity:.35;cursor:not-allowed}`,
					`.dgt-branchIcon{color:var(--dsw-alias-label-tertiary);font-size:12px}`,
					`.dgt-track{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}`,
					// ── 历史页 ──────────────────────────────────────
					`.dgt-logItem{display:flex;align-items:center;gap:4px;border-radius:var(--dsw-radius-sm);transition:background .12s ease}`,
					`.dgt-logItem:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-logBtn{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;flex:1;min-width:0;height:36px;padding:0 10px;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}`,
					`.dgt-logBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px;border-radius:var(--dsw-radius-sm)}`,
					`.dgt-logSha{min-width:56px;color:var(--dsw-alias-link,var(--dsw-alias-brand-primary));font-family:var(--dsw-font-markdown-code-block-font-family,ui-monospace,Menlo,monospace);font-size:11px;font-variant-numeric:tabular-nums}`,
					`.dgt-logSubj{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-logMeta{flex:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}`,
					`.dgt-logExpand{padding:4px 0 10px 78px}`,
					`.dgt-logFileName{display:flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}`,
					// ── 分支页 ──────────────────────────────────────
					`.dgt-brRow{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 10px;border-radius:var(--dsw-radius-sm);box-sizing:border-box;transition:background .12s ease}`,
					`.dgt-brRow:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
					`.dgt-brRowCurrent{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}`,
					`.dgt-brName{flex:1;display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden}`,
					`.dgt-brLabel{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-brPill{flex:none;display:inline-flex;align-items:center;height:16px;padding:0 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font:var(--dsw-font-xxxs-strong-11)}`,
					`.dgt-newBranch{display:flex;gap:8px;align-items:center;padding:8px 10px;border-top:0.5px solid var(--dsw-alias-border-l3)}`,
					`.dgt-input{flex:1;height:30px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);transition:border-color .12s ease,box-shadow .12s ease}`,
					`.dgt-input::placeholder{color:var(--dsw-alias-markdown-placeholder,var(--dsw-alias-label-tertiary))}`,
					`.dgt-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}`,
					`.dgt-primaryBtn{display:inline-flex;align-items:center;height:30px;padding:0 14px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:var(--dsw-font-xs-strong-13);cursor:pointer;transition:background .12s ease,transform .1s ease;white-space:nowrap}`,
					`.dgt-primaryBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}`,
					`.dgt-primaryBtn:active:not(:disabled){transform:scale(.98)}`,
					`.dgt-primaryBtn:disabled{opacity:.35;cursor:not-allowed}`,
					`.dgt-content{max-width:920px;margin:0 auto}`,
					// ── 空态 / 错误 ──────────────────────────────────
					`.dgt-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:220px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);text-align:center}`,
					`.dgt-emptyIcon{font-size:28px;line-height:1;opacity:.45}`,
					// ── diff 详情面板（材质化推入）─────────────────────────
					`.dgt-panel{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);animation:dgtPanelIn .28s cubic-bezier(.32,.72,0,1) both}`,
					`.dgt-panelOut{animation:dgtPanelOut .22s cubic-bezier(.32,.72,0,1) both}`,
					`@keyframes dgtPanelIn{from{transform:translateX(18%);opacity:.4}to{transform:none;opacity:1}}`,
					`@keyframes dgtPanelOut{to{transform:translateX(24%);opacity:0}}`,
					`.dgt-panelBar{flex:none;display:flex;align-items:center;gap:10px;height:44px;padding:0 12px;background:color-mix(in srgb,var(--dsw-specific-menu) 82%,transparent);backdrop-filter:var(--dsw-menu-backdrop-filter);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);border-bottom:0.5px solid var(--dsw-alias-border-l3)}`,
					`.dgt-backBtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;cursor:pointer;transition:background .12s ease,color .12s ease}`,
					`.dgt-backBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
					`.dgt-backBtn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}`,
					`.dgt-panelFile{display:flex;align-items:baseline;gap:7px;min-width:0;overflow:hidden;white-space:nowrap;font-weight:500}`,
					`.dgt-panelBar .dgt-toolSpacer{flex:1}`,
					`.dgt-panelBar .dgt-stat{font:var(--dsw-font-xxs-12)}`,
					`.dgt-qbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}`,
					`.dgt-qbtn:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}`,
					`.dgt-qbtnDanger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}`,
					`.dgt-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}`,
					// ── diff 行渲染（Xcode 式：左缘 marker + 单侧行号 + word-diff）─
					`.dgt-diffBody{padding:8px 0 14px;font-family:var(--dsw-font-markdown-code-block-font-family,ui-monospace,Menlo,monospace);font-size:12px;line-height:20px}`,
					`.dgt-line{display:grid;grid-template-columns:4px 3.4em minmax(max-content,100%);box-sizing:border-box;min-width:100%;width:max-content;min-height:20px;line-height:20px;white-space:pre}`,
					`.dgt-marker{width:3px;margin:0 1px 0 0;border-radius:0 2px 2px 0}`,
					`.dgt-markerAdd{background:var(--dsw-alias-file-diff-added-marker)}`,
					`.dgt-markerDel{background:var(--dsw-alias-file-diff-deleted-marker)}`,
					`.dgt-no{min-width:3.2em;padding-right:10px;text-align:right;color:var(--dsw-alias-label-tertiary);user-select:none;font-variant-numeric:tabular-nums;position:sticky;left:0;background:var(--dsw-alias-bg-base)}`,
					`.dgt-lineAdd .dgt-no{background:var(--dsw-alias-file-diff-added-gutter,var(--dsw-alias-file-diff-added-bg))}`,
					`.dgt-lineDel .dgt-no{background:var(--dsw-alias-file-diff-deleted-gutter,var(--dsw-alias-file-diff-deleted-bg))}`,
					`.dgt-code{padding-right:16px;min-width:0;white-space:pre}`,
					`.dgt-lineAdd{background:var(--dsw-alias-file-diff-added-bg)}`,
					`.dgt-lineDel{background:var(--dsw-alias-file-diff-deleted-bg)}`,
					`.dgt-lineAdd .dgt-no{color:var(--dsw-alias-file-diff-added-marker)}`,
					`.dgt-lineDel .dgt-no{color:var(--dsw-alias-file-diff-deleted-marker)}`,
					`.dgt-ctxCode{color:var(--dsw-alias-label-secondary)}`,
					`.dgt-wDel{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,transparent);color:var(--dsw-alias-label-primary-foreground,#fff);border-radius:3px;padding:0 1px}`,
					`.dgt-wAdd{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 85%,transparent);color:var(--dsw-alias-label-primary-foreground,#fff);border-radius:3px;padding:0 1px}`,
					`.dgt-hunk{display:flex;align-items:center;gap:8px;height:22px;margin:8px 0 0;padding:0 12px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);font-family:var(--dsw-font-markdown-code-block-font-family,ui-monospace,Menlo,monospace);background:var(--dsw-alias-interactive-bg-hover);border-top:0.5px solid var(--dsw-alias-border-l3);border-bottom:0.5px solid var(--dsw-alias-border-l3)}`,
					`.dgt-hunkGap{height:8px}`,
					// ── toast ─────────────────────────────────────────
					`.dgt-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:9999;max-width:60%;padding:8px 16px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-toast-bg,var(--dsw-alias-label-primary));color:var(--dsw-alias-toast-label,var(--dsw-alias-bg-base));font:var(--dsw-font-xxs-12);box-shadow:var(--dsw-elevation-prominent,0 6px 20px rgba(0,0,0,.18));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
					`.dgt-toastErr{background:var(--dsw-alias-state-error-primary);color:#fff}`,
					`@media (prefers-reduced-motion:reduce){.dgt-panel,.dgt-panelOut{animation:none}.dgt-listView{transition:none}.dgt-commitBtn,.dgt-miniBtn,.dgt-iconBtn,.dgt-genBtn,.dgt-kebab,.dgt-check,.dgt-row,.dgt-msg,.dgt-input,.dgt-backBtn,.dgt-branchChip,.dgt-logItem,.dgt-brRow,.dgt-menuBtn,.dgt-primaryBtn,.dgt-qbtn{transition:none}}`,
					`@media (prefers-reduced-transparency:reduce){.dgt-toolbar,.dgt-footer,.dgt-panelBar{background:var(--dsw-alias-bg-base);backdrop-filter:none;-webkit-backdrop-filter:none}}`,
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

			// ── FileRow：复选框 | 徽标 | 图标 | 主名/目录 | ±stat | ⋯（GitHub Desktop 序）──
			function FileRow(props) {
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
							onChange: () => onCheck(checked ? "unstage" : "stage", row),
						}),
						h("button", { type: "button", className: "dgt-rowBtn" + (expanded ? " dgt-rowActive" : ""), onClick: onToggle, "aria-expanded": expanded, title: row.orig ? row.orig + " → " + row.path : row.path },
							h("span", { className: "dgt-badge " + badgeClass }, letter),
							h(FileTypeIcon, { path: row.path, size: 14, className: "dgt-fileicon" }),
							h("span", { className: "dgt-nameWrap" },
								h("span", { className: "dgt-baseName" }, base),
								dir !== "" ? h("span", { className: "dgt-dirName" }, dir) : null,
							),
							h("span", { className: "dgt-stat" },
								row.binary ? t("binaryShort") : showStat ? [h("span", { className: "dgt-add", key: "a" }, "+" + (row.add ?? 0)), " ", h("span", { className: "dgt-del", key: "d" }, "−" + (row.del ?? 0))] : null),
						),
						h("button", { type: "button", className: "dgt-kebab", onClick: () => setMenuOpen((v) => !v), "aria-haspopup": "menu", "aria-expanded": menuOpen, title: t("more") }, "⋯"),
					),
					menuOpen ? h(Menu, {
						open: true,
						anchor: h("span", null),
						items,
						onSelect: (id) => { setMenuOpen(false); onAction(id, row, area); },
						onClose: () => setMenuOpen(false),
					}) : null,
					expanded ? h("div", { className: "dgt-expandRow" }, props.children) : null,
				);
			}

			// ── 确认对话框（官方 RiskConfirmation）─────────────────────
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
				const t = typeof props.t === "function" ? props.t : (k) => k;
				useSyncExternalStore((fn) => bridge.subscribe(fn), () => bridge.version, () => bridge.version);
				const cwd = bridge.cwd;
				const isRepo = bridge.isRepo;

				const sessionId = bridge.sessionId;
				const [tab, setTab] = useState("changes");
				const [statusData, setStatusData] = useState(null);
				const [branches, setBranches] = useState([]);
				const [commits, setCommits] = useState([]);
				const [error, setError] = useState(null);
				const [busy, setBusy] = useState(false);
				const [openSha, setOpenSha] = useState(null);
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

				const showToast = useCallback((text, tone) => {
					setToast({ text, tone });
					setTimeout(() => setToast((cur) => (cur !== null && cur.text === text ? null : cur)), 3600);
				}, []);

				const refresh = useCallback(async (alsoBranches) => {
					if (!cwd || !isRepo) return;
					const seq = ++seqRef.current;
					// /overview 聚合：status+commits+branches 一个往返（host 内并行 + TTL 防连击）
					const ov = await apiGet("/overview", { sessionId });
					if (seq !== seqRef.current) return; // 过期响应丢弃
					if (!ov.ok) { setError(ov.error); return; }
					if (ov.status !== null) { setStatusData(ov.status); setError(null); } else setError(ov.statusError);
					setCommits(ov.commits ?? []);
					setTotals(ov.totals ?? null);
					if (alsoBranches) setBranches(ov.branches ?? []);
					bridge.patch({ isRepo: ov.isRepo === true });
					repoCachePut(cwd, { status: ov.status, commits: ov.commits ?? [], branches: ov.branches ?? [], totals: ov.totals ?? null });
				}, [cwd, isRepo, sessionId]);

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
					setOpenSha(null); setShaFiles(null);
					if (!cwd || !isRepo) { setStatusData(null); return; }
					const cached = repoCacheGet(cwd);
					if (cached !== null) {
						setStatusData(cached.status);
						setCommits(cached.commits);
						setBranches(cached.branches);
						setTotals(cached.totals ?? null);
						setError(null);
					} else {
						setStatusData(null);
						setError(null);
					}
					void refresh(true);
				}, [cwd, isRepo, refresh]);

				// 展开提交 → 拉 show-diff
				useEffect(() => {
					if (openSha === null || !cwd) { setShaFiles(null); return; }
					let live = true;
					apiGet("/show-diff", { sessionId, sha: openSha }).then((r) => {
						if (live) setShaFiles(r.ok ? r.files : []);
					});
					return () => { live = false; };
				}, [cwd, openSha]);

				const runAction = useCallback(async (action, args) => {
					if (busy || !cwd) return null;
					setBusy(true);
					try {
						const r = await apiAction(sessionId, action, args);
						if (r.ok) {
							markPreloadStale();
							await refresh(true);
							if (action === "commit" || action === "amend") {
								setMessage("");
								setAmend(false);
							}
							showToast(r.tip ? action + " · " + r.tip : t("done"), "success");
						} else {
							showToast(t("failed") + "：" + (r.hint ? r.hint + " · " : "") + String(r.error ?? "").slice(0, 160), undefined);
						}
						return r;
					} finally {
						setBusy(false);
					}
				}, [busy, cwd, refresh, showToast, t, markPreloadStale]);

				const onFileAction = useCallback((id, row, area) => {
					if (id === "diff") {
						setViewing({ path: row.path, area });
						return;
					}
					if (id === "stage") return void runAction("stage", { paths: [row.path] });
					if (id === "unstage") return void runAction("unstage", { paths: [row.path] });
					if (id === "discard") {
						setConfirmState({
							title: t("discardTitle"),
							description: t("discardDesc", { path: row.path }),
							action: "discard",
							args: { paths: [row.path] },
						});
					}
				}, [runAction, t]);

				const toggleRow = useCallback((row, area) => {
					setViewing({ path: row.path, area });
				}, []);
				const openPanel = useCallback((row, area) => {
					setViewing({ path: row.path, area });
				}, []);
				const closePanel = useCallback(() => {
					if (viewing === null) return;
					setPanelClosing(true);
					setTimeout(() => { setViewing(null); setPanelClosing(false); }, 220);
				}, [viewing]);
				const onCheck = useCallback((what, row) => {
					void runAction(what, { paths: [row.path] });
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

				if (!isRepo) return h("div", { className: "dgt-root" }, h("div", { className: "dgt-empty" }, h("span", { className: "dgt-emptyIcon" }, "◇"), t("notRepo")));
				if (statusData === null && error === null) return h("div", { className: "dgt-root" }, h("div", { className: "dgt-empty" }, t("checking")));

				const renderSection = (section) => {
					const rows = section === "staged" ? statusData.staged : section === "changes" ? statusData.changes : statusData.untracked;
					if (rows.length === 0 && section !== "staged") return null;
					const area = section === "staged" ? "staged" : section === "untracked" ? "untracked" : "unstaged";
					return h("div", { className: "dgt-section", key: section },
						h("div", { className: "dgt-sectionHead" },
							h("span", null, t(section === "untracked" ? "untracked" : section === "staged" ? "staged" : "changes")),
							h("span", { className: "dgt-sectionCount" }, "(" + rows.length + ")"),
							h("span", { className: "dgt-sectionSpacer" }),
							section === "staged" && rows.length > 0
								? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("unstage-all", {}) }, t("unstageAll"))
								: null,
							section === "changes" && (rows.length > 0 || statusData.untracked.length > 0)
								? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("stage-all", {}) }, t("stageAll"))
								: null,
						),
						rows.length > 0 ? h("ul", { className: "dgt-card" }, rows.map((row) => {
							return h(FileRow, {
								key: row.path + ":" + row.label,
								t, row, section,
								expanded: false,
								onToggle: () => toggleRow(row, area),
								onAction: onFileAction,
								onCheck,
							});
						})) : null,
					);
				};

				const panelOf = () => {
					if (tab === "changes") {
						if (statusData.staged.length === 0 && statusData.changes.length === 0 && statusData.untracked.length === 0) {
							return h("div", { className: "dgt-empty" }, h("span", { className: "dgt-emptyIcon" }, "✓"), t("emptyRepo"));
						}
						const tt = totals ?? { files: 0, add: 0, del: 0 };
						return h("div", null,
							h("div", { className: "dgt-toolRow" },
								h("span", { className: "dgt-toolStat" },
									"± ",
									h("span", { className: "dgt-add" }, "+" + tt.add.toLocaleString()),
									h("span", { className: "dgt-del" }, "−" + tt.del.toLocaleString()),
								),
								h("span", { className: "dgt-toolSpacer" }),
								(statusData.staged.length > 0 || statusData.changes.length > 0 || statusData.untracked.length > 0)
									? h("button", { type: "button", className: "dgt-miniBtn dgt-miniBtnPrimary", disabled: busy, onClick: () => void runAction("stage-all", {}) }, t("stageAll"))
									: null,
								statusData.staged.length > 0
									? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("unstage-all", {}) }, t("unstageAll"))
									: null,
							),
							renderSection("staged"), renderSection("changes"), renderSection("untracked"),
						);
					}
					if (tab === "history") {
						return h("ul", { className: "dgt-card" },
							commits.map((c) => h("li", { key: c.sha },
								h("div", { className: "dgt-logItem" },
									h("button", { type: "button", className: "dgt-logBtn", onClick: () => setOpenSha(openSha === c.sha ? null : c.sha), "aria-expanded": openSha === c.sha },
										h("span", { className: "dgt-logSha" }, c.sha.slice(0, 7)),
										h("span", { className: "dgt-logSubj" }, c.subject),
										h("span", { className: "dgt-logMeta" }, c.author + " · " + new Date(c.time).toLocaleString()),
									),
									h("button", { type: "button", className: "dgt-menuBtn", onClick: () => { void writeClipboard(c.sha); showToast(t("copySha") + " ✓"); } }, "⧉"),
								),
								openSha === c.sha && shaFiles !== null
									? h("div", { className: "dgt-logExpand" },
										shaFiles.map((f) => h("div", { key: f.path, style: { marginBottom: 10 } },
											h("div", { className: "dgt-track", style: { marginBottom: 4 } }, h(PathLabel, { path: f.path })),
											h(DiffView, { t, diff: f }),
										)))
									: null,
							)),
						);
					}
					return h("div", null,
						h("ul", { className: "dgt-card" },
							branches.map((b) => h("li", { key: b.name },
								h("div", { className: "dgt-brRow" + (b.current ? " dgt-brRowCurrent" : "") },
									h("span", { className: "dgt-brName" },
										h("span", { className: "dgt-badge " + (b.current ? "dgt-badgeA" : "dgt-badgeU") }, b.current ? "✓" : "·"),
										h("span", { className: "dgt-brLabel" }, b.name),
										b.upstream ? h("span", { className: "dgt-track" }, "→ " + b.upstream + " ↑" + b.ahead + " ↓" + b.behind) : null,
									),
									b.current
										? h("span", { className: "dgt-brPill" }, t("current"))
										: h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("switch", { branch: b.name }).then((r) => { if (r && r.ok) showToast(t("switched") + " " + b.name); }) }, t("switchTo")),
								),
							)),
						),
						h("div", { className: "dgt-newBranch" },
							h("input", {
								className: "dgt-input", value: newBranch, placeholder: t("newBranch"),
								onChange: (e) => setNewBranch(e.target.value),
								onKeyDown: (e) => {
									if (e.key === "Enter" && newBranch.trim() !== "" && !busy) {
										void runAction("create-branch", { branch: newBranch.trim() }).then((r) => { if (r && r.ok) { showToast(t("created") + " " + newBranch.trim()); setNewBranch(""); } });
									}
								},
							}),
							h("button", {
								type: "button", className: "dgt-primaryBtn", disabled: busy || newBranch.trim() === "",
								onClick: () => void runAction("create-branch", { branch: newBranch.trim() }).then((r) => { if (r && r.ok) { showToast(t("created") + " · " + t("switched")); setNewBranch(""); } }),
							}, t("createSwitch")),
						),
					);
				};

				// 活跃文件行（面板返回后高亮）
				const branch = statusData?.branch ?? "…";
				const isChanges = tab === "changes";
				const dirtyCount = statusData !== null ? statusData.staged.length + statusData.changes.length + statusData.untracked.length : 0;
				const ahead = statusData?.ahead ?? 0;
				const behind = statusData?.behind ?? 0;
				const onTabChange = (v) => {
					setTab(v); setViewing(null); setPanelClosing(false);
					if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
				};

				return h("div", { className: "dgt-root", role: "tabpanel", "aria-label": t("title") },
					// 顶部 toolbar：分支 chip | 分段页签 | 同步操作（GitHub Desktop 顶栏）
					h("div", { className: "dgt-toolbar" },
						h("div", { className: "dgt-tbBranch" },
							h("button", {
								type: "button", className: "dgt-branchChip",
								onClick: () => onTabChange("branch"), title: t("branch"),
							},
								h("span", { className: "dgt-branchIcon", "aria-hidden": "true" }, "⑂"),
								h("span", { className: "dgt-chipName" }, branch),
								h("span", { className: "dgt-chipCaret", "aria-hidden": "true" }, "▾"),
							),
						),
						h("div", { className: "dgt-tabsWrap" },
							h(SegmentedTabs, {
								className: "dgt-tabs",
								label: t("title"),
								value: tab,
								onChange: onTabChange,
								items: [
									{ value: "changes", id: "dgt-tab-changes", panelId: "dgt-body",
										label: dirtyCount > 0 ? [t("changesTab"), " ", h("span", { className: "dgt-badgeN", key: "n" }, String(dirtyCount))] : t("changesTab") },
									{ value: "history", id: "dgt-tab-history", panelId: "dgt-body", label: t("history") },
									{ value: "branch", id: "dgt-tab-branch", panelId: "dgt-body", label: t("branch") },
								],
							}),
						),
						h("div", { className: "dgt-sync" },
							h("button", { type: "button", className: "dgt-iconBtn", disabled: busy, onClick: () => void runAction("fetch", {}), title: t("fetch") }, "⟳ ", t("fetch")),
							h("button", { type: "button", className: "dgt-iconBtn", disabled: busy, onClick: () => void runAction("pull", {}), title: t("pull") },
								"↓ ", t("pull"), behind > 0 ? h("span", { className: "dgt-badgeN" }, String(behind)) : null),
							h("button", { type: "button", className: "dgt-iconBtn", disabled: busy, onClick: () => void runAction("push", {}), title: t("push") },
								"↑ ", t("push"), ahead > 0 ? h("span", { className: "dgt-badgeN" }, String(ahead)) : null),
						),
					),
					// 主区：列表 + 底部提交区；diff 面板覆盖其上
					h("div", { className: "dgt-main" },
						h("div", { className: "dgt-body", ref: bodyRef, id: "dgt-body", role: "tabpanel" },
							error !== null
								? h("div", { className: "dgt-content" }, h("div", { className: "dgt-empty" }, String(error),
									h("button", { type: "button", className: "dgt-miniBtn", onClick: () => void refresh(true) }, t("reload"))))
								: h("div", { className: "dgt-bodyInner" },
									h("div", { className: "dgt-listView" + (viewing !== null ? " dgt-listPushed" : "") },
										panelOf(),
									),
								),
						),
						isChanges
							? h("div", { className: "dgt-footer" + (viewing !== null ? " dgt-listPushed" : "") },
								h("div", { className: "dgt-commitInner" },
									h("div", { className: "dgt-commitLeft" },
										h("textarea", { className: "dgt-msg", value: message, placeholder: t("commitMsg"), onChange: (e) => setMessage(e.target.value), rows: 2 }),
										h("div", { className: "dgt-msgRow" },
											h("button", {
												type: "button", className: "dgt-genBtn", disabled: genBusy || (statusData !== null && statusData.staged.length === 0),
												onClick: doGenerate,
												title: statusData !== null && statusData.staged.length === 0 ? t("genEmpty") : undefined,
											}, genBusy ? "◌ " + t("genMsgBusy") : "✦ " + t("genMsg")),
											h("span", { className: "dgt-msgSpacer" }),
											h("label", { className: "dgt-amend" },
												h("input", { type: "checkbox", checked: amend, onChange: (e) => setAmend(e.target.checked) }),
												t("amend"),
											),
										),
									),
									h("button", { type: "button", className: "dgt-commitBtn", disabled: busy || message.trim() === "" || (statusData !== null && statusData.staged.length === 0), onClick: doCommit, title: statusData !== null && statusData.staged.length === 0 ? t("dirtyWorktree") : undefined }, busy ? t("busy") : t("commit")),
								),
							)
							: null,
						// Diff 详情面板（覆盖 body+footer；推入/推出动效）
						viewing !== null
							? h("div", { className: "dgt-panel" + (panelClosing ? " dgt-panelOut" : ""), role: "dialog", "aria-label": viewing.path },
								h("div", { className: "dgt-panelBar" },
									h("button", { type: "button", className: "dgt-backBtn", onClick: closePanel, "aria-label": t("hideDiff") }, "‹"),
									h("span", { className: "dgt-panelFile" },
										h("span", { className: "dgt-badge " + (viewing.area === "staged" ? "dgt-badgeA" : viewing.area === "untracked" ? "dgt-badgeU" : "dgt-badgeM") },
											viewing.area === "staged" ? "A" : viewing.area === "untracked" ? "U" : "M"),
										h("span", null, viewing.path),
									),
									h("span", { className: "dgt-toolSpacer" }),
									viewing.area === "staged"
										? h("button", { type: "button", className: "dgt-miniBtn", disabled: busy, onClick: () => void runAction("unstage", { paths: [viewing.path] }) }, t("unstage"))
										: h("button", { type: "button", className: "dgt-miniBtn dgt-miniBtnPrimary", disabled: busy, onClick: () => void runAction("stage", { paths: [viewing.path] }) }, t("stage")),
									h("button", { type: "button", className: "dgt-qbtn dgt-qbtnDanger", title: t("discard"), onClick: () => onFileAction("discard", { path: viewing.path }, viewing.area) }, "↩"),
								),
								h("div", { className: "dgt-scroll" },
									panelDiff !== null
										? h(DiffView, { diff: panelDiff })
										: h("div", { className: "dgt-empty" }, t("checking")),
								),
							)
							: null,
					),
					h(ConfirmHost, {
						t, state: confirmState,
						onCancel: () => setConfirmState(null),
						onConfirm: (st) => { setConfirmState(null); void runAction(st.action, st.args); },
					}),
					h(ToastHost, { toast, onDone: () => setToast(null) }),
				);
			}

			// ── Probe（header.corner 隐形探测）──────────────────────────
			// cwd 由 host 侧 sessions 服务解析（sessionId → header.cwd，三级回退先例）；
			// client 侧 useSession snapshot 无 cwd 字段（实测），不赌。
			function Probe(props) {
				const sessionId = props.sessionId;

				useEffect(() => {
					let cancelled = false;
					let timer = null;
					const diag = (msg, extra) => {
						try {
							const log = JSON.parse(localStorage.getItem("dsh-git-tab-diag") ?? "[]");
							log.push({ at: new Date().toISOString(), msg, extra: extra === undefined ? null : extra });
							localStorage.setItem("dsh-git-tab-diag", JSON.stringify(log.slice(-20)));
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
			//   · probe: 等 header.corner 声明（= 会话 header 渲染）才挂探测组件
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
				}, "dsh-git-tab: dictionaries");
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
						console.log("[dsh-git-tab] git tab registered (order " + VIEW_ORDER + ")");
					} catch (error) {
						console.error("[dsh-git-tab] register failed", error);
					}
				}
				function disposeGitTab() {
					if (gitDispose === null) return;
					try { gitDispose(); } catch { /* 已被卸载 */ }
					gitDispose = null;
					console.log("[dsh-git-tab] git tab disposed");
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
							window.__dshGitErrors = (window.__dshGitErrors || []).concat(text).slice(-10);
							localStorage.setItem("dsh-git-errors", JSON.stringify(window.__dshGitErrors));
						} catch { /* 忽略 */ }
					});
					ctx.effect(() => offEntryError, "dsh-git-tab: entry-error probe");
				} catch { /* 未提供 onEntryError */ }

				// probe 条目：inject 等 corner 声明（会话 header 渲染时声明出现）；
				// callback 里 register Probe，渲染 null 不占位。
				// 2026-10-15 冲突修复：header.corner 是 SINGLE slot，官方 ExpandButton 占
				// priority 0（默认）。本 probe 原写 order:0（single slot 忽略 order）→ priority
				// 落默认 0 → 同 priority 抛 "already has a registration" → 官方右栏整包
				// boot 失败（tab 条全消失）。single slot 规则（ui-slots index.ts:1278）：priority
				// 升序、第一个渲染、不同 priority 可共存 —— probe 用 priority 100 永不渲染
				// （官方按钮照常显示），仅作为 cwd 探测的挂载点存在。
				ctx.slots.inject(PROBE_SLOT, () => ctx.slots.register(
					{
						name: PROBE_SLOT,
						id: "git-probe",
						priority: 100,
						locale: NS,
						inject: () => ({}),
					},
					Probe,
				));

				ctx.effect(() => () => disposeGitTab(), "dsh-git-tab: dispose git entry");
			}

			exports.name = "dsh-git-tab";
			exports.inject = ["slots", "locale"];
			exports.apply = apply;
			return module.exports;
		},
	});
} catch (error) {
	// 同 id 重复注册（脚本在 rev 更新后重执行）= 已注册过，无害；其余错误照抛
	if (!(error instanceof Error) || !/duplicate factory registration/.test(error.message)) throw error;
}
