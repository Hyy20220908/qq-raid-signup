# Railway 部署指南

## 部署步骤

### 1. 推送代码到 GitHub

```bash
# 在项目目录下初始化 Git（如果还没有）
git init

# 添加所有文件
git add .

# 提交
git commit -m "Add Railway deployment config"

# 添加远程仓库（替换为你的 GitHub 仓库地址）
git remote add origin https://github.com/你的用户名/qq-raid-signup.git

# 推送
git push -u origin main
```

### 2. 在 Railway 上创建项目

1. 访问 [railway.app](https://railway.app)
2. 使用 GitHub 账号登录
3. 点击 **"New Project"**
4. 选择 **"Deploy from GitHub repo"**
5. 授权 GitHub 访问权限
6. 选择你的 `qq-raid-signup` 仓库

### 3. 配置环境变量

在 Railway 项目控制台中，点击 **"Variables"** 标签，添加以下变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `ADMIN_PASSWORD` | `你的安全密码` | 管理员后台密码，**强烈建议修改！** |
| `DB_PATH` | `/data/db.json` | 持久化数据库路径 |

### 4. 配置持久化存储

Railway 的文件系统在容器重启后会清空，需要配置持久化存储：

1. 在 Railway 控制台中，点击 **"Storage"** 标签
2. 点击 **"Create Persistent Disk"**
3. 挂载路径填写 `/data`
4. 这样数据库文件就会持久化保存

> 重要：本项目会在 Railway 环境中检查持久化卷。如果没有检测到 Railway Volume，服务会拒绝启动，避免重新部署后静默创建空数据库。部署后访问 `/api/health`，确认 `storage.persistentPathConfigured` 为 `true`。

如果你使用 Railway 自动提供的 `RAILWAY_VOLUME_MOUNT_PATH`，可以不手动设置 `DB_PATH`，应用会默认写入 `$RAILWAY_VOLUME_MOUNT_PATH/db.json`。如果你手动挂载到 `/data`，请保持 `DB_PATH=/data/db.json`。

只有临时测试时才可以设置：

```env
ALLOW_EPHEMERAL_STORAGE=true
```

生产环境不要设置这个变量。

### 5. 等待部署完成

Railway 会自动检测 Node.js 项目并部署。完成后会显示访问地址，例如：
```
https://qq-raid-signup.up.railway.app
```

## 常用命令

### 查看日志
在 Railway 控制台的 **"Deployments"** 标签中，点击具体部署，可以查看实时日志。

### 重新部署
点击 **"Redeploy"** 按钮可以重新部署。

## 注意事项

1. **修改管理员密码**：默认密码是 `admin123`，部署后请立即修改
2. **数据备份**：定期备份 `/data/db.json` 文件
3. **休眠问题**：Railway 免费版如果 30 天无流量会休眠，首次访问可能需要等待冷启动（30-60 秒）

## 从临时磁盘迁移到 Volume

如果项目已经上线过但之前没有挂载 Volume，不要直接部署新配置。建议按这个顺序迁移：

1. 先备份当前线上数据。管理员登录后访问 `GET /api/admin/backup` 可以导出完整数据库；如果旧版本还没有这个接口，可以先用 `/api/state` 做业务数据快照。
2. 在 Railway 里创建 Volume，挂载路径填 `/data`，变量设置 `DB_PATH=/data/db.json`。
3. 部署后登录管理员，使用 `POST /api/admin/restore` 恢复备份数据。
4. 打开 `/api/health`，确认 `storage.persistentPathConfigured` 为 `true`。

备份文件包含 QQ 和报名信息，请不要提交到 Git 仓库。
