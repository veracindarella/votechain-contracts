# syntax=docker/dockerfile:1
FROM rust:1.98-slim-bookworm@sha256:ff521445a372125ed4f76e1453a1f8098f2d05332d1601d30db1c1f62757e730 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown

# Install Stellar CLI (same flags as CI)
RUN cargo install --locked stellar-cli --features opt

WORKDIR /app
COPY . .

CMD ["bash"]
