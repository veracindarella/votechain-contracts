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

/**
 * Unit tests for apiKeyAuth middleware and abuseDetection middleware.
 *
 * Tests run entirely in-process with no Redis dependency — the in-memory
 * fallback limiter is exercised directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

// Mock Redis before any modules that import it are loaded.
// vi.mock is hoisted by vitest to the top of the file automatically.
vi.mock("../src/middleware/redisCache", () => ({
  getRedis: () => null,
  isRedisReady: () => false,
  connectRedis: vi.fn().mockResolvedValue(undefined),
}));

import { apiKeyAuth } from "../src/middleware/apiKeyAuth";
import {
  abuseDetection,
  _getKeyStateForTesting,
  _clearAbuseStateForTesting,
} from "../src/middleware/abuseDetection";
import {
  createApiKey,
  revokeApiKey,
  suspendApiKey,
  getApiKeyById,
  _clearStoreForTesting,
} from "../src/middleware/apiKeyStore";

// ── Test-double helpers ────────────────────────────────────────────────────

interface ResContext {
  status: number | null;
  body: unknown;
  headers: Record<string, string | number>;
}

function makeResWithCtx(): { res: Response; ctx: ResContext } {
  const ctx: ResContext = { status: null, body: null, headers: {} };
  const res = {
    setHeader(name: string, value: string | number) {
      ctx.headers[name] = value;
    },
    status(code: number) {
      ctx.status = code;
      return res;
    },
    json(data: unknown) {
      ctx.body = data;
      return res;
    },
  } as unknown as Response;
  return { res, ctx };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: "127.0.0.1",
    method: "GET",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

// ── apiKeyAuth tests ───────────────────────────────────────────────────────

describe("apiKeyAuth", () => {
  beforeEach(() => {
    _clearStoreForTesting();
  });

  // ── Anonymous tier ─────────────────────────────────────────────────────

  describe("anonymous requests (no Authorization header)", () => {
    it("proceeds with anon tier and calls next()", async () => {
      const req = makeReq();
      const { res } = makeResWithCtx();
      const next = vi.fn();

      await apiKeyAuth(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.apiKeyTier).toBe("anon");
      expect(req.apiKeyId).toBeUndefined();
    });

    it("sets X-RateLimit-Limit=100 and X-RateLimit-Tier=anon for GET (read bucket)", async () => {
      const req = makeReq({ method: "GET", ip: "10.0.0.1" });
      const { res, ctx } = makeResWithCtx();
      await apiKeyAuth(req, res, vi.fn());

      expect(ctx.headers["X-RateLimit-Limit"]).toBe(100);
      expect(ctx.headers["X-RateLimit-Tier"]).toBe("anon");
    });

    it("sets X-RateLimit-Limit=10 for POST (write bucket)", async () => {
      const req = makeReq({ method: "POST", ip: "10.0.0.2" });
      const { res, ctx } = makeResWithCtx();
      await apiKeyAuth(req, res, vi.fn());

      expect(ctx.headers["X-RateLimit-Limit"]).toBe(10);
    });

    it("enforces anon read limit of 100 per window", async () => {
      const ip = "10.0.1.1";
      const next = vi.fn();

      // First 100 should pass
      for (let i = 0; i < 100; i++) {
        const req = makeReq({ ip, method: "GET" });
        const { res } = makeResWithCtx();
        await apiKeyAuth(req, res, next);
      }
      expect(next).toHaveBeenCalledTimes(100);

      // 101st should be rate-limited
      const req101 = makeReq({ ip, method: "GET" });
      const { res: res101, ctx: ctx101 } = makeResWithCtx();
      await apiKeyAuth(req101, res101, next);

      expect(ctx101.status).toBe(429);
      const err = (ctx101.body as { error: { code: string } }).error;
      expect(err.code).toBe("RATE_LIMITED");
    });

    it("enforces anon write limit of 10 per window", async () => {
      const ip = "10.0.1.2";
      const next = vi.fn();

      for (let i = 0; i < 10; i++) {
        const req = makeReq({ ip, method: "POST" });
        const { res } = makeResWithCtx();
        await apiKeyAuth(req, res, next);
      }
      expect(next).toHaveBeenCalledTimes(10);

      const req11 = makeReq({ ip, method: "POST" });
      const { res, ctx } = makeResWithCtx();
      await apiKeyAuth(req11, res, next);

      expect(ctx.status).toBe(429);
    });
  });

  // ── Verified-DAO tier ──────────────────────────────────────────────────

  describe("verified-DAO key requests", () => {
    it("proceeds with verified-dao tier for a valid key", async () => {
      const { rawKey, record } = createApiKey("test-dao");
      const req = makeReq({ headers: { authorization: `Bearer ${rawKey}` } });
      const { res } = makeResWithCtx();
      const next = vi.fn();

      await apiKeyAuth(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.apiKeyTier).toBe("verified-dao");
      expect(req.apiKeyId).toBe(record.id);
    });

    it("sets X-RateLimit-Limit=1000 for verified-dao GET", async () => {
      const { rawKey } = createApiKey("limits-dao");
      const req = makeReq({ method: "GET", headers: { authorization: `Bearer ${rawKey}` } });
      const { res, ctx } = makeResWithCtx();

      await apiKeyAuth(req, res, vi.fn());

      expect(ctx.headers["X-RateLimit-Limit"]).toBe(1000);
      expect(ctx.headers["X-RateLimit-Tier"]).toBe("verified-dao");
    });

    it("sets X-RateLimit-Limit=100 for verified-dao POST", async () => {
      const { rawKey } = createApiKey("limits-dao-2");
      const req = makeReq({ method: "POST", headers: { authorization: `Bearer ${rawKey}` } });
      const { res, ctx } = makeResWithCtx();

      await apiKeyAuth(req, res, vi.fn());

      expect(ctx.headers["X-RateLimit-Limit"]).toBe(100);
    });

    it("rate-limits a key after 1000 reads in one window", async () => {
      const { rawKey } = createApiKey("heavy-reader-dao");
      const next = vi.fn();

      for (let i = 0; i < 1000; i++) {
        const req = makeReq({ method: "GET", headers: { authorization: `Bearer ${rawKey}` } });
        const { res } = makeResWithCtx();
        await apiKeyAuth(req, res, next);
      }
      expect(next).toHaveBeenCalledTimes(1000);

      // 1001st
      const req1001 = makeReq({ method: "GET", headers: { authorization: `Bearer ${rawKey}` } });
      const { res, ctx } = makeResWithCtx();
      await apiKeyAuth(req1001, res, next);

      expect(ctx.status).toBe(429);
    });
  });

  // ── Invalid key scenarios ──────────────────────────────────────────────

  describe("invalid key scenarios", () => {
    it("returns 401 INVALID_API_KEY for an unknown key", async () => {
      const req = makeReq({
        headers: { authorization: "Bearer " + "a".repeat(64) },
      });
      const { res, ctx } = makeResWithCtx();
      const next = vi.fn();

      await apiKeyAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.status).toBe(401);
      expect((ctx.body as { error: { code: string } }).error.code).toBe("INVALID_API_KEY");
    });

    it("returns 401 for a revoked key (indistinguishable from unknown key)", async () => {
      const { rawKey, record } = createApiKey("revoke-dao");
      revokeApiKey(record.id);

      const req = makeReq({ headers: { authorization: `Bearer ${rawKey}` } });
      const { res, ctx } = makeResWithCtx();
      const next = vi.fn();

      await apiKeyAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.status).toBe(401);
      // Revoked keys are removed from the hash index; they look like unknown keys.
      // This is intentional — we don't distinguish the two for security reasons.
      expect((ctx.body as { error: { code: string } }).error.code).toBe("INVALID_API_KEY");
    });

    it("returns 403 SUSPENDED_KEY for a suspended key", async () => {
      const { rawKey, record } = createApiKey("suspend-dao");
      suspendApiKey(record.id);

      const req = makeReq({ headers: { authorization: `Bearer ${rawKey}` } });
      const { res, ctx } = makeResWithCtx();
      const next = vi.fn();

      await apiKeyAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.status).toBe(403);
      expect((ctx.body as { error: { code: string } }).error.code).toBe("SUSPENDED_KEY");
    });

    it("returns 401 for a short / malformed Bearer value", async () => {
      const req = makeReq({ headers: { authorization: "Bearer notarealkey" } });
      const { res, ctx } = makeResWithCtx();
      const next = vi.fn();

      await apiKeyAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.status).toBe(401);
    });
  });

  // ── HTTP method bucketing ──────────────────────────────────────────────

  describe("read / write method bucketing", () => {
    it.each(["POST", "PUT", "PATCH", "DELETE"])(
      "%s is counted against the write bucket (limit=10 for anon)",
      async (method) => {
        const req = makeReq({ method, ip: `192.168.1.${method.length}` });
        const { res, ctx } = makeResWithCtx();
        await apiKeyAuth(req, res, vi.fn());
        expect(ctx.headers["X-RateLimit-Limit"]).toBe(10);
      }
    );

    it.each(["GET", "HEAD", "OPTIONS"])(
      "%s is counted against the read bucket (limit=100 for anon)",
      async (method) => {
        const req = makeReq({ method, ip: `192.168.2.${method.length}` });
        const { res, ctx } = makeResWithCtx();
        await apiKeyAuth(req, res, vi.fn());
        expect(ctx.headers["X-RateLimit-Limit"]).toBe(100);
      }
    );
  });
});

// ── abuseDetection tests ───────────────────────────────────────────────────

describe("abuseDetection", () => {
  beforeEach(() => {
    _clearAbuseStateForTesting();
    _clearStoreForTesting();
  });

  it("skips tracking for anon requests and always calls next()", () => {
    const req = makeReq() as Request & { apiKeyId?: string };
    const { res } = makeResWithCtx();
    const next = vi.fn();

    abuseDetection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // No state should be created
    expect(_getKeyStateForTesting("anon")).toBeUndefined();
  });

  it("creates state and increments counter for named keys", () => {
    const keyId = "track-me-001";
    const req = makeReq() as Request & { apiKeyId?: string };
    req.apiKeyId = keyId;
    const next = vi.fn();

    abuseDetection(req, makeResWithCtx().res, next);

    expect(next).toHaveBeenCalledOnce();
    const state = _getKeyStateForTesting(keyId);
    expect(state).toBeDefined();
    expect(state!.current.count).toBe(1);
  });

  it("accumulates count across multiple calls in the same window", () => {
    const keyId = "accumulate-002";
    const next = vi.fn();

    for (let i = 0; i < 10; i++) {
      const req = makeReq() as Request & { apiKeyId?: string };
      req.apiKeyId = keyId;
      abuseDetection(req, makeResWithCtx().res, next);
    }

    const state = _getKeyStateForTesting(keyId);
    expect(state!.current.count).toBe(10);
  });

  it("always calls next() (abuse detection is passive, not blocking)", () => {
    const keyId = "passive-003";
    const next = vi.fn();

    // Even 500 requests — should never block
    for (let i = 0; i < 500; i++) {
      const req = makeReq() as Request & { apiKeyId?: string };
      req.apiKeyId = keyId;
      abuseDetection(req, makeResWithCtx().res, next);
    }

    expect(next).toHaveBeenCalledTimes(500);
  });

  it("anomalousStreak stays 0 when count is below MIN_BURST_COUNT", () => {
    const keyId = "low-traffic-004";
    const next = vi.fn();

    // 49 requests — below MIN_BURST_COUNT threshold
    for (let i = 0; i < 49; i++) {
      const req = makeReq() as Request & { apiKeyId?: string };
      req.apiKeyId = keyId;
      abuseDetection(req, makeResWithCtx().res, next);
    }

    const state = _getKeyStateForTesting(keyId);
    expect(state!.anomalousStreak).toBe(0);
  });

  it("suspends a key via suspendApiKey and getApiKeyById reflects suspension", () => {
    const { record } = createApiKey("abuse-victim-dao");
    const keyId = record.id;

    suspendApiKey(keyId);

    const view = getApiKeyById(keyId);
    expect(view).not.toBeNull();
    expect(view!.suspended).toBe(true);
    expect(view!.suspendedAt).not.toBeNull();
  });

  it("does not create state entries for undefined/empty keyId", () => {
    const req = makeReq() as Request & { apiKeyId?: string };
    req.apiKeyId = undefined;
    const next = vi.fn();

    abuseDetection(req, makeResWithCtx().res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(_getKeyStateForTesting("")).toBeUndefined();
  });
});

// ── Integration: apiKeyAuth → abuseDetection pipeline ────────────────────

describe("apiKeyAuth + abuseDetection pipeline", () => {
  beforeEach(() => {
    _clearStoreForTesting();
    _clearAbuseStateForTesting();
  });

  it("apiKeyAuth sets req.apiKeyId which abuseDetection then tracks", async () => {
    const { rawKey, record } = createApiKey("pipeline-dao");
    const next = vi.fn();

    // Simulate middleware chaining manually
    const req = makeReq({
      headers: { authorization: `Bearer ${rawKey}` },
    }) as Request & { apiKeyId?: string; apiKeyTier?: string };

    let abuseWasCalled = false;

    await apiKeyAuth(req, makeResWithCtx().res, () => {
      // apiKeyAuth called next — now run abuseDetection in the chain
      abuseDetection(req, makeResWithCtx().res, () => {
        abuseWasCalled = true;
        next();
      });
    });

    expect(next).toHaveBeenCalledOnce();
    expect(abuseWasCalled).toBe(true);
    expect(req.apiKeyId).toBe(record.id);
    expect(req.apiKeyTier).toBe("verified-dao");

    const state = _getKeyStateForTesting(record.id);
    expect(state).toBeDefined();
    expect(state!.current.count).toBe(1);
  });

  it("suspended keys are blocked by apiKeyAuth — abuseDetection never runs", async () => {
    const { rawKey, record } = createApiKey("blocked-pipeline-dao");
    suspendApiKey(record.id);

    const req = makeReq({ headers: { authorization: `Bearer ${rawKey}` } });
    const { res, ctx } = makeResWithCtx();
    const abuseNext = vi.fn();

    await apiKeyAuth(req, res, () => {
      // Should never reach here — auth should reject suspended key
      abuseDetection(req, makeResWithCtx().res, abuseNext);
    });

    expect(abuseNext).not.toHaveBeenCalled();
    expect(ctx.status).toBe(403);
  });

  it("read and write requests for the same key use separate rate-limit buckets", async () => {
    const { rawKey } = createApiKey("bucket-isolation-dao");
    const next = vi.fn();

    // POST (write bucket) — 10 requests should all pass
    for (let i = 0; i < 10; i++) {
      const req = makeReq({ method: "POST", headers: { authorization: `Bearer ${rawKey}` } });
      const { res } = makeResWithCtx();
      await apiKeyAuth(req, res, next);
    }

    // GET (read bucket) — should still have all 1000 available
    const getReq = makeReq({ method: "GET", headers: { authorization: `Bearer ${rawKey}` } });
    const { res: getRes, ctx: getCtx } = makeResWithCtx();
    await apiKeyAuth(getReq, getRes, next);

    // Should not be rate-limited — it's a different bucket
    expect(getCtx.status).not.toBe(429);
    // Remaining should reflect 999 reads left
    expect(getCtx.headers["X-RateLimit-Remaining"]).toBe(999);
  });
});
