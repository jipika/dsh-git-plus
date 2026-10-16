// dsh-git-tab 真实组件预览 —— 在浏览器里跑 lib/client.js 的真实 factory
// （mock __ModuleLoader__/ctx.slots/ctx.locale/fetch），DOM 结构、installStyle 注入的 CSS、
// 文件行/分组卡/toolbar/composer 全部是产出级真值。改 client.js 后 1.2s 自动刷新。
//   node preview-server.mjs  →  http://127.0.0.1:4170/?theme=light|dark
import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(ROOT, "lib/client.js");
const PORT = 4170;

// 亮主题：2026-10-15 从活的 DSH GUI body getComputedStyle 抓的真实计算值
const LIGHT = {
  "--dsw-alias-bg-base": "#fff", "--dsw-alias-bg-layer-1": "#fff",
  "--dsw-alias-bg-layer-2": "#f5f6f7", "--dsw-alias-bg-layer-3": "#fff",
  "--dsw-alias-bg-module-platform": "#f5f6f7",
  "--dsw-alias-label-primary": "#0f1115", "--dsw-alias-label-secondary": "#61666b",
  "--dsw-alias-label-tertiary": "#81858c", "--dsw-alias-label-primary-foreground": "#fff",
  "--dsw-alias-border-l1": "rgba(0,0,0,.04)", "--dsw-alias-border-l2": "rgba(0,0,0,.08)",
  "--dsw-alias-border-l3": "#0000001f", "--dsw-alias-border-l4": "rgba(0,0,0,.16)",
  "--dsw-alias-label-dimmed": "rgb(233,236,242)",
  "--dsw-font-family-code": '"SF Mono","JetBrains Mono","Fira Code",Consolas,Menlo,monospace',
  "--dsw-font-markdown-code-block": '11px/19px var(--dsw-font-family-code)',
  "--dsw-alias-brand-primary": "#0f1115",
  "--dsw-alias-interactive-bg-hover": "#2631480f", "--dsw-alias-interactive-bg-active": "#2631481a",
  "--dsw-alias-state-success-primary": "#22c55e", "--dsw-alias-state-error-primary": "#ec1313",
  "--dsw-alias-state-warn-primary": "#f59e0b", "--dsw-alias-state-business-primary": "#4176e6",
  "--dsw-alias-link": "#4176e6",
  "--dsw-alias-button-primary-fill": "#0f1115", "--dsw-alias-button-primary-hover": "#43454a",
  "--dsw-alias-markdown-placeholder": "#f5f6f7",
  "--dsw-alias-file-diff-added-bg": "#e6f4e7", "--dsw-alias-file-diff-added-gutter": "#edf7ed",
  "--dsw-alias-file-diff-added-marker": "#01a241", "--dsw-alias-file-diff-deleted-bg": "#fce6e2",
  "--dsw-alias-file-diff-deleted-gutter": "#fdece9", "--dsw-alias-file-diff-deleted-marker": "#ba2723",
  "--dsw-alias-toast-bg": "#353638", "--dsw-alias-toast-label": "#fff",
  "--dsw-specific-menu": "#f8f9fa94", "--dsw-menu-backdrop-filter": "blur(40px) saturate(150%)",
  "--dsw-alias-scrollbar-bg-l2": "#e5e5e5", "--dsw-alias-scrollbar-hover-l2": "#d4d4d4",
  "--dsw-radius-xs": "4px", "--dsw-radius-sm": "8px", "--dsw-radius-md": "12px", "--dsw-radius-lg": "16px",
  "--dsw-focus-ring-width": "2px", "--dsw-focus-ring-color": "#4176e6",
  "--dsw-font-family": '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif',
  "--dsw-font-xs-13": '13px/20px var(--dsw-font-family)',
  "--dsw-font-xs-strong-13": '500 13px/20px var(--dsw-font-family)',
  "--dsw-font-xxs-12": '12px/18px var(--dsw-font-family)',
  "--dsw-font-xxxs-11": '11px/14px var(--dsw-font-family)',
  "--dsw-font-xxxs-strong-11": '500 11px/14px var(--dsw-font-family)',
  "--dsw-font-markdown-code-block-font-family": '"SF Mono","JetBrains Mono","Fira Code",Consolas,"Liberation Mono",Menlo,Courier,"PingFang SC","Microsoft YaHei"',
  "--dsw-elevation-stroke": "0 0 0 .5px #00000029",
  "--dsw-elevation-prominent": "0 0 0 .5px #00000029,0 3px 8px 0 #0000000a,0 0 20px 0 #0000000d",
  "--dsw-elevation-stroke-color": "#00000029",
};

// 暗主题：design-platform.css 的 body[data-ds-dark-theme] 展开为具体值
const DARK = {
  "--dsw-alias-bg-base": "rgb(22,23,27)", "--dsw-alias-bg-layer-1": "rgb(33,34,40)",
  "--dsw-alias-bg-layer-2": "rgb(38,39,45)", "--dsw-alias-bg-layer-3": "rgb(44,45,52)",
  "--dsw-alias-bg-module-platform": "rgb(44,45,52)",
  "--dsw-alias-label-primary": "rgb(246,247,249)", "--dsw-alias-label-secondary": "rgb(188,190,197)",
  "--dsw-alias-label-tertiary": "rgb(163,165,173)", "--dsw-alias-label-primary-foreground": "rgb(15,17,21)",
  "--dsw-alias-border-l1": "rgba(255,255,255,.06)", "--dsw-alias-border-l2": "rgba(255,255,255,.12)",
  "--dsw-alias-border-l3": "rgba(255,255,255,.16)", "--dsw-alias-border-l4": "rgba(255,255,255,.2)",
  "--dsw-alias-label-dimmed": "rgb(50,52,59)",
  "--dsw-font-family-code": '"SF Mono","JetBrains Mono","Fira Code",Consolas,Menlo,monospace',
  "--dsw-font-markdown-code-block": '11px/19px var(--dsw-font-family-code)',
  "--dsw-alias-brand-primary": "rgb(246,247,249)",
  "--dsw-alias-interactive-bg-hover": "rgba(255,255,255,.08)", "--dsw-alias-interactive-bg-active": "rgba(255,255,255,.14)",
  "--dsw-alias-state-success-primary": "rgb(34,197,94)", "--dsw-alias-state-error-primary": "rgb(250,80,72)",
  "--dsw-alias-state-warn-primary": "rgb(245,158,11)", "--dsw-alias-state-business-primary": "rgb(122,170,255)",
  "--dsw-alias-link": "rgb(122,170,255)",
  "--dsw-alias-button-primary-fill": "rgb(246,247,249)", "--dsw-alias-button-primary-hover": "rgb(235,238,242)",
  "--dsw-alias-markdown-placeholder": "rgb(38,39,45)",
  "--dsw-alias-file-diff-added-bg": "rgb(31,49,36)", "--dsw-alias-file-diff-added-gutter": "rgb(19,32,22)",
  "--dsw-alias-file-diff-added-marker": "rgb(65,201,119)", "--dsw-alias-file-diff-deleted-bg": "rgb(60,31,27)",
  "--dsw-alias-file-diff-deleted-gutter": "rgb(40,19,14)", "--dsw-alias-file-diff-deleted-marker": "rgb(250,66,62)",
  "--dsw-alias-toast-bg": "rgb(50,52,59)", "--dsw-alias-toast-label": "rgb(255,255,255)",
  "--dsw-specific-menu": "rgba(67,69,74,.45)",
  "--dsw-alias-scrollbar-bg-l2": "rgb(84,85,87)", "--dsw-alias-scrollbar-hover-l2": "rgb(101,103,107)",
  "--dsw-elevation-stroke": "0 0 0 .5px rgba(255,255,255,.16)",
  "--dsw-elevation-prominent": "0 0 0 .5px rgba(255,255,255,.16),0 3px 8px 0 rgba(0,0,0,.2),0 0 20px 0 rgba(0,0,0,.25)",
  "--dsw-elevation-stroke-color": "rgba(255,255,255,.16)",
};

const cssVars = (obj) => Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(";");

function page() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="/vendor/react.production.min.js"><\/script>
<script src="/vendor/react-dom.production.min.js"><\/script>
<style id="tokens"></style>
<style>
*{box-sizing:border-box}
body{margin:0;font:var(--dsw-font-xs-13);background:#d2d3d6;color:var(--dsw-alias-label-primary)}
body[data-theme="dark"]{background:#0b0c0e}
.frame{width:780px;height:620px;margin:24px auto 30px;border-radius:14px;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,.28);background:var(--dsw-alias-bg-base)}
.err{color:#c00;padding:16px;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;max-width:780px;margin:0 auto}
</style></head><body>
<div class="frame"><div id="app" style="height:620px;overflow-y:auto"></div></div>
<div id="err" class="err"></div>
<script type="module">
const params = new URLSearchParams(location.search);
const theme = params.get("theme") || "light";
const view = params.get("view") || "changes";
document.body.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;
document.getElementById("tokens").textContent = "body{" + (${JSON.stringify(cssVars(LIGHT))}) + "}" +
  (theme === "dark" ? "\\nbody{" + (${JSON.stringify(cssVars(DARK))}) + "}" : "");

const React = window.React, h = React.createElement;
const prim = {
  SegmentedTabs: (p) => h("div", { className: p.className || "", role: "tablist", "aria-label": p.label,
      style: { display: "grid", gridTemplateColumns: "repeat(" + p.items.length + ",minmax(0,1fr))", padding: 4, borderRadius: "var(--dsw-radius-lg)", background: "var(--dsw-alias-bg-module-platform)" } },
    p.items.map((it) => h("button", { key: it.value, id: it.id, role: "tab", "aria-selected": p.value === it.value, "aria-controls": it.panelId,
        onClick: () => p.onChange(it.value),
        style: { position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", height: 34, padding: "0 12px", border: "none", borderRadius: "var(--dsw-radius-md)", font: "14px/20px var(--dsw-font-family)", cursor: "pointer", background: p.value === it.value ? "var(--dsw-alias-bg-layer-3)" : "transparent", color: p.value === it.value ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)", fontWeight: p.value === it.value ? 600 : 400, boxShadow: p.value === it.value ? "0 0 0 .5px var(--dsw-alias-border-l3)" : "none", transition: "color 180ms ease,background 180ms ease" } }, it.label))),
  Menu: () => null, RiskConfirmation: () => null, Toast: () => null,
  PathLabel: (p) => h("span", null, p.path),
  FileTypeIcon: () => h("span", { style: { fontSize: 12 } }, "📄"),
  useCodeHighlighter: undefined, languageForPath: () => undefined, writeClipboard: () => {},
};

const STATUS = { ok: true, branch: "ui-redesign", upstream: "origin/ui-redesign", ahead: 2, behind: 0, isRepo: true,
  staged: [{ path: "lib/client.js", x: "M", y: " ", label: "M ", add: 96, del: 30, binary: false }],
  changes: [{ path: "lib/index.js", x: " ", y: "M", label: " M", add: 12, del: 8, binary: false }, { path: "README.md", x: " ", y: "M", label: " M", add: 20, del: 2, binary: false }],
  untracked: [{ path: "NOTES.md", x: "?", y: "?", label: "??", add: null, del: null, binary: false }] };
const COMMITS = [
  { sha: "a3f9c21d8e", subject: "✨ feat(ui): 重写 Git 标签页为 Apple 风格", author: "wren", email: "9453067+wren@users.noreply.github.com", avatar: "https://github.com/wren.png", time: Date.now() - 12 * 60e3, body: "顶部分支 chip + 官方分段页签 + 同步组；\\n分组卡片承载文件段；全部走 --dsw-* token 跟随主题。" },
  { sha: "8b1e044a2c", subject: "🐛 fix: probe priority 撞 ExpandButton", author: "wren", email: "wren@example.com", avatar: "https://www.gravatar.com/avatar/3bd149794615ef667cebf54ca8eb6c85?d=404&s=64", time: Date.now() - 3 * 3600e3, body: "" },
  { sha: "f7d1208abc", subject: "♻️ refactor: 摘要行与段头动作归位", author: "lixiongwei", email: "kiritte@outlook.com", avatar: "https://www.gravatar.com/avatar/3bd149794615ef667cebf54ca8eb6c85?d=404&s=64", time: Date.now() - 26 * 3600e3, body: "stageAll 移到摘要行右侧，空段隐藏后入口不丢。" },
  { sha: "c22d7ab91f", subject: "🎉 init: 初始化插件仓库", author: "wren", email: "", avatar: null, time: Date.now() - 3 * 86400e3, body: "" }];
const BRANCHES = [
  { name: "ui-redesign", current: true, upstream: "origin/ui-redesign", ahead: 2, behind: 0 },
  { name: "main", current: false, upstream: "origin/main", ahead: 0, behind: 0 },
  { name: "feature/diff-split", current: false, upstream: null }];
const DIFF = { kind: "unified", path: "lib/client.js", add: 96, del: 30, binary: false, hunks: [
  { oldStart: 218, oldLines: 3, newStart: 218, newLines: 4, lines: [
    " \t\t\t\t\t\`.dgt-row{display:flex;align-items:center;",
    "-\t\t\t\t\t\theight:28px;padding:0 6px 0 8px;border-radius:6px;",
    "+\t\t\t\t\t\theight:34px;padding:0 6px 0 10px;border-radius:var(--dsw-radius-sm);",
    " \t\t\t\t\t\ttransition:background .12s ease}",
    "+\t\t\t\t\t\`.dgt-row:hover .dgt-kebab{opacity:1}" ] } ] };

const realFetch = window.fetch.bind(window);
window.fetch = (url, opt) => {
  if (typeof url === "string" && (url === "/client.js" || url === "/mtime")) return realFetch(url, opt);
  const u = typeof url === "string" ? url : url.url;
  const P = new URL(u, "http://x").pathname;
  const json = (o) => Promise.resolve({ json: () => Promise.resolve(o) });
  const NOREPO = params.get("norepo") === "1";
  if (P.endsWith("/git-info")) return json(NOREPO ? { ok: true, isRepo: false, cwd: "/repo/demo" } : { ok: true, isRepo: true, cwd: "/repo/demo", branch: "ui-redesign", upstream: "origin/ui-redesign", ahead: 2, behind: 0 });
  if (P.endsWith("/overview")) return json(NOREPO ? { ok: true, isRepo: false, status: null, commits: [], branches: [], remotes: [], totals: null } : { ok: true, isRepo: true, status: STATUS, commits: COMMITS, branches: BRANCHES, remotes: ["origin"], totals: { files: 4, add: 128, del: 40 } });
  if (P.endsWith("/status")) return json(STATUS);
  if (P.endsWith("/file-diff") || P.endsWith("/show-diff")) return json({ ok: true, diff: DIFF, files: [DIFF] });
  if (P.endsWith("/log")) return json({ ok: true, commits: COMMITS });
  if (P.endsWith("/branch-list")) return json({ ok: true, branches: BRANCHES });
  if (P.endsWith("/action")) {
    const body = (opt && opt.body) ? JSON.parse(opt.body) : {};
    if (body.action === "switch" || body.action === "create-branch") {
      const target = String(body.args && body.args.branch || "");
      if (target) {
        STATUS.branch = target; STATUS.upstream = "origin/" + target;
        for (const b of BRANCHES) b.current = b.name === target;
        if (!BRANCHES.some((b) => b.name === target)) BRANCHES.unshift({ name: target, current: true, upstream: null });
      }
    }
    return json({ ok: true, tip: "ok" });
  }
  return json({ ok: false, error: "unhandled " + P });
};

window.__ModuleLoader__ = {
  load({ id, factory }) {
    try {
      const mod = factory((n) => n === "react" ? React : prim);
      mod.apply({
        slots: {
          register: (entry, Comp) => {
            if (entry.name === "conversation.view") window.__GitView = Comp;
            else if (entry.name === "conversation.session.header.utilities" || entry.name === "conversation.session.header.corner") window.__Probe = Comp;
            return () => {};
          },
          inject: (k, cb) => { cb(); return () => {}; },
          onEntryError: () => () => {},
        },
        locale: {
          register: (ns, lang, dict) => { (window.__dicts = window.__dicts || {})[ns + ":" + lang] = dict; return () => {}; },
          bind: (ns) => {
            const f = (k, p) => {
              const d = (window.__dicts || {})[ns + ":zh"] || {};
              let v = d[k] || k;
              if (p) for (const key in p) v = v.replace("{" + key + "}", p[key]);
              return v;
            };
            window.__gitT = f;
            return f;
          },
        },
        effect: (fn) => fn(),
      });
    } catch (e) { document.getElementById("err").textContent += "factory: " + (e.stack || e) + "\\n"; }
  },
};

(async () => {
  const src = await window.fetch("/client.js").then(r => r.text());
  try { eval(src); } catch (e) { document.getElementById("err").textContent += "eval: " + (e.stack || e) + "\\n"; }
  // probe patch bridge → isRepo true → GitView registered
  setTimeout(() => {
    if (!window.__GitView) { document.getElementById("err").textContent += "GitView not registered\\n"; return; }
    const kids = [h(window.__GitView, { t: window.__gitT || ((k) => k), sessionId: "s1" })];
    if (window.__Probe) kids.push(h(window.__Probe, { sessionId: "s1" }));
    ReactDOM.createRoot(document.getElementById("app")).render(h(React.Fragment, null, ...kids));
  }, 150);
})();

(async () => {
  let mt = await fetch("/mtime").then(r => r.text());
  setInterval(async () => { const t = await fetch("/mtime").then(r => r.text()); if (t !== mt) location.reload(); }, 1200);
})();
<\/script></body></html>`;
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/mtime") { res.end(String(statSync(CLIENT).mtimeMs)); return; }
  if (u.pathname === "/client.js") { res.setHeader("Content-Type", "text/javascript"); res.setHeader("Cache-Control", "no-store"); res.end(readFileSync(CLIENT)); return; }
  if (u.pathname.startsWith("/vendor/")) {
    const f = join(ROOT, u.pathname);
    if (!f.startsWith(join(ROOT, "vendor"))) { res.statusCode = 403; res.end(); return; }
    res.setHeader("Content-Type", "text/javascript"); res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(f)); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control","no-store");
  res.end(page());
}).listen(PORT, "127.0.0.1", () => console.log(`preview → http://127.0.0.1:${PORT}/?theme=light|dark`));
