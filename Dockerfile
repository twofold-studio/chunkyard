FROM rust:1.88-bookworm AS contract
WORKDIR /app
COPY Cargo.toml Cargo.lock CHANGELOG.md ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/app/target,sharing=locked \
    cargo run --locked --quiet -p chunkyard-api --example export-openapi > /tmp/openapi.json && \
    cmp /tmp/openapi.json crates/api/src/openapi.json

FROM node:24-bookworm-slim AS web-build
WORKDIR /web
RUN npm install --global pnpm@12.9.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY web ./
COPY scripts/sdk-contract.mjs /scripts/sdk-contract.mjs
COPY --from=contract /tmp/openapi.json /crates/api/src/openapi.json
RUN pnpm api:sdk:check && pnpm build

FROM rust:1.88-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock CHANGELOG.md ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --locked --release -p chunkyard-server && cp /app/target/release/mcm /mcm

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /mcm /usr/local/bin/mcm
COPY --from=web-build /web/build /opt/mcm/web
ENV CHUNKYARD_HTTP__LISTEN=0.0.0.0:8420 CHUNKYARD_DATA_DIR=/data CHUNKYARD_HTTP__UI_DIR=/opt/mcm/web
VOLUME ["/data"]
EXPOSE 8420
ENTRYPOINT ["mcm"]
CMD ["serve"]
