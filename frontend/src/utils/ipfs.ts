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
 * Helpers for rendering the optional IPFS comment hash attached to a vote
 * (issue #103). The chain stores only the CID string — it does not validate
 * or resolve it. Resolution/display is entirely an off-chain concern.
 */

/** Default public IPFS gateway used to resolve a CID for display. */
const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

/** Fallback gateways tried in order if the configured/default gateway times out or errors (#331). */
const FALLBACK_IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/** Default per-gateway fetch timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Returns `true` if `commentHash` is a non-empty string, i.e. the voter
 * attached an off-chain comment to their vote.
 */
export function hasComment(commentHash: string | null | undefined): commentHash is string {
  return typeof commentHash === 'string' && commentHash.trim().length > 0;
}

/**
 * Builds a clickable gateway URL for a given IPFS CID.
 *
 * This does not verify that the CID is well-formed or that content exists
 * at the resulting URL — the contract does not validate comment hashes
 * on-chain, so the link may 404 if the content was never pinned.
 */
export function ipfsGatewayUrl(commentHash: string, gateway: string = DEFAULT_IPFS_GATEWAY): string {
  return `${gateway}${commentHash.trim()}`;
}

/**
 * Uploads `content` to IPFS via an upload endpoint (e.g. an API route that
 * proxies to a pinning service such as Pinata/web3.storage) and returns the
 * resulting CID.
 *
 * `uploadUrl` defaults to the backend's own `/api/ipfs/upload` proxy so the
 * pinning service's credentials never reach the browser. It must respond
 * with JSON of the shape `{ cid: string }`.
 */
export async function uploadToIpfs(
  content: string,
  uploadUrl: string = '/api/ipfs/upload',
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`IPFS upload failed: HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { cid?: string };
    if (!data.cid) {
      throw new Error('IPFS upload response missing "cid" field.');
    }
    return data.cid;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches the raw text content for `cid` from an IPFS gateway.
 *
 * Tries `gateway` (or the default public gateway) first, then falls back to
 * {@link FALLBACK_IPFS_GATEWAYS} in order if the primary gateway times out
 * or returns a non-OK response. Throws only if every gateway fails.
 */
export async function fetchFromIpfs(
  cid: string,
  gateway: string = DEFAULT_IPFS_GATEWAY,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const trimmedCid = cid.trim();
  const gateways = [gateway, ...FALLBACK_IPFS_GATEWAYS.filter((g) => g !== gateway)];

  let lastError: unknown;
  for (const gw of gateways) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(ipfsGatewayUrl(trimmedCid, gw), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      // Try the next gateway.
    } finally {
      clearTimeout(timer);
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to fetch IPFS content for CID "${trimmedCid}" from all gateways: ${reason}`);
}

/**
 * Marker prefix used to embed a full-description CID inside the on-chain
 * (1024-char-limited) proposal description, since the Soroban contract has
 * no dedicated field for it (#331). Format: `<excerpt>\n\nipfs:<cid>`.
 */
const FULL_DESCRIPTION_CID_MARKER = '\n\nipfs:';

/** Appends an encoded full-description CID marker to an on-chain description. */
export function encodeFullDescriptionCid(onChainDescription: string, cid: string): string {
  return `${onChainDescription}${FULL_DESCRIPTION_CID_MARKER}${cid.trim()}`;
}

/**
 * Extracts a full-description CID embedded via {@link encodeFullDescriptionCid},
 * if present. Returns the on-chain excerpt (marker stripped) plus the CID,
 * or `null` if the description carries no CID marker.
 */
export function decodeFullDescriptionCid(
  description: string
): { excerpt: string; cid: string } | null {
  const idx = description.lastIndexOf(FULL_DESCRIPTION_CID_MARKER);
  if (idx === -1) return null;
  const cid = description.slice(idx + FULL_DESCRIPTION_CID_MARKER.length).trim();
  if (!cid) return null;
  return { excerpt: description.slice(0, idx), cid };
}
