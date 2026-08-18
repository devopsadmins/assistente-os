# ── Stage 1: build ──────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json   packages/core/
COPY packages/memory/package.json packages/memory/
COPY packages/voice/package.json  packages/voice/
COPY packages/daemon/package.json packages/daemon/
COPY packages/cli/package.json    packages/cli/
COPY packages/tools/package.json  packages/tools/

RUN npm ci

COPY packages/core/tsconfig.json   packages/core/
COPY packages/core/src/            packages/core/src/
COPY packages/memory/tsconfig.json packages/memory/
COPY packages/memory/src/          packages/memory/src/
COPY packages/voice/tsconfig.json  packages/voice/
COPY packages/voice/src/           packages/voice/src/
COPY packages/daemon/tsconfig.json packages/daemon/
COPY packages/daemon/src/          packages/daemon/src/
COPY packages/daemon/web/          packages/daemon/web/
COPY packages/cli/tsconfig.json    packages/cli/
COPY packages/cli/src/             packages/cli/src/
COPY packages/tools/tsconfig.json  packages/tools/
COPY packages/tools/src/           packages/tools/src/

RUN npm run build --workspace=@assistente-os/core && \
    npm run build --workspace=@assistente-os/memory && \
    npm run build --workspace=@assistente-os/voice && \
    npm run build --workspace=@assistente-os/daemon && \
    npm run build --workspace=@assistente-os/tools && \
    npm run build --workspace=@assistente-os/cli

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

RUN npm install -g opencode-ai

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/core/package.json   packages/core/
COPY --from=builder /app/packages/core/dist/           packages/core/dist/
COPY --from=builder /app/packages/memory/package.json  packages/memory/
COPY --from=builder /app/packages/memory/dist/         packages/memory/dist/
COPY --from=builder /app/packages/voice/package.json   packages/voice/
COPY --from=builder /app/packages/voice/dist/          packages/voice/dist/
COPY --from=builder /app/packages/daemon/package.json  packages/daemon/
COPY --from=builder /app/packages/daemon/dist/         packages/daemon/dist/
COPY --from=builder /app/packages/daemon/web/          packages/daemon/web/
COPY --from=builder /app/packages/cli/package.json     packages/cli/
COPY --from=builder /app/packages/cli/dist/            packages/cli/dist/
COPY --from=builder /app/packages/tools/package.json   packages/tools/
COPY --from=builder /app/packages/tools/dist/          packages/tools/dist/

ENV AOS_HOST=0.0.0.0
ENV AOS_PORT=4310
EXPOSE 4310

CMD ["node", "packages/daemon/dist/bin.js"]
