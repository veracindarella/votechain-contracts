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
 * WalletProfile page — vote delegation settings (#329).
 *
 * Lets a connected wallet delegate its voting power to another Stellar
 * address, see and change/remove its current delegate, and signs the
 * `delegate`/`undelegate` contract calls via Freighter — mirroring the
 * signing pattern already used by VotingPanel's castVoteViaFreighter.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { useTransactionStatus } from "../hooks/useTransactionStatus";
import { TransactionToast } from "../components/TransactionToast";
import { isValidStellarAddress, isStellarAddressEmpty } from "../utils/stellarAddress";

// ---------------------------------------------------------------------------
// Freighter signing helper (same placeholder-XDR approach as VotingPanel's
// castVoteViaFreighter until the frontend wires in the real SDK/XDR builder).
// ---------------------------------------------------------------------------

type FreighterApi = {
  signTransaction: (xdr: string, opts?: { network?: string }) => Promise<string>;
};

function getFreighter(): FreighterApi | undefined {
  return (window as unknown as Record<string, unknown>).freighter as FreighterApi | undefined;
}

async function signContractCall(
  fn: "delegate" | "undelegate",
  args: Record<string, string>,
  network: string
): Promise<string> {
  const freighter = getFreighter();
  if (!freighter) throw new Error("Freighter extension not found.");

  const payload = btoa(JSON.stringify({ fn, ...args }));
  const signedXdr = await freighter.signTransaction(payload, { network });

  const encoder = new TextEncoder();
  const data = encoder.encode(signedXdr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function WalletProfile() {
  const { connected, connecting, connect, address, network } = useWallet();
  const { tx, submit, retry, reset } = useTransactionStatus();

  const [currentDelegate, setCurrentDelegate] = useState<string | null>(null);
  const [loadingDelegate, setLoadingDelegate] = useState(false);
  const [delegateInput, setDelegateInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const inputEmpty = isStellarAddressEmpty(delegateInput);
  const inputValid = !inputEmpty && isValidStellarAddress(delegateInput.trim());
  const inputInvalid = !inputEmpty && !inputValid;
  const isSelfDelegation =
    inputValid && address !== null && delegateInput.trim().toUpperCase() === address.toUpperCase();

  const fetchCurrentDelegate = useCallback(async () => {
    if (!address) return;
    setLoadingDelegate(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/wallet/${address}/delegate`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { delegate?: string | null };
      // The contract defaults an address to delegating to itself, which we
      // treat as "no delegate" for display purposes.
      const delegate = data.delegate && data.delegate !== address ? data.delegate : null;
      setCurrentDelegate(delegate);
    } catch (err: unknown) {
      setFetchError((err as { message?: string })?.message ?? "Failed to load current delegate.");
    } finally {
      setLoadingDelegate(false);
    }
  }, [address]);

  useEffect(() => {
    if (connected) fetchCurrentDelegate();
  }, [connected, fetchCurrentDelegate]);

  async function handleDelegate() {
    if (!address || !network || !inputValid) return;
    setSubmitting(true);
    try {
      const hash = await signContractCall(
        "delegate",
        { delegator: address, delegate: delegateInput.trim() },
        network
      );
      setCurrentDelegate(delegateInput.trim());
      setDelegateInput("");
      submit(hash);
    } catch (err: unknown) {
      submit("error");
      console.error("[WalletProfile] delegate error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveDelegate() {
    if (!address || !network) return;
    setSubmitting(true);
    try {
      const hash = await signContractCall("undelegate", { delegator: address }, network);
      setCurrentDelegate(null);
      submit(hash);
    } catch (err: unknown) {
      submit("error");
      console.error("[WalletProfile] undelegate error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="wallet-profile-title" className="card">
      <h2 id="wallet-profile-title">Wallet Profile</h2>

      <TransactionToast
        tx={tx}
        onRetry={tx.hash ? () => retry(tx.hash!) : undefined}
        onDismiss={reset}
      />

      {!connected && (
        <div className="wallet-prompt" role="status">
          <p>Connect your Freighter wallet to manage vote delegation.</p>
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            aria-label="Connect Freighter wallet"
            className="btn-primary"
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        </div>
      )}

      {connected && (
        <div className="delegation-settings" aria-labelledby="delegation-settings-title">
          <h3 id="delegation-settings-title">Vote delegation</h3>
          <p>
            Delegate your voting power to a trusted address. They will be able
            to vote on your behalf with your token balance via{" "}
            <code>cast_vote_with_delegators</code>; you can remove the
            delegation at any time to vote directly again.
          </p>

          {loadingDelegate && <p aria-live="polite">Loading current delegate…</p>}
          {!loadingDelegate && fetchError && (
            <div role="alert" className="error-state">
              <p>{fetchError}</p>
              <button type="button" onClick={fetchCurrentDelegate} className="filter-btn">
                Retry
              </button>
            </div>
          )}

          {!loadingDelegate && !fetchError && (
            <div className="current-delegate" aria-live="polite">
              {currentDelegate ? (
                <p>
                  Currently delegated to{" "}
                  <strong title={currentDelegate}>
                    {currentDelegate.slice(0, 6)}…{currentDelegate.slice(-4)}
                  </strong>
                  .{" "}
                  <button
                    type="button"
                    onClick={handleRemoveDelegate}
                    disabled={submitting}
                    className="filter-btn"
                    aria-label="Remove current delegate"
                  >
                    Remove delegate
                  </button>
                </p>
              ) : (
                <p>You are not currently delegating your voting power to anyone.</p>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDelegate();
            }}
            aria-label="Set a new delegate"
          >
            <label htmlFor="delegate-address">Delegate's Stellar address</label>
            <input
              id="delegate-address"
              type="text"
              value={delegateInput}
              onChange={(e) => setDelegateInput(e.target.value)}
              placeholder="G..."
              aria-invalid={inputInvalid || isSelfDelegation}
              aria-describedby="delegate-address-hint"
            />
            <span id="delegate-address-hint" role="status">
              {inputInvalid && "Enter a valid Stellar public address (G...)."}
              {isSelfDelegation && "You cannot delegate to your own address."}
            </span>
            <button
              type="submit"
              className="btn-primary"
              disabled={!inputValid || isSelfDelegation || submitting}
            >
              {submitting ? "Submitting…" : "Set delegate"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
