# syntax=docker/dockerfile:1
FROM rust:1.100-slim-bookworm@sha256:7c7d4eb4d05b7781187a327809466cfddf29753f6defdc3d19a0e291951b7a37 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown

# Install Stellar CLI (same flags as CI)
RUN cargo install --locked stellar-cli --features opt

WORKDIR /app
COPY . .

CMD ["bash"]
