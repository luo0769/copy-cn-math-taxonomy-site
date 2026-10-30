/**
 * auth.js —— 应用页浮动条（注入站点各应用页面）
 * 仅做展示与退出入口，不触碰业务数据；数据同步由 sync.js 负责。
 */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function inject(me) {
    const bar = el("div");
    bar.setAttribute("style",
      "position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;gap:8px;align-items:center;" +
      "background:rgba(15,23,42,.92);color:#e2e8f0;padding:6px 10px;border-radius:999px;" +
      "font:13px system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35)");
    bar.appendChild(el("span", null, "👤 " + me.username));
    if (me.role === "admin") {
      const a = el("a", null, "管理");
      a.href = "/auth/login/";
      a.style.color = "#38bdf8";
      a.style.textDecoration = "none";
      bar.appendChild(a);
    }
    const out = el("a", null, "退出");
    out.href = "/auth/login/";
    out.style.color = "#94a3b8";
    out.style.textDecoration = "none";
    bar.appendChild(out);
    document.body.appendChild(bar);
  }
  fetch("/api/user/me").then(function (r) {
    if (!r.ok) return;
    return r.json();
  }).then(function (me) {
    if (me && me.username) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { inject(me); });
      else inject(me);
    }
  }).catch(function () {});
})();
