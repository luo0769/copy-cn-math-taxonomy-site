# 部署指南：把 cn-math-taxonomy 做成带登录的 Cloudflare 网站

本目录是在原项目（`xiaoyang111222/cn-math-taxonomy`）基础上，叠加的一套 **Cloudflare Pages + D1** 认证与持久化层。原项目的所有静态页面、知识图谱、诊断功能均原样保留，只是加了一层「站点密码 + 多用户 + 跨设备数据持久化 + 自动同步上游」。

---

## 1. 架构总览

| 组件 | 作用 |
|------|------|
| `_worker.js`（根级） | Cloudflare Pages Functions 全请求网关：站点密码门禁、用户注册/登录/登出、管理员用户管理、每用户数据 REST 读写；校验通过后用 `env.ASSETS` 提供原静态资源 |
| `migrations/0001_init.sql` | D1（SQLite）表：`users`、`user_data`、`site_config` |
| `auth/gate.html` | 站点密码门（自包含，无外部依赖） |
| `auth/login.html` | 用户登录 / 注册 / 管理员用户管理面板 |
| `auth/sync.js` | 透明同步层：把原前端对 `localStorage` 的读写镜像到 D1，实现跨设备一致 |
| `auth/auth.js` | 应用页浮动条（显示当前用户 / 退出 / 管理入口） |
| `.github/workflows/sync-upstream.yml` | 每天自动把上游仓库最新内容合并进来 → 触发 Pages 重新部署 |
| `wrangler.toml` | 本地开发 / D1 绑定配置 |

> 关键设计：同步脚本由 Worker 在返回 HTML 时**动态注入**，原项目的 HTML/JS 文件**一行未改**。这样上游更新时合并零冲突，自动升级的是「项目内容」，认证层始终保留。

---

## 2. 前置条件

- 一个 Cloudflare 账号（免费版即可，Pages + D1 均在免费额度内）
- 一个 GitHub 账号，并已把本目录推送为一个仓库（见第 3 步）
- 本机可选：`wrangler`（用于本地调试，`npm i -g wrangler`）

---

## 3. 推送到 GitHub

把本目录内容推到你自己的 GitHub 仓库（不要直接推到上游，你没有上游写权限）：

```bash
cd repo-src
git init -b main
git add -A
git commit -m "add cloudflare auth layer"
# 在 GitHub 新建一个空仓库，然后：
git remote add origin https://github.com/<你的用户名>/<你的仓库>.git
git push -u origin main
```

> 或者先 Fork 上游仓库，再把本目录里**新增的文件**（`_worker.js`、`auth/`、`migrations/`、`wrangler.toml`、`.github/workflows/`）复制进去提交。两种方式都行，关键是你的仓库 = 上游内容 + 这些新增文件。

---

## 4. 创建 D1 数据库并初始化

**方式 A：Cloudflare 控制台**
1. 控制台 → **Workers & Pages → D1** → 创建数据库，名称 `cn-math-taxonomy-db`，记下数据库 ID。
2. 进入该数据库 → **Query（控制台）** → 粘贴 `migrations/0001_init.sql` 全文执行。

**方式 B：wrangler（需先 `wrangler login`）**
```bash
wrangler d1 create cn-math-taxonomy-db
# 把输出的 database_id 填进 wrangler.toml 的 database_id
wrangler d1 migrations apply cn-math-taxonomy-db --remote
```

---

## 5. 在 Cloudflare Pages 连接仓库

1. 控制台 → **Workers & Pages → 创建 → Pages → 连接到 Git** → 授权并选择第 3 步的仓库。
2. 构建设置：
   - Framework preset：**None**
   - Build command：留空
   - Build output directory：`.`（仓库根目录即站点根）
3. 点击 **保存并部署**。首次部署会成功（此时还没配 D1 绑定，接口会报错，下一步补）。
4. 部署完成后进入项目 **设置 → Functions → D1 数据库绑定**：
   - 变量名填 `DB`，选择第 4 步创建的 `cn-math-taxonomy-db`。
5. 项目 **设置 → 环境变量**（Production，建议也勾 Preview）：
   - `SITE_PASSWORD` = 你的站点访问密码（**加密/secret**）
   - `SESSION_SECRET` = 一段随机串，用于签名会话 Cookie（**加密/secret**，可用 `openssl rand -hex 32` 生成）
   - `OPEN_REGISTRATION` = 开放注册开关（**可选**）：
     - 不设置 / 设为 `1` / `true` / `on` / `yes` → **开放注册**（默认），用户可自行注册（首位=管理员）；
     - 设为 `0` / `false` / `off` / `no` → **关闭开放注册**，用户端不再显示「注册」入口，账户只能由管理员在后台创建。
     - 注意：无论是否关闭，当数据库里**还没有任何用户**时，注册入口仍会开放，以便创建**首位管理员**（引导完成后即按开关生效）。
6. 重新部署一次（**部署 → 重试上次部署 / 触发新部署**），让绑定和变量生效。

> 注意：`wrangler.toml` 里的 `database_id` 只用于本地 `wrangler` 命令；线上 Pages 以第 5.4 步控制台的 D1 绑定为准。

---

## 6. 首次启动（创建站点密码后的第一个账户 = 管理员）

1. 打开你的 Pages 域名（如 `https://xxx.pages.dev`）。
2. 弹出「站点访问密码」→ 输入第 5.5 步设的 `SITE_PASSWORD`。
3. 进入登录页 → 切到「注册」→ 填写用户名（首位注册者自动成为**管理员**），密码可留空（留空=无密码，仅凭用户名进入）。
4. 之后普通用户自行注册即成为普通用户；管理员登录后可在面板里**创建/删除用户**。
5. 用户在知识图谱 / 诊断里产生的数据（孩子档案、诊断进度等）会自动存到 D1，换设备登录同一账号即可恢复。

> 若你设置了 `OPEN_REGISTRATION=false`（关闭开放注册）：首次部署时注册入口仍会显示（用于创建首位管理员）；首位管理员创建后，普通用户将看不到「注册」入口，只能由管理员在后台「用户管理」里创建账户。

---

## 7. 自动更新（需求 6）

仓库里的 `.github/workflows/sync-upstream.yml` 已经配好：
- 每天 UTC 04:00 自动把上游 `xiaoyang111222/cn-math-taxonomy` 合并进来；
- 合并后推送会触发 Cloudflare Pages 自动重新部署，站点内容随之升级；
- 也可在 GitHub 仓库 **Actions → Sync upstream → Run workflow** 手动触发。

> 合并采用 `ours` 策略保留认证层文件；上游对知识图谱数据/页面的更新会正常合入，不会覆盖你的登录系统。

---

## 8. 本地调试

```bash
# 在 wrangler.toml 填好 database_id，并临时在 [vars] 里写 SITE_PASSWORD / SESSION_SECRET
wrangler pages dev . --binding DB=cn-math-taxonomy-db
# 或用本地 D1：
wrangler pages dev . --d1 DB
```
浏览器开 `http://localhost:8788`（本地用 http，Cookie 不带 Secure，可正常登录）。

---

## 9. 运维与注意事项

- **改站点密码**：直接改 Cloudflare 环境变量 `SITE_PASSWORD` 并重部署；已登录用户的站点会话 Cookie 不会自动失效，但重新打开站点会被要求重新输入。
- **导出某用户数据**：`wrangler d1 execute cn-math-taxonomy-db --remote --command "SELECT * FROM user_data WHERE user_id='<id>'"`，或在管理员面板里用浏览器导出。
- **删除用户**：管理员面板 → 删除（会级联删除该用户的 `user_data`）。
- **数据安全**：`SITE_PASSWORD` / `SESSION_SECRET` 务必设为加密变量，切勿提交进仓库；密码用 PBKDF2 加盐哈希存储，空密码账户仅以用户名为凭证。
- **关闭开放注册**：设置 `OPEN_REGISTRATION=false` 后，用户端「注册」入口隐藏，账户只能由管理员在「用户管理」面板创建；但**首位管理员仍需通过注册入口创建**（数据库为空时强制开放引导），之后才按开关生效。切换该变量后建议重新部署一次使其生效。
- **冲突说明**：若上游未来也新增了同名文件（如自己的 `_worker.js`），合并时会被本仓库版本覆盖，需要手动处理——目前上游为纯静态站，无此风险。

---

### 参考（Cloudflare 官方文档）
- Cloudflare Pages Functions 与 `_worker.js`：<https://developers.cloudflare.com/pages/functions/>
- Pages 使用 D1 绑定：<https://developers.cloudflare.com/pages/functions/bindings/#d1-databases>
- D1 入门：<https://developers.cloudflare.com/d1/get-started/>
- Pages 通过 Git 自动部署：<https://developers.cloudflare.com/pages/get-started/git-integration/>
