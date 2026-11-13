FROM rust:1.88-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --locked --release -p mcm-server && cp /app/target/release/mcm /mcm

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /mcm /usr/local/bin/mcm
ENV MCM_HTTP__LISTEN=0.0.0.0:8420 MCM_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8420
ENTRYPOINT ["mcm"]
CMD ["serve"]
