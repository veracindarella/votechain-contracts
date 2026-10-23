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

export type ProposalState = 'Active' | 'Passed' | 'Rejected' | 'Executed' | 'Cancelled';

/**
 * Raw on-chain proposal struct as returned by the Stellar governance contract.
 * Used by the proposals page renderer (proposals.ts).
 */
export interface RawProposal {
  /** Numeric proposal ID from the contract */
  id: number;
  title: string;
  proposer: string;
  votes_yes: number;
  votes_no: number;
  votes_abstain: number;
  quorum: number;
  /** Unix timestamp (seconds) */
  start_time: number;
  /** Unix timestamp (seconds) */
  end_time: number;
  state: ProposalState;
  /** Unix timestamp (seconds); 0 if not applicable */
  execute_after: number;
}

export interface VoteRecord {
  address: string;
  type: 'For' | 'Against' | 'Abstain';
  weight: number;
  votedAt: string;
  /**
   * Optional off-chain comment reference (IPFS CID) the voter attached to
   * explain their rationale. Not validated on-chain — see issue #103.
   */
  commentHash?: string | null;
  /**
   * When this vote's weight was claimed on behalf of `address` by a delegate
   * (via `cast_vote_with_delegators`), this holds the delegate's address
   * that cast the vote. `null`/absent means `address` voted directly (#329).
   */
  viaDelegate?: string | null;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  /** Optional proposal categories used by the frontend tag filter. */
  tags?: string[];
  /** Address of the account that created the proposal. */
  proposer: string;
  state: ProposalState;
  createdAt: string;
  endAt: string;
  /** Minimum total vote weight required for the proposal to be finalisable. */
  quorum: number;
  votesCount: number;
  totalWeight: number;
  votes: VoteRecord[];
}
