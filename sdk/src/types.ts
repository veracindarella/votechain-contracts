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
 * Typed mirrors of the governance contract's on-chain types
 * (contracts/governance/src/types.rs). Kept in sync manually — there is no
 * codegen step yet, so any change to the contract's public types must be
 * reflected here too.
 */

/** Mirrors `types::Vote`. */
export type Vote = "Yes" | "No" | "Abstain";

/** Mirrors `types::ProposalState`. */
export type ProposalState = "Active" | "Passed" | "Rejected" | "Executed" | "Cancelled";

/** Mirrors `types::Proposal`. Numeric fields that are `i128`/`u64` on-chain are returned as `bigint`. */
export interface Proposal {
  id: bigint;
  proposer: string;
  title: string;
  description: string;
  votesYes: bigint;
  votesNo: bigint;
  votesAbstain: bigint;
  quorum: bigint;
  startTime: bigint;
  endTime: bigint;
  state: ProposalState;
  executeAfter: bigint;
  supplySnapshot: bigint;
}

/** Mirrors `types::VoteRecord`. */
export interface VoteRecord {
  voteType: Vote;
  weight: bigint;
  /** Optional off-chain comment reference (e.g. an IPFS CID). See issue #103. */
  commentHash: string | null;
}

/** Parameters accepted by {@link VoteChainClient.initialize}. */
export interface InitializeParams {
  admin: string;
  votingToken: string;
  minProposalBalance: bigint;
  proposalCooldown: bigint;
  minDuration: bigint;
  maxDuration: bigint;
  restrictAdminVote: boolean;
  timelockDuration: bigint;
  maxActiveProposals: bigint;
}

/** Parameters accepted by {@link VoteChainClient.createProposal}. */
export interface CreateProposalParams {
  proposer: string;
  title: string;
  description: string;
  quorum: bigint;
  durationSeconds: bigint;
  /**
   * Optional IPFS CID holding the full proposal description (#331).
   *
   * Soroban limits on-chain strings to 1024 bytes, so when this is set the
   * SDK stores `description` as a short on-chain excerpt followed by a
   * `\n\nipfs:<cid>` marker instead of the full text; integrators render the
   * complete content by fetching this CID off-chain (see
   * `frontend/src/utils/ipfs.ts`'s `fetchFromIpfs`/`decodeFullDescriptionCid`).
   */
  fullDescriptionCid?: string;
}

/** Parameters accepted by {@link VoteChainClient.castVote}. */
export interface CastVoteParams {
  voter: string;
  proposalId: bigint;
  vote: Vote;
  /** Optional IPFS CID (max 64 bytes) explaining the voter's rationale. */
  commentHash?: string;
}

/** Result of a state-changing SDK call: the submitted transaction's hash and the decoded return value, if any. */
export interface TxResult<T> {
  hash: string;
  value: T;
}
