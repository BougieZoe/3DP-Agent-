# ---- Stage 1: Build ----
    FROM node:20-slim AS builder

    WORKDIR /app
    
    # 锁定跟你package.json里packageManager字段一致的pnpm版本
    RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
    
    # 先只拷贝依赖清单和patch文件,利用Docker层缓存加速重复build
    COPY package.json pnpm-lock.yaml ./
    COPY patches ./patches
    
    RUN pnpm install --frozen-lockfile
    
    # 再拷贝其余源码
    COPY . .
    
    # 跑你原本的build脚本:vite build + esbuild打包server
    RUN pnpm run build
    
    # ---- Stage 2: Production ----
    FROM node:20-slim AS production
    
    WORKDIR /app
    ENV NODE_ENV=production
    
    RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
    
    COPY package.json pnpm-lock.yaml ./
    COPY patches ./patches
    
    # 生产环境只装依赖,不装devDependencies
    RUN pnpm install --frozen-lockfile --prod
    
    # 从builder阶段拿构建产物
    COPY --from=builder /app/dist ./dist
    
    EXPOSE 3000
    
    CMD ["node", "dist/index.js"]