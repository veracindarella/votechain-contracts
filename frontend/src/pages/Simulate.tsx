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
 * Simulate page — issue #111
 *
 * Allows users to explore quorum scenarios interactively without submitting
 * any on-chain transaction.  The pass/fail outcome is computed in real-time
 * in the browser using the same logic as the on-chain governance contract:
 *
 *   total_votes = votes_yes + votes_no + votes_abstain
 *   passed      = total_votes >= quorum  AND  votes_yes > votes_no
 *
 * A secondary "Verify via API" button sends the same inputs to POST /simulate
 * and displays the server response, providing a round-trip sanity check.
 */

import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimulateApiResponse {
  passed: boolean;
  total_votes: number;
  quorum_met: boolean;
  majority_met: boolean;
  margin: number;
}

interface SimulationResult {
  passed: boolean;
  total_votes: number;
  quorum_met: boolean;
  majority_met: boolean;
  margin: number;
}

// ---------------------------------------------------------------------------
// Pass condition (mirrors contracts/governance/src/lib.rs)
// ---------------------------------------------------------------------------

/**
 * Evaluates the on-chain pass condition locally for instant preview.
 *
 *   total_votes = votes_yes + votes_no + votes_abstain
 *   quorum_met  = total_votes >= quorum
 *   majority_met = votes_yes > votes_no
 *   passed      = quorum_met AND majority_met
 */
function computeResult(
  votesYes: number,
  votesNo: number,
  votesAbstain: number,
  quorum: number,
): SimulationResult {
  const total_votes = votesYes + votesNo + votesAbstain;
  const quorum_met = total_votes >= quorum;
  const majority_met = votesYes > votesNo;
  const passed = quorum_met && majority_met;
  const margin = votesYes - votesNo;
  return { passed, total_votes, quorum_met, majority_met, margin };
}

type SimulateField =
  | "tokenSupply"
  | "quorum"
  | "votesYes"
  | "votesNo"
  | "votesAbstain";

type FieldErrors = Partial<Record<SimulateField, string>>;

interface SimulationInputs {
  tokenSupply: number;
  quorum: number;
  votesYes: number;
  votesNo: number;
  votesAbstain: number;
}

function validateInputs(inputs: SimulationInputs): FieldErrors {
  const errors: FieldErrors = {};
  const values: SimulateField[] = [
    "tokenSupply",
    "quorum",
    "votesYes",
    "votesNo",
    "votesAbstain",
  ];

  for (const field of values) {
    if (!Number.isFinite(inputs[field]) || inputs[field] < 0) {
      errors[field] = "Enter a non-negative number.";
    }
  }

  if (!errors.tokenSupply && inputs.tokenSupply <= 0) {
    errors.tokenSupply = "Token supply must be greater than zero.";
  }
  if (!errors.quorum && inputs.quorum > inputs.tokenSupply) {
    errors.quorum = "Quorum cannot exceed the token supply.";
  }

  const totalVotes = inputs.votesYes + inputs.votesNo + inputs.votesAbstain;
  for (const field of ["votesYes", "votesNo", "votesAbstain"] as const) {
    if (!errors[field] && totalVotes > inputs.tokenSupply) {
      errors[field] = "Vote counts cannot exceed the token supply in total.";
    }
  }

  return errors;
}

const BACKEND_FIELD_NAMES: Record<string, SimulateField> = {
  token_supply: "tokenSupply",
  quorum: "quorum",
  votes_yes: "votesYes",
  votes_no: "votesNo",
  votes_abstain: "votesAbstain",
};

function backendErrorToField(message: string): SimulateField | undefined {
  const match = message.match(/'([a-z_]+)'/);
  return match ? BACKEND_FIELD_NAMES[match[1]] : undefined;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SliderFieldProps {
  id: string;
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  error?: string;
}

/**
 * Accessible numeric input with a range slider and a number box kept in sync.
 */
function SliderField({
  id,
  label,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  error,
}: SliderFieldProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(e.target.value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(Math.min(parsed, max));
    }
  };

  return (
    <div style={{ marginBottom: "1rem" }}>
      <label htmlFor={id} style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
        {label}: <strong>{value.toLocaleString()}</strong>
      </label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          style={{ flex: 1 }}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <input
          id={`${id}-number`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          style={{ width: "110px" }}
          aria-label={`${label} (numeric input)`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" style={{ color: "#721c24", marginTop: "0.25rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}

interface ResultBannerProps {
  result: SimulationResult;
  t: (key: string, fallback?: string) => string;
}

/**
 * Displays a colour-coded pass/fail banner with quorum and majority details.
 */
function ResultBanner({ result, t }: ResultBannerProps) {
  const { passed, total_votes, quorum_met, majority_met, margin } = result;

  const bannerStyle: React.CSSProperties = {
    padding: "1rem",
    borderRadius: "6px",
    marginTop: "1.5rem",
    backgroundColor: passed ? "#d4edda" : "#f8d7da",
    border: `1px solid ${passed ? "#c3e6cb" : "#f5c6cb"}`,
    color: passed ? "#155724" : "#721c24",
  };

  return (
    <div role="status" aria-live="polite" style={bannerStyle}>
      <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem" }}>
        {passed
          ? t("simulate.result.passed", "✅ Proposal would PASS")
          : t("simulate.result.rejected", "❌ Proposal would be REJECTED")}
      </h2>
      <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
        <li>
          <strong>{t("simulate.totalVotes", "Total votes")}:</strong>{" "}
          {total_votes.toLocaleString()}
        </li>
        <li>
          <strong>{t("simulate.quorumMet", "Quorum met")}:</strong>{" "}
          {quorum_met
            ? t("simulate.yes", "Yes")
            : t("simulate.no", "No")}
        </li>
        <li>
          <strong>{t("simulate.majorityMet", "Majority met")}:</strong>{" "}
          {majority_met
            ? t("simulate.yes", "Yes")
            : t("simulate.no", "No")}
        </li>
        <li>
          <strong>{t("simulate.margin", "Yes−No margin")}:</strong>{" "}
          {margin.toLocaleString()}
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

/**
 * Simulate page — interactive quorum scenario explorer (issue #111).
 */
export default function Simulate() {
  const { t } = useTranslation();

  // ---- Slider state --------------------------------------------------------
  const DEFAULT_SUPPLY = 10_000_000;

  const [tokenSupply, setTokenSupply] = useState<number>(DEFAULT_SUPPLY);
  const [votesYes, setVotesYes] = useState<number>(3_000_000);
  const [votesNo, setVotesNo] = useState<number>(1_000_000);
  const [votesAbstain, setVotesAbstain] = useState<number>(500_000);
  const [quorum, setQuorum] = useState<number>(5_000_000);

  // ---- API call state ------------------------------------------------------
  const [apiResult, setApiResult] = useState<SimulateApiResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // ---- Real-time local computation -----------------------------------------
  const localResult = computeResult(votesYes, votesNo, votesAbstain, quorum);

  // ---- Clamping helpers ----------------------------------------------------
  const clampToSupply = (value: number) => Math.min(value, tokenSupply);

  const handleTokenSupplyChange = useCallback(
    (value: number) => {
      setTokenSupply(value);
      // Clamp downstream values so they stay within bounds.
      setVotesYes((prev) => Math.min(prev, value));
      setVotesNo((prev) => Math.min(prev, value));
      setVotesAbstain((prev) => Math.min(prev, value));
      setQuorum((prev) => Math.min(prev, value));
    },
    [],
  );

  // ---- API call stub -------------------------------------------------------
  /**
   * Sends the current inputs to POST /simulate and stores the response.
   * Stub: uses the VITE_API_URL env var (defaults to localhost:3001).
   */
  const handleCallApi = useCallback(async () => {
    const errors = validateInputs({
      tokenSupply,
      quorum,
      votesYes,
      votesNo,
      votesAbstain,
    });
    setFieldErrors(errors);
    setApiError(null);
    setApiResult(null);
    if (Object.keys(errors).length > 0) return;

    setApiLoading(true);
    try {
      const base = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
      const response = await fetch(`${base}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_supply: tokenSupply,
          votes_yes: votesYes,
          votes_no: votesNo,
          votes_abstain: votesAbstain,
          quorum,
        }),
      });
      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        const message =
          typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
        const field = backendErrorToField(message);
        if (field) {
          setFieldErrors((prev) => ({ ...prev, [field]: message }));
        } else {
          setApiError(message);
        }
        return;
      }
      const data = (await response.json()) as SimulateApiResponse;
      setFieldErrors({});
      setApiResult(data);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiLoading(false);
    }
  }, [tokenSupply, votesYes, votesNo, votesAbstain, quorum]);

  // ---- Render --------------------------------------------------------------
  return (
    <div style={{ maxWidth: "640px", margin: "2rem auto", padding: "0 1rem" }}>
      <h1>{t("simulate.title", "Proposal Simulation")}</h1>
      <p style={{ color: "#555" }}>
        {t(
          "simulate.description",
          "Adjust the sliders to explore how different vote distributions affect proposal outcomes. Results are computed instantly using the same logic as the on-chain contract.",
        )}
      </p>

      {/* ---- Inputs ---- */}
      <section aria-label={t("simulate.inputsSection", "Simulation inputs")}>
        <SliderField
          id="tokenSupply"
          label={t("simulate.tokenSupply", "Token supply")}
          value={tokenSupply}
          min={1}
          max={100_000_000}
          step={100_000}
          onChange={handleTokenSupplyChange}
          error={fieldErrors.tokenSupply}
        />

        <SliderField
          id="quorum"
          label={t("simulate.quorum", "Quorum threshold")}
          value={quorum}
          min={0}
          max={tokenSupply}
          step={100_000}
          onChange={(v) => setQuorum(clampToSupply(v))}
          error={fieldErrors.quorum}
        />

        <SliderField
          id="votesYes"
          label={t("simulate.votesYes", "Yes votes")}
          value={votesYes}
          min={0}
          max={tokenSupply}
          step={100_000}
          onChange={(v) => setVotesYes(clampToSupply(v))}
          error={fieldErrors.votesYes}
        />

        <SliderField
          id="votesNo"
          label={t("simulate.votesNo", "No votes")}
          value={votesNo}
          min={0}
          max={tokenSupply}
          step={100_000}
          onChange={(v) => setVotesNo(clampToSupply(v))}
          error={fieldErrors.votesNo}
        />

        <SliderField
          id="votesAbstain"
          label={t("simulate.votesAbstain", "Abstain votes")}
          value={votesAbstain}
          min={0}
          max={tokenSupply}
          step={100_000}
          onChange={(v) => setVotesAbstain(clampToSupply(v))}
          error={fieldErrors.votesAbstain}
        />
      </section>

      {/* ---- Real-time local result ---- */}
      <ResultBanner result={localResult} t={t} />

      {/* ---- API verification stub ---- */}
      <section style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          onClick={handleCallApi}
          disabled={apiLoading}
          aria-busy={apiLoading}
          style={{
            padding: "0.5rem 1.25rem",
            cursor: apiLoading ? "not-allowed" : "pointer",
            opacity: apiLoading ? 0.7 : 1,
          }}
        >
          {apiLoading
            ? t("simulate.verifying", "Verifying…")
            : t("simulate.verifyButton", "Verify via API")}
        </button>

        {apiError && (
          <p role="alert" style={{ color: "#721c24", marginTop: "0.5rem" }}>
            {t("simulate.apiError", "API error")}: {apiError}
          </p>
        )}

        {apiResult && (
          <div style={{ marginTop: "1rem" }}>
            <h3 style={{ margin: "0 0 0.25rem 0" }}>
              {t("simulate.apiResponse", "API response")}
            </h3>
            <ResultBanner result={apiResult} t={t} />
          </div>
        )}
      </section>
    </div>
  );
}
