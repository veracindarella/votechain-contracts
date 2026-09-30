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
 * In-memory API key store for the verified-DAO tier.
 *
 * Keys are 32-byte random values encoded as hex. Only the SHA-256 hash is
 * stored server-side; the raw key is returned exactly once at creation and
 * again at rotation, then discarded.
 *
 * This implementation is intentionally in-memory for the initial release.
 * Replacing the backing store with PostgreSQL or Redis is a single-file
 * concern — all callers import from this module only.
 *
 * Tiers:
 *   - "anon"         — unauthenticated IP-based limits (100 read / 10 write / min)
 *   - "verified-dao" — authenticated DAO key limits    (1000 read / 100 write / min)
 */

import crypto from "crypto";

// ── Tier definitions ───────────────────────────────────────────────────────

export type ApiKeyTier = "anon" | "verified-dao";

export interface TierLimits {
  readPerMinute: number;
  writePerMinute: number;
}

export const TIER_LIMITS: Record<ApiKeyTier, TierLimits> = {
  anon: { readPerMinute: 100, writePerMinute: 10 },
  "verified-dao": { readPerMinute: 1000, writePerMinute: 100 },
};

// ── Data model ─────────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  /** Opaque ID used to reference the key in management endpoints. */
  id: string;
  /** DAO identifier supplied by the admin at creation time. */
  daoId: string;
  /** SHA-256 hex digest of the raw key — never stored in plaintext. */
  keyHash: string;
  /** Tier granted to this key. */
  tier: ApiKeyTier;
  /** ISO-8601 timestamp of key creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last rotation, or null if never rotated. */
  rotatedAt: string | null;
  /** ISO-8601 timestamp of revocation, or null if still active. */
  revokedAt: string | null;
  /**
   * Whether abuse detection has suspended this key.
   * Suspended keys are rejected with HTTP 403.
   */
  suspended: boolean;
  /** ISO-8601 timestamp when the key was suspended, or null. */
  suspendedAt: string | null;
}

/** Sanitised view returned to callers — omits the stored hash. */
export type ApiKeyView = Omit<ApiKeyRecord, "keyHash">;

// ── Key generation helpers ─────────────────────────────────────────────────

/** Generates a cryptographically-random 32-byte API key as a lowercase hex string. */
export function generateRawKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Returns the SHA-256 hex digest of a raw key string. */
export function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey, "utf8").digest("hex");
}

// ── Store ──────────────────────────────────────────────────────────────────

/** Primary store: keyId → record */
const store = new Map<string, ApiKeyRecord>();

/** Secondary index: keyHash → keyId (for fast lookup on incoming requests) */
const hashIndex = new Map<string, string>();

// ── CRUD operations ────────────────────────────────────────────────────────

export interface CreateKeyResult {
  record: ApiKeyView;
  /** Raw key — shown exactly once. Store it securely; it cannot be retrieved again. */
  rawKey: string;
}

/**
 * Creates a new verified-DAO API key for the given DAO.
 *
 * @param daoId     Human-readable identifier for the DAO (e.g. "astro-dao").
 * @param tier      Tier to grant; defaults to "verified-dao".
 * @returns         The sanitised record and the raw key (shown once).
 */
export function createApiKey(daoId: string, tier: ApiKeyTier = "verified-dao"): CreateKeyResult {
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const record: ApiKeyRecord = {
    id,
    daoId,
    keyHash,
    tier,
    createdAt: now,
    rotatedAt: null,
    revokedAt: null,
    suspended: false,
    suspendedAt: null,
  };

  store.set(id, record);
  hashIndex.set(keyHash, id);

  const { keyHash: _omit, ...view } = record;
  return { record: view, rawKey };
}

export interface RotateKeyResult {
  record: ApiKeyView;
  rawKey: string;
}

/**
 * Rotates an existing key: invalidates the old key hash and issues a new one.
 * The old raw key immediately stops working.
 *
 * @throws {Error} if the key does not exist or is already revoked.
 */
export function rotateApiKey(keyId: string): RotateKeyResult {
  const record = store.get(keyId);
  if (!record) throw new Error(`API key not found: ${keyId}`);
  if (record.revokedAt) throw new Error(`API key already revoked: ${keyId}`);

  // Remove old hash from index
  hashIndex.delete(record.keyHash);

  // Generate new key material
  const rawKey = generateRawKey();
  record.keyHash = hashKey(rawKey);
  record.rotatedAt = new Date().toISOString();
  // Unsuspend on rotation — gives the DAO a clean slate
  record.suspended = false;
  record.suspendedAt = null;

  hashIndex.set(record.keyHash, keyId);

  const { keyHash: _omit, ...view } = record;
  return { record: view, rawKey };
}

/**
 * Revokes a key. Revoked keys are permanently rejected with HTTP 401.
 *
 * @throws {Error} if the key does not exist.
 */
export function revokeApiKey(keyId: string): ApiKeyView {
  const record = store.get(keyId);
  if (!record) throw new Error(`API key not found: ${keyId}`);

  hashIndex.delete(record.keyHash);
  record.revokedAt = new Date().toISOString();

  const { keyHash: _omit, ...view } = record;
  return view;
}

/**
 * Suspends a key due to abuse detection.
 * Unlike revocation, suspension can be lifted by rotating the key.
 */
export function suspendApiKey(keyId: string): void {
  const record = store.get(keyId);
  if (!record) return; // no-op if already deleted
  record.suspended = true;
  record.suspendedAt = new Date().toISOString();
}

/**
 * Returns the sanitised view of a key record by ID, or null if not found.
 */
export function getApiKeyById(keyId: string): ApiKeyView | null {
  const record = store.get(keyId);
  if (!record) return null;
  const { keyHash: _omit, ...view } = record;
  return view;
}

/**
 * Looks up the full record by the SHA-256 hash of an incoming raw key.
 * Used by the authentication middleware.
 *
 * @returns The internal record (including keyHash) or null if not found.
 */
export function lookupByRawKey(rawKey: string): ApiKeyRecord | null {
  const keyHash = hashKey(rawKey);
  const keyId = hashIndex.get(keyHash);
  if (!keyId) return null;
  return store.get(keyId) ?? null;
}

/**
 * Returns all key records as sanitised views. Admin-only.
 */
export function listApiKeys(): ApiKeyView[] {
  return Array.from(store.values()).map(({ keyHash: _omit, ...view }) => view);
}

// ── Test helpers (not exported in production use) ──────────────────────────

/**
 * Clears the store completely. For use in tests only.
 * @internal
 */
export function _clearStoreForTesting(): void {
  store.clear();
  hashIndex.clear();
}
