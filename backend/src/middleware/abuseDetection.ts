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
 * Abuse detection middleware for verified-DAO API keys.
 *
 * Algorithm — sliding-window burst detection:
 *
 *   1. Maintains a per-key sliding window of request counts, sampled in
 *      SAMPLE_WINDOW_SECONDS buckets.
 *   2. After each request the current window total is compared to a rolling
 *      baseline average of the previous BASELINE_WINDOWS windows.
 *   3. If the current window exceeds BURST_MULTIPLIER × baseline AND the
 *      absolute count exceeds MIN_BURST_COUNT, the window is flagged as
 *      anomalous.
 *   4. After SUSPEND_AFTER_ANOMALOUS_WINDOWS consecutive anomalous windows
 *      the key is automatically suspended via suspendApiKey().
 *   5. Suspension is logged at "warn" level; the client receives HTTP 403
 *      from apiKeyAuth on the next request.
 *
 * This middleware is passive — it records telemetry and may suspend keys
 * but never blocks the current request directly. Rate-limiting (429) is the
 * responsibility of apiKeyAuth.
 *
 * Anon requests (no req.apiKeyId) are skipped — abuse detection only applies
 * to named keys.
 */

import { Request, Response, NextFunction } from "express";
import { suspendApiKey } from "./apiKeyStore";
import { log } from "./requestTracing";

// ── Configuration ──────────────────────────────────────────────────────────

/** Width of each sample bucket in seconds. */
const SAMPLE_WINDOW_SECONDS = 300; // 5 minutes

/** Number of historical windows used to compute the baseline average. */
const BASELINE_WINDOWS = 6; // 30 minutes of history

/**
 * Ratio of current-window traffic to baseline that triggers an anomaly flag.
 * Traffic must be at least this many times higher than the rolling average.
 */
const BURST_MULTIPLIER = 2;

/**
 * Minimum absolute request count in the current window to trigger an anomaly.
 * Prevents false positives when both current and baseline are very low.
 */
const MIN_BURST_COUNT = 50;

/** Number of consecutive anomalous windows required to suspend a key. */
const SUSPEND_AFTER_ANOMALOUS_WINDOWS = 3;

// ── Data structures ────────────────────────────────────────────────────────

interface WindowRecord {
  /** Start epoch-second of this window. */
  windowStart: number;
  /** Total requests counted in this window. */
  count: number;
}

interface KeyState {
  /** Circular buffer of past windows (oldest first). */
  history: WindowRecord[];
  /** Consecutive anomalous-window streak counter. */
  anomalousStreak: number;
  /** The window currently being accumulated. */
  current: WindowRecord;
}

const keyStates = new Map<string, KeyState>();

// ── Helpers ────────────────────────────────────────────────────────────────

function currentWindowStart(nowSeconds: number): number {
  return Math.floor(nowSeconds / SAMPLE_WINDOW_SECONDS) * SAMPLE_WINDOW_SECONDS;
}

function getOrCreateState(keyId: string, nowSeconds: number): KeyState {
  let state = keyStates.get(keyId);
  if (!state) {
    state = {
      history: [],
      anomalousStreak: 0,
      current: { windowStart: currentWindowStart(nowSeconds), count: 0 },
    };
    keyStates.set(keyId, state);
  }
  return state;
}

/**
 * Rotates the current window into history when a new window starts.
 * Trims the history to BASELINE_WINDOWS entries.
 */
function advanceWindowIfNeeded(state: KeyState, nowSeconds: number): void {
  const expectedStart = currentWindowStart(nowSeconds);
  if (state.current.windowStart === expectedStart) return;

  // Archive the completed window
  state.history.push({ ...state.current });
  // Trim to keep only the most recent BASELINE_WINDOWS entries
  if (state.history.length > BASELINE_WINDOWS) {
    state.history.splice(0, state.history.length - BASELINE_WINDOWS);
  }

  // Start a fresh current window
  state.current = { windowStart: expectedStart, count: 0 };
}

/**
 * Computes the average request count over the historical windows.
 * Returns 0 when no history exists (new key, cold start).
 */
function baselineAverage(history: WindowRecord[]): number {
  if (history.length === 0) return 0;
  const sum = history.reduce((acc, w) => acc + w.count, 0);
  return sum / history.length;
}

// ── Middleware ─────────────────────────────────────────────────────────────

/**
 * Records each request for named API keys and detects burst anomalies.
 * Must run after apiKeyAuth so that req.apiKeyId is populated.
 */
export function abuseDetection(req: Request, _res: Response, next: NextFunction): void {
  const keyId = req.apiKeyId;

  // Only track named keys — anon traffic is not individually accountable
  if (!keyId) {
    next();
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const state = getOrCreateState(keyId, nowSeconds);

  // Roll over to a new window if the time boundary has passed
  advanceWindowIfNeeded(state, nowSeconds);

  // Increment current window counter
  state.current.count += 1;

  // Evaluate anomaly only when we have enough history to form a baseline
  if (state.history.length >= 1) {
    const avg = baselineAverage(state.history);
    const current = state.current.count;

    const isAnomaly =
      current >= MIN_BURST_COUNT &&
      avg > 0 &&
      current > BURST_MULTIPLIER * avg;

    // Also flag if absolute count is very high even with no prior history
    const isAbsoluteSpike =
      current >= MIN_BURST_COUNT * BURST_MULTIPLIER * 2 && avg === 0;

    if (isAnomaly || isAbsoluteSpike) {
      state.anomalousStreak += 1;
      log("warn", "abuseDetection: anomalous traffic pattern detected", {
        keyId,
        currentWindowCount: current,
        baselineAvg: avg,
        streak: state.anomalousStreak,
        threshold: BURST_MULTIPLIER,
      });

      if (state.anomalousStreak >= SUSPEND_AFTER_ANOMALOUS_WINDOWS) {
        suspendApiKey(keyId);
        // Reset streak so if key is rotated and we get a new id the old state
        // doesn't bleed over (state is keyed by keyId, so rotation creates a
        // fresh entry naturally)
        log("warn", "abuseDetection: key suspended after repeated anomalies", {
          keyId,
          streak: state.anomalousStreak,
        });
      }
    } else if (state.anomalousStreak > 0) {
      // Window is normal — decay the streak
      state.anomalousStreak = Math.max(0, state.anomalousStreak - 1);
    }
  }

  next();
}

// ── Test helpers ───────────────────────────────────────────────────────────

/**
 * Returns a copy of the internal state for a given key.
 * For use in tests only.
 * @internal
 */
export function _getKeyStateForTesting(keyId: string): KeyState | undefined {
  const s = keyStates.get(keyId);
  if (!s) return undefined;
  return {
    history: s.history.map((w) => ({ ...w })),
    anomalousStreak: s.anomalousStreak,
    current: { ...s.current },
  };
}

/**
 * Clears all abuse-detection state. For use in tests only.
 * @internal
 */
export function _clearAbuseStateForTesting(): void {
  keyStates.clear();
}
