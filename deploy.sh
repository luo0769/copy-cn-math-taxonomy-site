#!/usr/bin/env bash
# 一键推送脚本：把 repo-src 推到你自己的 GitHub 仓库。
# 用法（在 repo-src 目录下执行）：  bash deploy.sh
# 说明：本脚本只负责「本地提交 + 改 remote + 推送」这一步；
#       Cloudflare 建库/连 Pages/设环境变量 仍需你在控制台手动完成（见 QUICKSTART.md 步骤 2-3）。

set -e

echo "==> 当前目录：$(pwd)"
echo "==> 当前 origin：$(git remote get-url origin 2>/dev/null || echo '无')"

# 1. 提交
git add -A
if git diff --cached --quiet; then
  echo "==> 没有需要提交的改动，跳过 commit。"
else
  git commit -m "cn-math-taxonomy + cloudflare auth layer"
fi

# 2. 设置你自己的 GitHub 仓库地址
read -rp "粘贴你在 GitHub 新建的空仓库 HTTPS 地址（形如 https://github.com/用户名/仓库.git）: " REPO_URL
if [ -z "$REPO_URL" ]; then
  echo "未输入地址，已取消。" >&2
  exit 1
fi
git remote set-url origin "$REPO_URL"

# 3. 推送
echo "==> 推送到 $REPO_URL ..."
if git push -u origin main; then
  echo "==> 推送成功。"
else
  echo "==> 推送被拒绝（通常因为 GitHub 仓库有初始提交）。"
  read -rp "是否使用 git push -u origin main --force 强制推送？(y/N): " FORCE
  if [ "$FORCE" = "y" ] || [ "$FORCE" = "Y" ]; then
    git push -u origin main --force
    echo "==> 强制推送完成。"
  else
    echo "==> 已取消。请先 'git pull origin main --allow-unrelated-histories' 合并后再 push。"
    exit 1
  fi
fi

echo ""
echo "=========================================="
echo " 代码已就位。接下来请手动完成 Cloudflare 部分："
echo " 1) 建 D1 库 cn-math-taxonomy-db，执行 migrations/0001_init.sql"
echo " 2) Pages 连接该 GitHub 仓库（Framework=None，输出目录 .）"
echo " 3) 绑定 D1 变量名 DB；设环境变量 SITE_PASSWORD / SESSION_SECRET"
echo "    （关闭开放注册再加 OPEN_REGISTRATION=false）"
echo " 4) 重新部署 → 打开域名 → 输站点密码 → 注册首位管理员"
echo " 详见 QUICKSTART.md"
echo "=========================================="
