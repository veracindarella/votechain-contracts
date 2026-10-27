# syntax=docker/dockerfile:1
FROM rust:1.99-slim-bookworm@sha256:86234e857a413004348b471d11a4ebe1aa92d2eae2b6b143cac68fd1ac3c48be AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown

# Install Stellar CLI (same flags as CI)
RUN cargo install --locked stellar-cli --features opt

WORKDIR /app
COPY . .

CMD ["bash"]
