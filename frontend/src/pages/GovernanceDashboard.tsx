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

import React, { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type ProposalState = "Active" | "Passed" | "Rejected" | "Executed" | "Cancelled";

type VoterStat = { address: string; total_weight: number };

type Stats = {
  byState: Record<ProposalState, number>;
  participationOverTime: { date: string; rate: number }[];
  topVoters: VoterStat[];
  avgQuorumAchievement: number;
  /** unique voters / total token holders, per proposal id (issue #104) */
  participationRateByProposal: Record<string, number>;
  /** passed / finalised proposals, rolling 30 days (issue #104) */
  passRate: number;
  /** average(total_votes / quorum) across all proposals (issue #104) */
  avgQuorumFillRate: number;
  /** addresses that voted on > 50% of proposals (issue #104) */
  voterRetention: string[];
};

/** Shape returned by GET /api/governance/analytics (backend/src/routes/analytics.ts). */
interface GovernanceAnalyticsResponse {
  participation_rate: Record<string, number>;
  pass_rate: number;
  avg_quorum_fill_rate: number;
  voter_retention: string[];
  by_state: Record<ProposalState, number>;
  computed_at: string;
}

// ── Real data fetcher (issue #104) ──────────────────────────────────────────

async function fetchStats(): Promise<Stats> {
  const res = await fetch("/api/governance/analytics");
  if (!res.ok) {
    throw new Error(`Failed to fetch governance analytics: ${res.status}`);
  }
  const analytics: GovernanceAnalyticsResponse = await res.json();

  return {
    byState: analytics.by_state,
    participationOverTime: Object.entries(analytics.participation_rate).map(
      ([proposalId, rate]) => ({ date: proposalId, rate: Math.round(rate * 100) })
    ),
    topVoters: analytics.voter_retention.map((address) => ({ address, total_weight: 0 })),
    avgQuorumAchievement: Math.round(analytics.avg_quorum_fill_rate * 100),
    participationRateByProposal: analytics.participation_rate,
    passRate: analytics.pass_rate,
    avgQuorumFillRate: analytics.avg_quorum_fill_rate,
    voterRetention: analytics.voter_retention,
  };
}

// ── Minimal SVG pie chart ──────────────────────────────────────────────────

const PIE_COLORS: Record<ProposalState, string> = {
  Active: "#42a5f5",
  Passed: "#66bb6a",
  Rejected: "#ef5350",
  Executed: "#26c6da",
  Cancelled: "#bdbdbd",
};

function PieChart({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return <p>No data</p>;

  let cumAngle = 0;
  const slices = Object.entries(data).map(([label, value]) => {
    const angle = (value / total) * 360;
    const start = cumAngle;
    cumAngle += angle;
    return { label, value, angle, start };
  });

  function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const cx = 80, cy = 80, r = 70;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={160} height={160} aria-label="Proposals by state pie chart" role="img">
        {slices.map(({ label, angle, start }) => {
          if (angle === 0) return null;
          const s = polarToXY(cx, cy, r, start);
          const e = polarToXY(cx, cy, r, start + angle);
          const large = angle > 180 ? 1 : 0;
          const d = `M${cx},${cy} L${s.x},${s.y} A${r},${r} 0 ${large},1 ${e.x},${e.y} Z`;
          return (
            <path
              key={label}
              d={d}
              fill={PIE_COLORS[label as ProposalState] ?? "#888"}
              stroke="#fff"
              strokeWidth={1}
            >
              <title>{label}</title>
            </path>
          );
        })}
      </svg>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
        {slices.map(({ label, value }) => (
          <li key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span
              style={{
                width: 12, height: 12, borderRadius: 2,
                background: PIE_COLORS[label as ProposalState] ?? "#888",
                display: "inline-block",
              }}
            />
            {label}: <strong>{value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Minimal SVG line chart ─────────────────────────────────────────────────

function LineChart({ data }: { data: { date: string; rate: number }[] }) {
  if (data.length === 0) return <p>No data</p>;
  const W = 320, H = 120, PAD = 24;
  const maxRate = Math.max(...data.map((d) => d.rate), 100);
  const xStep = (W - PAD * 2) / (data.length - 1 || 1);

  const points = data.map((d, i) => ({
    x: PAD + i * xStep,
    y: H - PAD - ((d.rate / maxRate) * (H - PAD * 2)),
    label: d.date,
    rate: d.rate,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={W} height={H} aria-label="Voter participation rate over time" role="img">
      <polyline points={polyline} fill="none" stroke="#42a5f5" strokeWidth={2} />
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={4} fill="#42a5f5" />
          <text x={p.x} y={H - 4} textAnchor="middle" fontSize={10} fill="#aaa">
            {p.label}
          </text>
          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={10} fill="#fff">
            {p.rate}%
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Stat tile (issue #104 metrics) ──────────────────────────────────────────

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#66bb6a" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Dashboard page ─────────────────────────────────────────────────────────

// Issue #104: dashboard data must refresh every 60 seconds.
const REFRESH_MS = 60 * 1000;

export function GovernanceDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchStats();
      setStats(data);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (loading && !stats) {
    return (
      <main style={{ padding: 24, fontFamily: "sans-serif", color: "#e0e0e0", background: "#121212", minHeight: "100vh" }}>
        <h1 style={{ marginBottom: 24 }}>Governance Dashboard</h1>
        <div
          aria-busy="true"
          aria-label="Loading governance statistics"
          aria-live="polite"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} style={cardStyle}>
              <div className="skeleton-block" style={{ width: "45%", height: 12, marginBottom: 12 }} />
              <div className="skeleton-block" style={{ width: "75%", height: 36 }} />
            </div>
          ))}
        </div>
      </main>
    );
  }
  if (!stats) return <p>Failed to load statistics.</p>;

  const totalProposals = Object.values(stats.byState).reduce((a, b) => a + b, 0);

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", color: "#e0e0e0", background: "#121212", minHeight: "100vh" }}>
      <h1 style={{ marginBottom: 4 }}>Governance Dashboard</h1>
      {lastUpdated && (
        <p style={{ fontSize: 12, color: "#888", marginBottom: 24 }}>
          Last updated: {lastUpdated.toLocaleTimeString()} · refreshes every 60s
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatTile label="30-day pass rate" value={`${Math.round(stats.passRate * 100)}%`} />
        <StatTile label="Retained voters (>50% of proposals)" value={String(stats.voterRetention.length)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>

        {/* Proposals by state */}
        <section aria-labelledby="pie-heading" style={cardStyle}>
          <h2 id="pie-heading" style={h2Style}>Proposals by State</h2>
          <p style={{ fontSize: 13, color: "#aaa" }}>Total: {totalProposals}</p>
          <PieChart data={stats.byState} />
        </section>

        {/* Participation over time */}
        <section aria-labelledby="line-heading" style={cardStyle}>
          <h2 id="line-heading" style={h2Style}>Participation Rate Over Time</h2>
          <LineChart data={stats.participationOverTime} />
        </section>

        {/* Avg quorum achievement */}
        <section aria-labelledby="quorum-heading" style={cardStyle}>
          <h2 id="quorum-heading" style={h2Style}>Avg Quorum Achievement</h2>
          <div style={{ fontSize: 48, fontWeight: 700, color: "#66bb6a" }}>
            {stats.avgQuorumAchievement}%
          </div>
          <p style={{ fontSize: 13, color: "#aaa" }}>
            Average across all finalized proposals
          </p>
        </section>

        {/* Top 10 voters */}
        <section aria-labelledby="voters-heading" style={{ ...cardStyle, gridColumn: "1 / -1" }}>
          <h2 id="voters-heading" style={h2Style}>Top 10 Voters by Vote Weight</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Address</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Total Weight</th>
              </tr>
            </thead>
            <tbody>
              {stats.topVoters.map((v, i) => (
                <tr key={v.address} style={{ borderBottom: "1px solid #222" }}>
                  <td style={tdStyle}>{i + 1}</td>
                  <td style={tdStyle}>{v.address}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {v.total_weight.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#1e1e1e",
  borderRadius: 8,
  padding: 20,
  border: "1px solid #333",
};
const h2Style: React.CSSProperties = { fontSize: 16, marginBottom: 12, color: "#fff" };
const thStyle: React.CSSProperties = { padding: "6px 8px", textAlign: "left", color: "#aaa" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", color: "#e0e0e0" };
