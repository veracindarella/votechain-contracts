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

import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { Signer } from "./signer.js";
import type {
  CastVoteParams,
  CreateProposalParams,
  InitializeParams,
  Proposal,
  ProposalState,
  TxResult,
  Vote,
  VoteRecord,
} from "./types.js";

/** Configuration required to talk to a deployed governance contract. */
export interface VoteChainClientConfig {
  /** Soroban RPC endpoint, e.g. "https://soroban-testnet.stellar.org". */
  rpcUrl: string;
  /** Network passphrase; use `Networks.TESTNET` / `Networks.PUBLIC` from `@stellar/stellar-sdk`. */
  networkPassphrase: string;
  /** Deployed governance contract ID (starts with "C"). */
  contractId: string;
  /** Base fee in stroops for submitted transactions. Defaults to "100". */
  baseFee?: string;
  /** Seconds to wait before a built transaction expires. Defaults to 30. */
  timeoutSeconds?: number;
}

const DEFAULT_BASE_FEE = "100";
const DEFAULT_TIMEOUT_SECONDS = 30;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

function voteToScVal(vote: Vote): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(vote)]);
}

function proposalStateFromScVal(state: unknown): ProposalState {
  // Soroban enum-without-payload values decode to a plain string tag via scValToNative.
  return String(state) as ProposalState;
}

function decodeProposal(native: Record<string, unknown>): Proposal {
  return {
    id: BigInt(native.id as string | number | bigint),
    proposer: native.proposer as string,
    title: native.title as string,
    description: native.description as string,
    votesYes: BigInt(native.votes_yes as string | number | bigint),
    votesNo: BigInt(native.votes_no as string | number | bigint),
    votesAbstain: BigInt(native.votes_abstain as string | number | bigint),
    quorum: BigInt(native.quorum as string | number | bigint),
    startTime: BigInt(native.start_time as string | number | bigint),
    endTime: BigInt(native.end_time as string | number | bigint),
    state: proposalStateFromScVal(native.state),
    executeAfter: BigInt(native.execute_after as string | number | bigint),
    supplySnapshot: BigInt(native.supply_snapshot as string | number | bigint),
  };
}

function decodeVoteRecord(native: Record<string, unknown>): VoteRecord {
  return {
    voteType: proposalStateFromScVal(native.vote_type) as Vote,
    weight: BigInt(native.weight as string | number | bigint),
    commentHash: (native.comment_hash as string | null | undefined) ?? null,
  };
}

/**
 * Typed client for the VoteChain governance Soroban contract.
 *
 * Wraps manual XDR construction and raw Horizon/Soroban-RPC calls behind
 * typed methods, so integrators do not need to hand-build `Contract.call`
 * invocations (see docs/examples/javascript.md for the pattern this
 * replaces).
 */
export class VoteChainClient {
  private readonly server: SorobanRpc.Server;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;
  private readonly baseFee: string;
  private readonly timeoutSeconds: number;

  constructor(config: VoteChainClientConfig) {
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.contract = new Contract(config.contractId);
    this.networkPassphrase = config.networkPassphrase;
    this.baseFee = config.baseFee ?? DEFAULT_BASE_FEE;
    this.timeoutSeconds = config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  }

  // ── internal helpers ─────────────────────────────────────────────────────

  private async buildAndSimulate(sourcePublicKey: string, operation: xdr.Operation) {
    const account = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(account, {
      fee: this.baseFee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(this.timeoutSeconds)
      .build();

    const simulated = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new Error(`VoteChain SDK: simulation failed: ${simulated.error}`);
    }
    return { tx, simulated };
  }

  /** Simulates a read-only call and decodes its return value. Does not sign or submit anything. */
  private async simulateRead<T>(
    sourcePublicKey: string,
    operation: xdr.Operation,
    decode: (native: unknown) => T
  ): Promise<T> {
    const { simulated } = await this.buildAndSimulate(sourcePublicKey, operation);
    if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
      throw new Error("VoteChain SDK: simulation returned no result");
    }
    return decode(scValToNative(simulated.result.retval));
  }

  /** Builds, simulates, signs, submits, and polls a state-changing call to completion. */
  private async invoke<T>(
    signer: Signer,
    operation: xdr.Operation,
    decode: (native: unknown) => T
  ): Promise<TxResult<T>> {
    const sourcePublicKey = await signer.publicKey();
    const { tx, simulated } = await this.buildAndSimulate(sourcePublicKey, operation);

    if (!SorobanRpc.Api.isSimulationSuccess(simulated)) {
      throw new Error("VoteChain SDK: simulation did not succeed");
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
    const signedXdr = await signer.signTransaction(prepared.toXDR(), this.networkPassphrase);
    const signedTx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);

    const sendResult = await this.server.sendTransaction(signedTx as never);
    if (sendResult.status === "ERROR") {
      throw new Error(`VoteChain SDK: submission failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    let response = await this.server.getTransaction(sendResult.hash);
    let attempts = 0;
    while (response.status === "NOT_FOUND" && attempts < MAX_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      response = await this.server.getTransaction(sendResult.hash);
      attempts += 1;
    }

    if (response.status !== "SUCCESS") {
      throw new Error(`VoteChain SDK: transaction did not succeed (status=${response.status})`);
    }

    const returnValue =
      "returnValue" in response && response.returnValue
        ? decode(scValToNative(response.returnValue))
        : (undefined as T);

    return { hash: sendResult.hash, value: returnValue };
  }

  // ── write calls ──────────────────────────────────────────────────────────

  /** Initialises the governance contract. Must be called exactly once by the intended admin. */
  async initialize(signer: Signer, params: InitializeParams): Promise<TxResult<void>> {
    const op = this.contract.call(
      "initialize",
      nativeToScVal(params.admin, { type: "address" }),
      nativeToScVal(params.votingToken, { type: "address" }),
      nativeToScVal(params.minProposalBalance, { type: "i128" }),
      nativeToScVal(params.proposalCooldown, { type: "u64" }),
      nativeToScVal(params.minDuration, { type: "u64" }),
      nativeToScVal(params.maxDuration, { type: "u64" }),
      nativeToScVal(params.restrictAdminVote, { type: "bool" }),
      nativeToScVal(params.timelockDuration, { type: "u64" }),
      nativeToScVal(params.maxActiveProposals, { type: "u64" })
    );
    return this.invoke(signer, op, () => undefined);
  }

  /**
   * Creates a new proposal and returns its assigned ID.
   *
   * If `params.fullDescriptionCid` is set (#331), the on-chain `description`
   * is stored as `description` plus a `\n\nipfs:<cid>` marker instead of the
   * raw text, so callers should keep `description` short enough that the
   * combined string stays within Soroban's 1024-byte string limit — the
   * full text lives on IPFS and is resolved client-side (see
   * `frontend/src/utils/ipfs.ts`'s `decodeFullDescriptionCid`).
   */
  async createProposal(signer: Signer, params: CreateProposalParams): Promise<TxResult<bigint>> {
    const SOROBAN_STRING_LIMIT = 1024;
    const onChainDescription = params.fullDescriptionCid
      ? `${params.description}\n\nipfs:${params.fullDescriptionCid.trim()}`
      : params.description;
    if (onChainDescription.length > SOROBAN_STRING_LIMIT) {
      throw new Error(
        `Proposal description (${onChainDescription.length} chars, including the IPFS CID marker if set) ` +
          `exceeds Soroban's ${SOROBAN_STRING_LIMIT}-char limit. Shorten the excerpt or rely solely on ` +
          `fullDescriptionCid for the long-form content.`
      );
    }
    const op = this.contract.call(
      "create_proposal",
      nativeToScVal(params.proposer, { type: "address" }),
      nativeToScVal(params.title, { type: "string" }),
      nativeToScVal(onChainDescription, { type: "string" }),
      nativeToScVal(params.quorum, { type: "i128" }),
      nativeToScVal(params.durationSeconds, { type: "u64" })
    );
    return this.invoke(signer, op, (native) => BigInt(native as string | number | bigint));
  }

  /** Casts a vote on an active proposal, optionally attaching an IPFS comment CID (issue #103). */
  async castVote(signer: Signer, params: CastVoteParams): Promise<TxResult<void>> {
    const commentVal = params.commentHash
      ? nativeToScVal(params.commentHash, { type: "string" })
      : xdr.ScVal.scvVoid();
    const op = this.contract.call(
      "cast_vote",
      nativeToScVal(params.voter, { type: "address" }),
      nativeToScVal(params.proposalId, { type: "u64" }),
      voteToScVal(params.vote),
      commentVal
    );
    return this.invoke(signer, op, () => undefined);
  }

  /** Finalises a proposal after its voting period has ended. Callable by anyone. */
  async finalise(signer: Signer, proposalId: bigint): Promise<TxResult<void>> {
    const op = this.contract.call("finalise", nativeToScVal(proposalId, { type: "u64" }));
    return this.invoke(signer, op, () => undefined);
  }

  /**
   * Delegates `delegator`'s voting power to `delegate` (#329).
   *
   * Passing `delegator` as `delegate` clears any existing delegation
   * (equivalent to calling {@link undelegate}). The contract rejects
   * delegations that would form a cycle with
   * `ContractError::CircularDelegation`.
   */
  async delegate(signer: Signer, delegator: string, delegate: string): Promise<TxResult<void>> {
    const op = this.contract.call(
      "delegate",
      nativeToScVal(delegator, { type: "address" }),
      nativeToScVal(delegate, { type: "address" })
    );
    return this.invoke(signer, op, () => undefined);
  }

  /** Revokes `delegator`'s delegation, restoring their direct voting rights (#329). */
  async undelegate(signer: Signer, delegator: string): Promise<TxResult<void>> {
    const op = this.contract.call("undelegate", nativeToScVal(delegator, { type: "address" }));
    return this.invoke(signer, op, () => undefined);
  }

  // ── read-only calls ──────────────────────────────────────────────────────

  /**
   * Returns `delegator`'s current delegate address. Addresses that have not
   * delegated are their own delegate (the contract defaults to self).
   */
  async getDelegate(readAs: string, delegator: string): Promise<string> {
    const op = this.contract.call("get_delegate", nativeToScVal(delegator, { type: "address" }));
    return this.simulateRead(readAs, op, (native) => native as string);
  }

  /** Returns the full proposal for `proposalId`. `readAs` may be any funded account used to simulate the read. */
  async getProposal(readAs: string, proposalId: bigint): Promise<Proposal> {
    const op = this.contract.call("get_proposal", nativeToScVal(proposalId, { type: "u64" }));
    return this.simulateRead(readAs, op, (native) => decodeProposal(native as Record<string, unknown>));
  }

  /** Lists proposals with pagination. */
  async listProposals(readAs: string, offset: bigint, limit: bigint): Promise<Proposal[]> {
    const op = this.contract.call(
      "list_proposals",
      nativeToScVal(offset, { type: "u64" }),
      nativeToScVal(limit, { type: "u64" })
    );
    return this.simulateRead(readAs, op, (native) =>
      (native as Record<string, unknown>[]).map(decodeProposal)
    );
  }

  /** Returns true if `voter` has already voted on `proposalId`. */
  async hasVoted(readAs: string, proposalId: bigint, voter: string): Promise<boolean> {
    const op = this.contract.call(
      "has_voted",
      nativeToScVal(proposalId, { type: "u64" }),
      nativeToScVal(voter, { type: "address" })
    );
    return this.simulateRead(readAs, op, (native) => Boolean(native));
  }

  /** Returns the vote record for `voter` on `proposalId`, or `null` if they have not voted. */
  async getVote(readAs: string, proposalId: bigint, voter: string): Promise<VoteRecord | null> {
    const op = this.contract.call(
      "get_vote",
      nativeToScVal(proposalId, { type: "u64" }),
      nativeToScVal(voter, { type: "address" })
    );
    return this.simulateRead(readAs, op, (native) =>
      native == null ? null : decodeVoteRecord(native as Record<string, unknown>)
    );
  }
}

export { Networks };
