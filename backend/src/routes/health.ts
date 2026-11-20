// Copyright 2024 VoteChain Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Pool } from "pg";
import { Router, Request, Response } from "express";
import { getRedis } from "../middleware/redisCache";
import { log } from "../middleware/requestTracing";

const { version } = require("../../package.json") as { version?: string };
const router = Router();
const timeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 2_000);

if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error("HEALTH_CHECK_TIMEOUT_MS must be a positive integer.");
}

let dbPool: Pool | undefined;

type ComponentStatus = "healthy" | "degraded";

async function checkComponent(
  name: string,
  check: () => Promise<void>,
): Promise<ComponentStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("health check timed out")),
          timeoutMs,
        );
      }),
    ]);
    return "healthy";
  } catch {
    log("warn", "health dependency check failed", { component: name });
    return "degraded";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  dbPool ??= new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });
  await dbPool.query("SELECT 1");
}

async function checkRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis?.isOpen) {
    throw new Error("Redis is not connected.");
  }
  await redis.ping();
}

async function checkStellarRpc(): Promise<void> {
  const rpcUrl = process.env.STELLAR_RPC_URL;
  if (!rpcUrl) {
    throw new Error("STELLAR_RPC_URL is not configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Stellar RPC returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      result?: { status?: string };
    };
    if (payload.result?.status !== "healthy") {
      throw new Error("Stellar RPC reported an unhealthy status.");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function getComponentStatuses(includeStellarRpc = true) {
  const [db, redis, stellar_rpc] = await Promise.all([
    checkComponent("db", checkDatabase),
    checkComponent("redis", checkRedis),
    includeStellarRpc
      ? checkComponent("stellar_rpc", checkStellarRpc)
      : Promise.resolve<ComponentStatus>("healthy"),
  ]);
  return includeStellarRpc ? { db, redis, stellar_rpc } : { db, redis };
}

async function sendReadiness(
  res: Response,
  includeStellarRpc = true,
): Promise<void> {
  const components = await getComponentStatuses(includeStellarRpc);
  const healthy = Object.values(components).every(
    (status) => status === "healthy",
  );

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    uptime: process.uptime(),
    version: version ?? "1.0.0",
    components,
  });
}

router.get("/health", (_req: Request, res: Response) => {
  void sendReadiness(res);
});

router.get("/ready", (_req: Request, res: Response) => {
  void sendReadiness(res);
});

router.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    version: version ?? "1.0.0",
  });
});

router.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    version: version ?? "1.0.0",
  });
});

router.get("/readyz", (_req: Request, res: Response) => {
  void sendReadiness(res, false);
});

export default router;
