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
 * Key management routes — all endpoints require admin JWT auth.
 *
 * POST   /api/keys          — Create a new verified-DAO API key
 * GET    /api/keys          — List all keys (sanitised, no raw key material)
 * GET    /api/keys/:id      — Get status of a single key
 * POST   /api/keys/:id/rotate  — Rotate (re-issue) a key
 * DELETE /api/keys/:id      — Revoke a key permanently
 *
 * Request/response shapes are documented in docs/api-keys.md.
 *
 * The raw key is returned exactly once:
 *   - In the POST /api/keys response body under `rawKey`.
 *   - In the POST /api/keys/:id/rotate response body under `rawKey`.
 * It is never stored or retrievable again.
 */

import { Router, Request, Response } from "express";
import { adminAuth } from "./adminAuth";
import {
  createApiKey,
  rotateApiKey,
  revokeApiKey,
  getApiKeyById,
  listApiKeys,
  ApiKeyTier,
} from "./apiKeyStore";

const router = Router();

// All key management endpoints require admin authentication.
router.use(adminAuth);

// ── Validators ─────────────────────────────────────────────────────────────

const VALID_TIERS: Set<string> = new Set<ApiKeyTier>(["verified-dao"]);

function isValidDaoId(daoId: unknown): daoId is string {
  return typeof daoId === "string" && daoId.trim().length > 0 && daoId.trim().length <= 128;
}

// ── POST /api/keys — Create a new key ─────────────────────────────────────

router.post("/", (req: Request, res: Response) => {
  const { daoId, tier } = req.body as { daoId?: unknown; tier?: unknown };

  if (!isValidDaoId(daoId)) {
    return res.status(400).json({
      error: {
        code: "INVALID_DAO_ID",
        message: "daoId must be a non-empty string of 1–128 characters",
        details: [],
      },
    });
  }

  const resolvedTier: ApiKeyTier =
    typeof tier === "string" && VALID_TIERS.has(tier)
      ? (tier as ApiKeyTier)
      : "verified-dao";

  const { record, rawKey } = createApiKey(daoId.trim(), resolvedTier);

  // HTTP 201 — include the raw key in the response body (only time it's shown)
  return res.status(201).json({
    ...record,
    rawKey,
    warning:
      "Store this key securely. It will not be shown again. Use POST /api/keys/:id/rotate to issue a replacement.",
  });
});

// ── GET /api/keys — List all keys ─────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  const keys = listApiKeys();
  return res.json({ data: keys, total: keys.length });
});

// ── GET /api/keys/:id — Get key status ────────────────────────────────────

router.get("/:id", (req: Request, res: Response) => {
  const record = getApiKeyById(req.params.id);
  if (!record) {
    return res.status(404).json({
      error: { code: "KEY_NOT_FOUND", message: "API key not found", details: [] },
    });
  }
  return res.json(record);
});

// ── POST /api/keys/:id/rotate — Rotate a key ──────────────────────────────

router.post("/:id/rotate", (req: Request, res: Response) => {
  try {
    const { record, rawKey } = rotateApiKey(req.params.id);
    return res.json({
      ...record,
      rawKey,
      warning:
        "The previous key is now invalid. Store this new key securely — it will not be shown again.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rotation failed";
    const isNotFound = message.includes("not found");
    return res.status(isNotFound ? 404 : 400).json({
      error: {
        code: isNotFound ? "KEY_NOT_FOUND" : "ROTATION_FAILED",
        message,
        details: [],
      },
    });
  }
});

// ── DELETE /api/keys/:id — Revoke a key ───────────────────────────────────

router.delete("/:id", (req: Request, res: Response) => {
  try {
    const view = revokeApiKey(req.params.id);
    return res.json({ ok: true, revoked: view });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Revocation failed";
    return res.status(404).json({
      error: { code: "KEY_NOT_FOUND", message, details: [] },
    });
  }
});

export default router;
