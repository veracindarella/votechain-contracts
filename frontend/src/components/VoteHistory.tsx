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

import { useMemo, useState } from 'react';
import type { Proposal, ProposalState, VoteRecord } from '../types';
import { generateCsv } from '../utils/csv';
import { isValidStellarAddress, isStellarAddressEmpty } from '../utils/stellarAddress';
import { hasComment, ipfsGatewayUrl } from '../utils/ipfs';

interface Props {
  proposals: Proposal[];
}

type StateFilter = 'All' | ProposalState;

function statusClass(state: ProposalState) {
  return `status-chip status-${state.toLowerCase()}`;
}

function ariaLabelForVoteType(type: VoteRecord['type']) {
  return `${type} vote`;
}

export default function VoteHistory({ proposals }: Props) {
  const [address, setAddress] = useState('');
  const [fromDate, setFromDate] = useState('2025-01-01');
  const [toDate, setToDate] = useState('2026-12-31');
  const [stateFilter, setStateFilter] = useState<StateFilter>('All');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  // Derive validation state (issue #17)
  const addressEmpty   = isStellarAddressEmpty(address);
  const addressValid   = !addressEmpty && isValidStellarAddress(address.trim());
  const addressInvalid = !addressEmpty && !addressValid;

  const votes = useMemo(() => {
    // Only filter when address is valid
    if (!addressValid) return [];
    const normalizedAddress = address.trim().toLowerCase();
    const matched: Array<{ proposal: Proposal; vote: VoteRecord }> = [];
    proposals.forEach((proposal) => {
      if (stateFilter !== 'All' && proposal.state !== stateFilter) return;
      proposal.votes.forEach((vote) => {
        if (vote.address.toLowerCase().includes(normalizedAddress)) {
          if (vote.votedAt >= fromDate && vote.votedAt <= toDate) {
            matched.push({ proposal, vote });
          }
        }
      });
    });
    return matched;
  }, [address, addressValid, proposals, fromDate, toDate, stateFilter]);

  const exportVotes = async () => {
    setIsExporting(true);
    setExportError('');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const csv = generateCsv(votes.map((item) => item.vote));
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `vote-history-${address.replace(/\W/g, '_') || 'unknown'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setExportError('CSV export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  /** Determine what to show in the table body */
  function renderTableBody() {
    if (addressEmpty) {
      return (
        <tr>
          <td colSpan={6}>Enter a Stellar address above to view vote history.</td>
        </tr>
      );
    }
    if (addressInvalid) {
      // Invalid address — table is hidden via disabled search; this is a fallback.
      return null;
    }
    if (votes.length === 0) {
      return (
        <tr>
          {/* Distinct "no votes found" message — not the same as invalid-address case (#17) */}
          <td colSpan={6}>No votes found for this address in the selected range.</td>
        </tr>
      );
    }
    return votes.map(({ proposal, vote }, index) => (
      <tr key={`${proposal.id}-${index}`}>
        <td>{proposal.title}</td>
        <td aria-label={ariaLabelForVoteType(vote.type)}>
          {vote.type}
          {/* #329: flag votes claimed on this address's behalf by a delegate. */}
          {vote.viaDelegate && (
            <span
              className="delegation-badge"
              title={`Cast by delegate ${vote.viaDelegate}`}
              aria-label={`Vote cast via delegate ${vote.viaDelegate}`}
            >
              {" "}
              (via delegate)
            </span>
          )}
        </td>
        <td>{vote.weight}</td>
        <td>
          <span className={statusClass(proposal.state)}>{proposal.state}</span>
        </td>
        <td>{vote.votedAt}</td>
        <td>
          {/* issue #103: render a link to the off-chain comment when a CID was attached. */}
          {hasComment(vote.commentHash) ? (
            <a
              href={ipfsGatewayUrl(vote.commentHash)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View voter's comment for ${proposal.title}`}
            >
              View comment
            </a>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </td>
      </tr>
    ));
  }

  return (
    <section aria-labelledby="vote-history-heading" className="card">
      <div className="header">
        <div>
          <h2 id="vote-history-heading">Wallet vote history</h2>
          <p>View votes cast by any public address without a wallet connection.</p>
        </div>
        <button
          type="button"
          onClick={exportVotes}
          disabled={votes.length === 0 || isExporting}
          aria-disabled={votes.length === 0 || isExporting}
        >
          {isExporting ? (
            <>
              <progress aria-label="Exporting CSV" />
              Exporting...
            </>
          ) : (
            'Export CSV'
          )}
        </button>
        {exportError && <div role="alert" className="field-error">{exportError}</div>}
      </div>
      <form className="grid" onSubmit={(event) => event.preventDefault()}>
        <label>
          Wallet address
          <input
            type="text"
            value={address}
            placeholder="Enter public address (starts with G, 56 characters)"
            onChange={(event) => setAddress(event.target.value)}
            aria-describedby="address-help address-error"
            aria-invalid={addressInvalid || undefined}
          />
          {/* Inline validation error (issue #17) */}
          {addressInvalid && (
            <span id="address-error" role="alert" className="field-error">
              Invalid address — must start with G, be 56 characters, and use base32 encoding.
            </span>
          )}
        </label>
        <div id="address-help" className="visually-hidden">
          Enter a Stellar public wallet address to view read-only vote history.
        </div>
        <label>
          From
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            disabled={addressInvalid}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            disabled={addressInvalid}
          />
        </label>
        <label>
          Proposal state
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value as StateFilter)}
            disabled={addressInvalid}
          >
            <option value="All">All</option>
            <option value="Active">Active</option>
            <option value="Passed">Passed</option>
            <option value="Rejected">Rejected</option>
            <option value="Executed">Executed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </label>
      </form>
      {/* Hide table entirely when address is invalid (issue #17 — disable search) */}
      {!addressInvalid && (
        <div className="table-wrapper" aria-live="polite">
          <table>
            <caption className="visually-hidden">Vote history for the selected address</caption>
            <thead>
              <tr>
                <th scope="col">Proposal</th>
                <th scope="col">Vote</th>
                <th scope="col">Weight</th>
                <th scope="col">State</th>
                <th scope="col">Voted At</th>
                <th scope="col">Comment</th>
              </tr>
            </thead>
            <tbody>{renderTableBody()}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
