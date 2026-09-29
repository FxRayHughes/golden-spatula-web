# S11 尊者配对

腾讯文档[《S11尊者玩法查询工具》](https://docs.qq.com/sheet/DYVRkeGF0QWNXa2xq)的网页版，适配金铲铲「画之灵」返场（`Mode11_S100030`）。

- **查询**：点选本局的尊者棋子，找到对应的尊者组合和玩法。
- **留言板**：玩家留言，管理员可以回复、精选、删除；另附原文档留言板的存档。
- **装备**：每个英雄的推荐装备，默认来自金铲铲官方 38 套「画之灵」推荐阵容的统计，管理员可以覆盖；另有 182 件装备的图鉴和合成配方。
- **站位与装备**：玩法卡片展示 4×7 棋盘站位和每个英雄的装备。投稿时可以填写；管理员在查询页点卡片右上角的「✎ 站位/装备」可以直接编辑，原文档阵容也能补充。
- **投稿**：玩家可以登记原文档没收录的新组合，也可以投稿玩法，管理员审核通过后公开。
- **管理后台**：支持多个管理员，由站长添加或删除；每次审核都记录审核人。

组合、玩法和署名都来自原文档，页面右上角「关于」里列出了全部作者和贡献者。

## 目录

```
src/            React 前端（pnpm + Vite）
  data/         由 scripts/sync_data.py 生成的原文档数据与英雄数据
server/         Go 微后端（只用标准库），会把前端打包进同一个二进制
scripts/        sync_data.py 数据同步、dev.sh 本地开发
Dockerfile      三阶段构建：pnpm 构建前端 → Go 编译 → distroless 运行镜像
```

## 本地开发

```bash
pnpm install
pnpm dev:all      # Go 后端 :8787 + Vite :5173，Ctrl-C 一起退出
                  # 站长账号读取 .env 的 ADMIN_USER / ADMIN_PASSWORD（与 Docker 相同）；
                  # 没有 .env 时为 admin / dev-admin-password
pnpm dev          # 只启动前端；后端不在线时，页面只显示原文档数据
pnpm server:test  # Go 测试
pnpm build
```

## Docker（OrbStack 本地测试）

```bash
pnpm docker:up    # = docker compose up -d --build，然后打开 http://localhost:8788
pnpm docker:down
```

`.env`（不要提交到仓库）：

| 变量 | 说明 |
|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | 站长账号，口令至少 12 位。每次启动都会按它创建或同步站长账号，忘记口令时改这里再重启即可 |
| `DOCKERHUB` / `GCR` | 基础镜像源。本机连不上 Docker Hub 和 gcr.io，已设为 `docker.m.daocloud.io` / `gcr.m.daocloud.io`；在能直连的环境里删掉这两行就行 |
| `HOST_PORT` | 宿主机端口，默认 8788（本机 8080 已被 cera 项目占用） |
| `TRUST_PROXY` | 放在反向代理后面时设为 1，限流时按 `X-Forwarded-For` 识别客户端 IP |

数据保存在 volume `s11-data` 里的 `/data/store.json`，包括留言、投稿、社区组合、管理员账号和登录会话。

### 推送到自托管仓库

```bash
# 构建 amd64 + arm64 两个架构并推送 0.2.0 与 latest（国内网络用镜像站拉基础镜像）
DOCKERHUB=docker.m.daocloud.io GCR=gcr.m.daocloud.io TAG=0.2.0 pnpm docker:push
```

`docker.maplex.top` 是标准 Docker Registry（registry/2.0），没有网页界面，首页是空白属于正常现象。查看已有镜像：

```bash
curl https://docker.maplex.top/v2/_catalog
curl https://docker.maplex.top/v2/s11-exalted/tags/list
```

### 服务器部署

对外只开放一个端口，网页和 `/api` 都走这个端口，后端没有单独的端口。

```yaml
services:
  s11-exalted:
    image: docker.maplex.top/s11-exalted:0.2.0
    ports:
      - "127.0.0.1:8788:8080"   # 只监听本机，由 Nginx / 1Panel 反向代理对外提供 HTTPS
    environment:
      ADMIN_USER: admin
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}   # 至少 12 位
      TRUST_PROXY: "1"                    # 放在反向代理后面时开启，限流才能识别真实 IP
    volumes:
      - s11-data:/data
    restart: unless-stopped
volumes:
  s11-data:
```

## 审核规则

- **新组合**：3~6 个可以成为尊者的棋子。拥有 3 个及以上羁绊的弈子不会成为尊者，原文档的 60 个组合全部符合这条规则。和原文档组合或已登记组合重复的会被拦下。审核通过后编号从「新1」开始（内部 id 1001）。组合通过后投稿人不能再改；被玩法引用的组合不能删除或下架。
- **玩法**：投稿人凭浏览器里保存的编辑口令修改或删除自己的投稿，修改已发布的内容需要重新审核。管理员修改不影响状态，也不受频率限制。
- **频率限制（每个 IP）**：留言间隔 20 秒、每小时 10 条；投稿间隔 10 秒、每小时 10 条；登录每 10 分钟 10 次。

## 更新数据

```bash
pnpm sync   # python3 scripts/sync_data.py
```

脚本会重新生成 `src/data/*.json` 和 `server/gamedata.json`。它读取腾讯文档内部的 opendoc 接口（protobuf），这不是公开 API，文档结构变化时可能需要调整。原理说明见 `S11尊者查询-规划.md`。
