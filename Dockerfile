# 基础镜像源可替换：国内网络连不上 Docker Hub / gcr.io 时，
#   docker build --build-arg DOCKERHUB=docker.m.daocloud.io --build-arg GCR=gcr.m.daocloud.io .
# （docker-compose.yml 会从 .env 读取这两个值）
# 多架构：docker buildx build --platform linux/amd64,linux/arm64 ...
#   前两个阶段在构建机原生运行（BUILDPLATFORM），Go 交叉编译到目标架构，不需要模拟器
ARG DOCKERHUB=docker.io
ARG GCR=gcr.io

# ---------- 1. 前端（pnpm） ----------
FROM --platform=$BUILDPLATFORM ${DOCKERHUB}/library/node:24-alpine AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store,sharing=locked pnpm install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---------- 2. Go 后端，前端打包进二进制 ----------
FROM --platform=$BUILDPLATFORM ${DOCKERHUB}/library/golang:1.26-alpine AS server
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY server/go.mod ./
COPY server/*.go server/gamedata.json ./
COPY --from=web /app/dist ./public
RUN --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/s11-exalted . \
 && mkdir -p /out/data

# ---------- 3. 运行镜像（无 shell，非 root） ----------
FROM ${GCR}/distroless/static-debian12:nonroot
COPY --from=server /out/s11-exalted /s11-exalted
COPY --from=server --chown=nonroot:nonroot /out/data /data
ENV ADDR=:8080 DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/s11-exalted", "-healthcheck"]
ENTRYPOINT ["/s11-exalted"]
