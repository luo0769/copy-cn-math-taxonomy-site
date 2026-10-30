# 快速上线手册（Cloudflare Pages + D1）

前置：你已注册 GitHub 账号、Cloudflare 账号（均免费版即可）。
本仓库 `repo-src` 当前是**上游克隆**，`origin` 指向上游（你无写权限）——推送前必须改成你自己的仓库（见步骤 1）。

---

## 步骤 1 ｜ 推到你自己的 GitHub 仓库

在 `repo-src` 目录下（Git Bash / 终端）执行：

```bash
cd repo-src
git add -A
git commit -m "cn-math-taxonomy + cloudflare auth layer"
# 去 GitHub 新建一个空仓库，例如 cn-math-taxonomy-site，复制其 HTTPS 地址，替换下面一行
git remote set-url origin https://github.com/<你的用户名>/cn-math-taxonomy-site.git
git push -u origin main
# 若 GitHub 仓库自带 README 初始提交导致拒绝，改用：
# git push -u origin main --force
```

> 嫌敲命令麻烦可直接运行本目录的 `deploy.sh`（会自动提交并提示你输入仓库地址后推送）。

---

## 步骤 2 ｜ Cloudflare 建 D1 数据库并初始化

1. 控制台 → **Workers & Pages → D1** → 创建数据库，名称 `cn-math-taxonomy-db`。
2. 进入该库 → **Query（控制台）** → 粘贴 `migrations/0001_init.sql` 全文执行（建 `users` / `user_data` 表）。

---

## 步骤 3 ｜ Cloudflare Pages 连接 GitHub 并部署

1. 控制台 → **Workers & Pages → 创建 → Pages → 连接到 Git** → 授权并选择步骤 1 的仓库。
2. 构建设置：
   - Framework preset：**None**
   - Build command：留空
   - Build output directory：`.`（仓库根即站点根）
3. 点 **保存并部署**（首次会成功，但此时还没绑 D1，接口会报错，下一步补）。
4. 部署完成后 → 项目 **设置 → Functions → D1 数据库绑定**：变量名填 `DB`，选 `cn-math-taxonomy-db`。
5. 项目 **设置 → 环境变量**（Production，建议勾 Preview），逐项添加（敏感项选加密/secret）：
   - `SITE_PASSWORD` = 站点访问密码（例如 `MySitePwd123`）
   - `SESSION_SECRET` = 随机串，本地可用 `openssl rand -hex 32` 生成
   - `OPEN_REGISTRATION` = `false`（关闭开放注册，仅管理员建用户）；**不设则默认开放注册**
6. 重新部署一次（部署 → 重试上次部署 / 触发新部署），让绑定和变量生效。

---

## 步骤 4 ｜ 首次启动（创建管理员）

1. 打开 Pages 域名（如 `https://xxx.pages.dev`）。
2. 输入步骤 3.5 设的 `SITE_PASSWORD`。
3. 登录页切到「注册」→ 填用户名（**首位注册者自动成为管理员**），密码可留空。
4. 之后：开放注册时用户自助注册；关闭注册时由管理员在「用户管理」后台建账户。
5. 用户在知识图谱/诊断里的数据自动存 D1，换设备登录同账号即恢复。

---

## 步骤 5 ｜ 自动更新上游内容

已配好 `.github/workflows/sync-upstream.yml`：每天 UTC 04:00 自动把上游 `xiaoyang111222/cn-math-taxonomy` 最新内容合并进你的仓库并推送，触发 Pages 重新部署。
也可在 GitHub 仓库 **Actions → Sync upstream → Run workflow** 手动触发。

> 合并用 `ours` 策略保留认证层；若上游将来新增同名文件（如自己的 `_worker.js`）会被你的版本覆盖——目前上游是纯静态站，无此风险。

---

## 你这边必须亲手做的 2 件事

1. 在 GitHub 新建空仓库（步骤 1）。
2. 在 Cloudflare 建 D1、连 Pages、设环境变量（步骤 2–3）。

其余（commit、push、D1 初始化 SQL、自动同步工作流）均已备齐，照抄命令即可。
