/**
 * sync.js —— 云端数据同步层（注入到站点各应用页面）
 *
 * 设计：不改动原项目任何业务代码。原项目继续读写 window.localStorage，
 * 本脚本做两层透明代理：
 *   1) 登录后从 /api/data 拉取该用户云端数据，水合进 localStorage（实现跨设备一致）
 *   2) 拦截 Storage.prototype.setItem/removeItem，把每次写入镜像到服务器
 *
 * 因本脚本仅在「已通过用户认证」的页面才被加载（Worker 网关保证），
 * 调用 /api/data 天然携带用户会话 Cookie。
 */
(function () {
  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  let hydrating = false;

  async function push(key, value) {
    try {
      await fetch("/api/data/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: value,
      });
    } catch (e) { /* 离线或失败静默，下次写入重试 */ }
  }
  async function del(key) {
    try {
      await fetch("/api/data/" + encodeURIComponent(key), { method: "DELETE" });
    } catch (e) {}
  }

  Storage.prototype.setItem = function (k, v) {
    const ret = nativeSet.call(this, k, v);
    if (!hydrating) push(k, typeof v === "string" ? v : String(v));
    return ret;
  };
  Storage.prototype.removeItem = function (k) {
    const ret = nativeRemove.call(this, k);
    if (!hydrating) del(k);
    return ret;
  };

  async function hydrate() {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.status === 401) { location.reload(); return; }
      if (!res.ok) return;
      const map = await res.json();
      hydrating = true;
      let pulled = false;
      // 1) 把云端数据拉到本地（跨设备一致）
      for (const k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) {
          const cur = localStorage.getItem(k);
          if (cur !== map[k]) { nativeSet.call(localStorage, k, map[k]); pulled = true; }
        }
      }
      // 2) 本地独有数据上传到云端（首部署时的本地数据迁移）
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k != null && !(k in map)) push(k, localStorage.getItem(k));
      }
      hydrating = false;
      // 仅当「从服务器拉取到与本地不同的数据」时才刷新一次，避免本地有数据而服务器为空时无限刷新
      if (pulled && !sessionStorage.getItem("__hydrated")) {
        sessionStorage.setItem("__hydrated", "1");
        location.reload();
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate);
  } else {
    hydrate();
  }
})();
