# QQ群副本活动报名

一个无第三方依赖的 Node.js 单页应用，用于 QQ 群内公共报名 25 人副本活动。

## 本地启动

```powershell
$env:ADMIN_PASSWORD="换成你的管理员密码"
$env:DB_PATH="./data/db.json"
npm start
```

浏览器打开 `http://localhost:3001`。

如果没有设置 `ADMIN_PASSWORD`，本地开发默认管理员密码是 `admin123`。正式使用时请务必设置环境变量。

## 部署到 Railway（免费）

详见 [DEPLOY-RAILWAY.md](./DEPLOY-RAILWAY.md)

快速步骤：
1. 推送代码到 GitHub 公开仓库
2. 在 [railway.app](https://railway.app) 创建项目，选择 GitHub 仓库
3. 设置环境变量：`ADMIN_PASSWORD`、`DB_PATH=/data/db.json`
4. 创建持久化存储：挂载路径 `/data`
5. 等待部署完成

## 功能

- 群友输入 QQ 号登录，不需要 QQ 密码，浏览器会记住登录状态；可额外填写群名/昵称。
- 管理员可以创建多个活动，活动列表以卡片展示活动标题、副本难度、活动时间、状态、创建者和详情入口。
- 管理员可以设置活动标题、难度、类型、时间、状态以及 25 个位置分配。
- 默认位置为 4 个 T、5 个奶、16 个输出、0 个老板。
- 群友点击空位时会进入“填写中”状态，其他人会看到“昵称（QQ号）正在填写中”。
- 群友点击活动卡片进入该活动的报名名册。
- 普通用户可以修改自己的报名信息，不能修改其他人的报名；撤销仍需联系管理员处理。
- 管理员可查看填写、修改、撤销、清空、活动设置变更的审计记录。
- 活动结束后管理员可一键清空当前报名信息。

## 数据

运行后数据会保存到 `data/db.json`。这个文件已被 `.gitignore` 忽略，避免把群友信息提交到仓库。

## Railway 数据持久化

Railway 重新部署会更换容器，容器内普通文件会丢失。生产环境必须创建 Railway Volume，并让数据库写入 Volume：

1. 在 Railway 服务里创建并挂载 Volume。
2. 推荐挂载路径使用 `/data`，并设置 `DB_PATH=/data/db.json`；也可以使用 Railway 提供的 `RAILWAY_VOLUME_MOUNT_PATH`，应用会自动把数据写到该挂载目录下。
3. 部署后打开 `/api/health`，确认 `storage.persistentPathConfigured` 为 `true`。

为避免再次静默重置数据，应用在 Railway 环境里如果检测不到持久化卷会拒绝启动。只有临时测试时才可以设置 `ALLOW_EPHEMERAL_STORAGE=true` 跳过这个保护。

## 备份与恢复

管理员登录后可以使用下面两个接口做数据迁移：

- `GET /api/admin/backup`：导出完整 `db.json` 数据，包含活动、报名、封神榜、设置、审计记录和管理员密码哈希。
- `POST /api/admin/restore`：恢复备份数据，请求体可以传 `{ "db": ... }` 或 `{ "reconstructedDb": ... }`。

把 Railway 从临时磁盘迁移到 Volume 时，先备份，再部署 Volume 配置。恢复后再打开 `/api/health`，确认 `storage.persistentPathConfigured` 为 `true`。
