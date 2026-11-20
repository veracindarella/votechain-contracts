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

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TxState } from "../hooks/useTransactionStatus";

type Props = {
  tx: TxState;
  onRetry?: () => void;
  onDismiss?: () => void;
  autoDismissMs?: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "transaction.pending",
  confirmed: "transaction.confirmed",
  failed: "transaction.failed",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#b8860b",
  confirmed: "#2e7d32",
  failed: "#c62828",
};

/** Auto-dismiss delay (ms) for confirmed transactions */
const AUTO_DISMISS_MS = 8000;
const HISTORY_LIMIT = 5;

export function TransactionToast({
  tx,
  onRetry,
  onDismiss,
  autoDismissMs = AUTO_DISMISS_MS,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  const [history, setHistory] = useState<TxState[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, [tx.hash]);

  useEffect(() => {
    if (tx.status !== "confirmed" || !tx.hash) return;
    setHistory((prev) =>
      prev.some((item) => item.hash === tx.hash && item.status === tx.status)
        ? prev
        : [{ ...tx }, ...prev].slice(0, HISTORY_LIMIT)
    );
  }, [tx]);

  useEffect(() => {
    if (tx.status !== "confirmed" || !visible) return;
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [tx.status, tx.hash, visible, autoDismissMs, onDismiss]);

  const active = tx.status !== "idle" && Boolean(tx.hash);
  const isError = tx.status === "failed";
  const showToast = active && visible;

  const historyPanel = history.length > 0 && (
    <div
      style={{
        position: "fixed",
        bottom: showToast ? 180 : 24,
        right: 24,
        maxWidth: 340,
        background: "#1e1e1e",
        color: "#fff",
        border: "1px solid #555",
        borderRadius: 6,
        padding: "8px 12px",
        zIndex: 9998,
      }}
    >
      <button
        onClick={() => setShowHistory((open) => !open)}
        aria-expanded={showHistory}
        aria-controls="transaction-history"
        style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
      >
        {t("transaction.recent", "Recent transactions")} ({history.length})
      </button>
      {showHistory && (
        <ul id="transaction-history" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {history.map((item) => (
            <li key={`${item.hash}-${item.status}`} style={{ fontSize: 12, marginBottom: 4 }}>
              <span>{t(STATUS_LABEL[item.status] ?? "transaction.pending")}</span>{" "}
              {item.explorerUrl ? (
                <a
                  href={item.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "#90caf9" }}
                >
                  {item.hash.slice(0, 8)}… ↗
                </a>
              ) : (
                <span style={{ opacity: 0.7 }}>{item.hash.slice(0, 8)}…</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!showToast && !historyPanel) return null;

  return (
    <>
      {showToast && (
      <div
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
        aria-atomic="true"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: "#1e1e1e",
          color: "#fff",
          borderLeft: `4px solid ${STATUS_COLOR[tx.status] ?? "#888"}`,
          borderRadius: 6,
          padding: "12px 16px",
          minWidth: 300,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          zIndex: 9999,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {t(STATUS_LABEL[tx.status])}
        </div>
  
        <div style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-all" }}>
          {tx.hash}
        </div>
  
        {tx.explorerUrl && tx.status === "confirmed" && (
          <a
            href={tx.explorerUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "#90caf9", display: "block", marginTop: 4 }}
          >
            {t("transaction.viewExplorer")} ↗
          </a>
        )}
  
        {tx.error && (
          <div style={{ color: "#ef9a9a", fontSize: 12, marginTop: 4 }}>
            {tx.error}
          </div>
        )}
  
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {tx.status === "failed" && onRetry && (
            <button
              onClick={onRetry}
              style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
              aria-label={t("transaction.retry")}
            >
              {t("transaction.retryButton")}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => {
                setVisible(false);
                onDismiss();
              }}
              style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
              aria-label={t("transaction.dismiss")}
            >
              {t("transaction.dismissButton")}
            </button>
          )}
        </div>
      </div>
      )}
      {historyPanel}
    </>
  );
}
