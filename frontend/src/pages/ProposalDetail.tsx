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

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import QuorumProgressBar from "../components/QuorumProgressBar";
import { useProposals } from "../context/ProposalContext";
import { decodeFullDescriptionCid, fetchFromIpfs } from "../utils/ipfs";

/**
 * Renders a proposal's description, resolving the full text from IPFS when
 * the on-chain description carries a `fullDescriptionCid` marker (#331).
 * Falls back to the on-chain excerpt if the gateway is unreachable.
 */
function ProposalDescription({ description }: { description: string | undefined }) {
  const decoded = description ? decodeFullDescriptionCid(description) : null;
  const [fullText, setFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!decoded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFromIpfs(decoded.cid)
      .then((text) => {
        if (!cancelled) setFullText(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load full description from IPFS.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // decoded is derived from `description`; re-run only when the CID changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded?.cid]);

  if (!description) return null;
  if (!decoded) return <p className="proposal-description">{description}</p>;

  return (
    <div className="proposal-description" aria-live="polite">
      <p>{decoded.excerpt.trim()}</p>
      {loading && <p role="status">Loading full description from IPFS…</p>}
      {!loading && fullText && <p className="proposal-description-full">{fullText}</p>}
      {!loading && error && (
        <p role="alert" className="error-state">
          {error} (CID: {decoded.cid})
        </p>
      )}
    </div>
  );
}

export default function ProposalDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { proposals } = useProposals();
  const proposal = proposals?.find((p) => String(p.id) === id);

  return (
    <>
      <div>{t("proposal.title")}</div>
      <ProposalDescription description={proposal?.description} />
      {proposal && (
        <QuorumProgressBar totalVotes={proposal.totalWeight} quorum={proposal.quorum} />
      )}
      <a href={`/api/proposals/${id}/votes.csv`} download>
        Export Votes as CSV
      </a>
    </>
  );
}

