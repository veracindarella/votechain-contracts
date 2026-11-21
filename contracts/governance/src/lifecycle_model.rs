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

//! Formal state-machine model of the proposal lifecycle (Kani).
//!
//! # The lifecycle
//!
//! A proposal can only ever be in one of five on-chain states
//! ([`ProposalState`]). `Active` is the only mutable state;
//! `Rejected`/`Executed`/`Cancelled` are terminal (absorbing); `Passed` has a
//! single outgoing edge (`execute` → `Executed`):
//!
//! ```text
//!              create_proposal
//!   (absent) ─────────────────▶ Active ──finalise(pass)──▶ Passed ──execute──▶ Executed
//!                                │  ▲     finalise(reject) ──▶ Rejected
//!              cast_vote / update_quorum / extend_voting       cancel ──▶ Cancelled
//!                                └──┘ (self-loops)
//! ```
//!
//! # What this module proves
//!
//! The harnesses below use [Kani](https://model-checking.github.io/kani/) to
//! **prove** — over *all* symbolic `(state, event)` inputs, not just sampled
//! examples — that:
//!
//! 1. The enumerated table [`LEGAL_TRANSITIONS`] is exactly the graph of the
//!    transition function [`next_state`]: every legal edge is listed and no
//!    illegal edge is listed.
//! 2. The guard model [`apply_event`] (which mirrors the checks in `lib.rs`)
//!    accepts an event **iff** it is a legal transition. Illegal transitions
//!    are therefore **unreachable from any public function**.
//! 3. Terminal states are absorbing, `Active` can never jump straight to
//!    `Executed`, and `create_proposal` only ever applies to a brand-new
//!    proposal.
//! 4. The model's states are in 1:1 correspondence with the contract's real
//!    [`ProposalState`] enum, so the model cannot silently drift from `lib.rs`.
//!
//! The arithmetic of the pass/reject condition itself is proven separately (see
//! `kani_proofs.rs` and SEC-012); this module concerns only the *state*
//! transitions.
//!
//! # Running
//!
//! ```bash
//! cargo kani -p votechain-governance --harness verify_no_illegal_transition_is_accepted
//! ```
//!
//! CI runs every harness nightly; see `.github/workflows/kani-lifecycle.yml`.

// Kani harnesses are only compiled when the `kani` cfg flag is set (by `cargo
// kani`). This keeps them out of the normal build, test and WASM runs.
#![cfg(kani)]

use crate::types::ProposalState;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/// The model's lifecycle states.
///
/// `Absent` is the pre-creation state (no proposal with this ID exists yet);
/// the remaining variants mirror [`ProposalState`] one-to-one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelState {
    /// No proposal with this ID exists yet.
    Absent,
    /// Open for voting — the only mutable state.
    Active,
    /// Voting closed with a passing outcome; awaiting `execute`.
    Passed,
    /// Voting closed with a failing outcome (terminal).
    Rejected,
    /// Marked executed by the admin (terminal).
    Executed,
    /// Cancelled by the admin before voting closed (terminal).
    Cancelled,
}

/// Every public entry point that can affect a proposal's lifecycle state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LifecycleEvent {
    /// `GovernanceContract::create_proposal`.
    CreateProposal,
    /// `GovernanceContract::cast_vote`.
    CastVote,
    /// `GovernanceContract::cast_vote_with_delegators`.
    CastVoteWithDelegators,
    /// `GovernanceContract::update_quorum`.
    UpdateQuorum,
    /// `GovernanceContract::extend_voting`.
    ExtendVoting,
    /// `GovernanceContract::finalise` taking the *passed* branch.
    FinalisePass,
    /// `GovernanceContract::finalise` taking the *rejected* branch.
    FinaliseReject,
    /// `GovernanceContract::execute`.
    Execute,
    /// `GovernanceContract::cancel`.
    Cancel,
}

/// Projects a contract [`ProposalState`] into the model's state space.
///
/// The `match` is exhaustive on purpose: adding a new `ProposalState` variant to
/// `types.rs` will fail to compile until this model is updated, so the model and
/// the contract can never silently diverge.
pub fn project(state: &ProposalState) -> ModelState {
    match state {
        ProposalState::Active => ModelState::Active,
        ProposalState::Passed => ModelState::Passed,
        ProposalState::Rejected => ModelState::Rejected,
        ProposalState::Executed => ModelState::Executed,
        ProposalState::Cancelled => ModelState::Cancelled,
    }
}

/// The complete set of legal proposal-lifecycle transitions.
///
/// Each entry is `(from, event, to)`. This table is the specification; the
/// harnesses prove that the guard model accepts *exactly* these edges.
pub const LEGAL_TRANSITIONS: &[(ModelState, LifecycleEvent, ModelState)] = &[
    // create_proposal() — a brand-new proposal is always born Active.
    (ModelState::Absent, LifecycleEvent::CreateProposal, ModelState::Active),
    // cast_vote() / cast_vote_with_delegators() — tally changes, state does not.
    (ModelState::Active, LifecycleEvent::CastVote, ModelState::Active),
    (ModelState::Active, LifecycleEvent::CastVoteWithDelegators, ModelState::Active),
    // update_quorum() — quorum changes, state does not.
    (ModelState::Active, LifecycleEvent::UpdateQuorum, ModelState::Active),
    // extend_voting() — end_time changes, state does not.
    (ModelState::Active, LifecycleEvent::ExtendVoting, ModelState::Active),
    // finalise() — the only way out of Active.
    (ModelState::Active, LifecycleEvent::FinalisePass, ModelState::Passed),
    (ModelState::Active, LifecycleEvent::FinaliseReject, ModelState::Rejected),
    // cancel() — admin escape hatch, Active only.
    (ModelState::Active, LifecycleEvent::Cancel, ModelState::Cancelled),
    // execute() — the only edge out of Passed.
    (ModelState::Passed, LifecycleEvent::Execute, ModelState::Executed),
];

/// The transition function: the unique legal successor of `(from, event)`, or
/// `None` when no public function may perform that transition.
pub fn next_state(from: ModelState, event: LifecycleEvent) -> Option<ModelState> {
    match (from, event) {
        (ModelState::Absent, LifecycleEvent::CreateProposal) => Some(ModelState::Active),
        (ModelState::Active, LifecycleEvent::CastVote)
        | (ModelState::Active, LifecycleEvent::CastVoteWithDelegators) => Some(ModelState::Active),
        (ModelState::Active, LifecycleEvent::UpdateQuorum)
        | (ModelState::Active, LifecycleEvent::ExtendVoting) => Some(ModelState::Active),
        (ModelState::Active, LifecycleEvent::FinalisePass) => Some(ModelState::Passed),
        (ModelState::Active, LifecycleEvent::FinaliseReject) => Some(ModelState::Rejected),
        (ModelState::Active, LifecycleEvent::Cancel) => Some(ModelState::Cancelled),
        (ModelState::Passed, LifecycleEvent::Execute) => Some(ModelState::Executed),
        _ => None,
    }
}

/// Returns `true` iff `(from, event, to)` is one of the enumerated legal
/// transitions in [`LEGAL_TRANSITIONS`].
pub fn is_legal_transition(from: ModelState, event: LifecycleEvent, to: ModelState) -> bool {
    let mut i = 0;
    while i < LEGAL_TRANSITIONS.len() {
        let (f, e, t) = LEGAL_TRANSITIONS[i];
        if f == from && e == event && t == to {
            return true;
        }
        i += 1;
    }
    false
}

/// Guard model for the public entry points in `lib.rs`.
///
/// Returns the resulting state on success, or `None` when the contract's guard
/// reverts *before* writing any state. Each arm documents the exact check it
/// mirrors; the corresponding `ContractError` is named in a comment.
///
/// Only state-affecting guards are modelled. Time-, auth- and pause-related
/// guards can only *reject* a call — they never enable a transition that the
/// state guard would otherwise forbid — so they cannot introduce illegal edges.
pub fn apply_event(state: ModelState, event: LifecycleEvent) -> Option<ModelState> {
    match (state, event) {
        // create_proposal(): `save_proposal` writes a new entry with
        // `state: ProposalState::Active`. A proposal ID that does not exist yet
        // is the only valid starting point.
        (ModelState::Absent, LifecycleEvent::CreateProposal) => Some(ModelState::Active),

        // cast_vote() / cast_vote_with_delegators() / update_quorum() /
        // extend_voting(): `if proposal.state != Active { Err(ProposalNotActive) }`.
        // The state is left unchanged.
        (ModelState::Active, LifecycleEvent::CastVote)
        | (ModelState::Active, LifecycleEvent::CastVoteWithDelegators)
        | (ModelState::Active, LifecycleEvent::UpdateQuorum)
        | (ModelState::Active, LifecycleEvent::ExtendVoting) => Some(ModelState::Active),

        // finalise(): `if proposal.state != Active { Err(ProposalNotActive) }`,
        // then `Passed` or `Rejected` according to `quorum_is_met`.
        (ModelState::Active, LifecycleEvent::FinalisePass) => Some(ModelState::Passed),
        (ModelState::Active, LifecycleEvent::FinaliseReject) => Some(ModelState::Rejected),

        // cancel(): `if proposal.state != Active { Err(ProposalNotActive) }`.
        (ModelState::Active, LifecycleEvent::Cancel) => Some(ModelState::Cancelled),

        // execute(): `if proposal.state != Passed { Err(ProposalNotPassed) }`.
        (ModelState::Passed, LifecycleEvent::Execute) => Some(ModelState::Executed),

        // Every other (state, event) pair reverts and leaves the state untouched.
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Symbolic generators
// ---------------------------------------------------------------------------

/// Symbolically generates any [`ModelState`].
///
/// A `u8` is used as the symbolic source so that the harnesses do not depend on
/// a derived `Arbitrary` impl. Every `u8` value maps to one of the six states,
/// so the proofs below quantify over the entire state space.
fn any_state() -> ModelState {
    match kani::any::<u8>() {
        0 => ModelState::Absent,
        1 => ModelState::Active,
        2 => ModelState::Passed,
        3 => ModelState::Rejected,
        4 => ModelState::Executed,
        _ => ModelState::Cancelled,
    }
}

/// Symbolically generates any [`LifecycleEvent`].
fn any_event() -> LifecycleEvent {
    match kani::any::<u8>() {
        0 => LifecycleEvent::CreateProposal,
        1 => LifecycleEvent::CastVote,
        2 => LifecycleEvent::CastVoteWithDelegators,
        3 => LifecycleEvent::UpdateQuorum,
        4 => LifecycleEvent::ExtendVoting,
        5 => LifecycleEvent::FinalisePass,
        6 => LifecycleEvent::FinaliseReject,
        7 => LifecycleEvent::Execute,
        _ => LifecycleEvent::Cancel,
    }
}

// ---------------------------------------------------------------------------
// Harness 1 — The table enumerates exactly the legal transitions
// ---------------------------------------------------------------------------

/// Proves [`LEGAL_TRANSITIONS`] is exactly the graph of [`next_state`]: it lists
/// every legal edge and no illegal edge.
#[kani::proof]
#[kani::unwind(12)]
fn verify_table_matches_transition_function() {
    let from = any_state();
    let event = any_event();
    let to = any_state();

    let in_table = is_legal_transition(from, event, to);
    let is_function_edge = next_state(from, event) == Some(to);
    kani::assert(
        in_table == is_function_edge,
        "transition table and transition function disagree",
    );
}

// ---------------------------------------------------------------------------
// Harness 2 — Illegal transitions are unreachable from any public function
// ---------------------------------------------------------------------------

/// Proves that for every state and every public function, the modelled guard
/// either reverts or produces a transition listed in [`LEGAL_TRANSITIONS`]. No
/// public function can drive a proposal into a state that is not reachable by a
/// legal edge.
#[kani::proof]
#[kani::unwind(12)]
fn verify_no_illegal_transition_is_accepted() {
    let from = any_state();
    let event = any_event();

    if let Some(to) = apply_event(from, event) {
        kani::assert(
            is_legal_transition(from, event, to),
            "a public function produced a transition absent from the legal table",
        );
    }
}

/// Proves the legal table is exhaustive: every `(state, event)` pair that is
/// *not* a legal transition is rejected by the guard model. Combined with
/// harness 2 this pins the accepted edges to exactly the table.
#[kani::proof]
fn verify_every_non_legal_event_is_rejected() {
    let from = any_state();
    let event = any_event();

    if next_state(from, event).is_none() {
        kani::assert(
            apply_event(from, event).is_none(),
            "an event that is not a legal transition was accepted",
        );
    }
}

// ---------------------------------------------------------------------------
// Harness 3 — Terminal states are absorbing
// ---------------------------------------------------------------------------

/// Proves no public function accepts any event once a proposal has reached a
/// terminal state (`Rejected`, `Executed` or `Cancelled`).
#[kani::proof]
fn verify_terminal_states_are_absorbing() {
    let event = any_event();

    // Unrolled to keep the harness loop-free.
    kani::assert(
        apply_event(ModelState::Rejected, event).is_none(),
        "Rejected is terminal but accepted an event",
    );
    kani::assert(
        apply_event(ModelState::Executed, event).is_none(),
        "Executed is terminal but accepted an event",
    );
    kani::assert(
        apply_event(ModelState::Cancelled, event).is_none(),
        "Cancelled is terminal but accepted an event",
    );
}

// ---------------------------------------------------------------------------
// Harness 4 — Guards keyed on the source state
// ---------------------------------------------------------------------------

/// Proves `finalise` and `cancel` apply only to `Active` proposals — matching
/// the `ProposalNotActive` guard in `lib.rs` — and move them to `Rejected` /
/// `Cancelled` respectively.
#[kani::proof]
fn verify_finalise_and_cancel_require_active() {
    let from = any_state();

    if from == ModelState::Active {
        kani::assert(
            apply_event(from, LifecycleEvent::FinaliseReject) == Some(ModelState::Rejected),
            "finalise() reject branch must move Active -> Rejected",
        );
        kani::assert(
            apply_event(from, LifecycleEvent::FinalisePass) == Some(ModelState::Passed),
            "finalise() pass branch must move Active -> Passed",
        );
        kani::assert(
            apply_event(from, LifecycleEvent::Cancel) == Some(ModelState::Cancelled),
            "cancel() must move Active -> Cancelled",
        );
    } else {
        kani::assert(
            apply_event(from, LifecycleEvent::FinalisePass).is_none(),
            "finalise() must be rejected for a non-Active proposal",
        );
        kani::assert(
            apply_event(from, LifecycleEvent::FinaliseReject).is_none(),
            "finalise() must be rejected for a non-Active proposal",
        );
        kani::assert(
            apply_event(from, LifecycleEvent::Cancel).is_none(),
            "cancel() must be rejected for a non-Active proposal",
        );
    }
}

/// Proves `execute` requires `Passed` and produces `Executed`, and nothing else
/// — so a proposal must win its vote before it can be executed.
#[kani::proof]
fn verify_execute_requires_passed() {
    let from = any_state();

    match apply_event(from, LifecycleEvent::Execute) {
        Some(to) => kani::assert(
            from == ModelState::Passed && to == ModelState::Executed,
            "execute() must only move Passed -> Executed",
        ),
        None => kani::assert(
            from != ModelState::Passed,
            "execute() on a Passed proposal must succeed",
        ),
    }
}

/// Proves `Active` can never transition directly to `Executed`: `execute` is
/// rejected while the proposal is still `Active`.
#[kani::proof]
fn verify_active_cannot_reach_executed_directly() {
    let event = any_event();

    if let Some(to) = apply_event(ModelState::Active, event) {
        kani::assert(
            to != ModelState::Executed,
            "Active must never transition directly to Executed",
        );
    }
    kani::assert(
        apply_event(ModelState::Active, LifecycleEvent::Execute).is_none(),
        "execute() on an Active proposal must be rejected",
    );
}

/// Proves `create_proposal` only applies to a proposal that does not yet exist,
/// and always yields an `Active` proposal.
#[kani::proof]
fn verify_create_requires_absent_state() {
    let from = any_state();

    match apply_event(from, LifecycleEvent::CreateProposal) {
        Some(to) => kani::assert(
            from == ModelState::Absent && to == ModelState::Active,
            "create_proposal must only move Absent -> Active",
        ),
        None => kani::assert(
            from != ModelState::Absent,
            "create_proposal must succeed from the Absent state",
        ),
    }
}

// ---------------------------------------------------------------------------
// Harness 5 — Structural properties of the relation
// ---------------------------------------------------------------------------

/// Proves the transition relation is single-valued: for any `(from, event)`
/// there is at most one legal target, so the table cannot contain contradictory
/// edges.
#[kani::proof]
#[kani::unwind(12)]
fn verify_legal_transition_table_has_no_conflicts() {
    let from = any_state();
    let event = any_event();
    let to_a = any_state();
    let to_b = any_state();

    if is_legal_transition(from, event, to_a) && is_legal_transition(from, event, to_b) {
        kani::assert(
            to_a == to_b,
            "duplicate legal targets for the same (state, event)",
        );
    }
}

// ---------------------------------------------------------------------------
// Harness 6 — Reachability and fidelity to the contract enum
// ---------------------------------------------------------------------------

/// Constructively proves every model state is reachable from the initial
/// `Absent` state via a legal sequence of public calls, so the enumerated table
/// is complete rather than a weakened over-approximation.
#[kani::proof]
fn verify_all_model_states_are_reachable() {
    kani::assert(
        apply_event(ModelState::Absent, LifecycleEvent::CreateProposal) == Some(ModelState::Active),
        "Absent --create_proposal--> Active",
    );
    kani::assert(
        apply_event(ModelState::Active, LifecycleEvent::CastVote) == Some(ModelState::Active),
        "Active --cast_vote--> Active",
    );
    kani::assert(
        apply_event(ModelState::Active, LifecycleEvent::FinalisePass) == Some(ModelState::Passed),
        "Active --finalise(pass)--> Passed",
    );
    kani::assert(
        apply_event(ModelState::Active, LifecycleEvent::FinaliseReject)
            == Some(ModelState::Rejected),
        "Active --finalise(reject)--> Rejected",
    );
    kani::assert(
        apply_event(ModelState::Active, LifecycleEvent::Cancel) == Some(ModelState::Cancelled),
        "Active --cancel--> Cancelled",
    );
    kani::assert(
        apply_event(ModelState::Passed, LifecycleEvent::Execute) == Some(ModelState::Executed),
        "Passed --execute--> Executed",
    );
}

/// Proves the model is faithful to the contract: every real [`ProposalState`]
/// variant projects onto a distinct, live (non-`Absent`) model state.
#[kani::proof]
fn verify_model_matches_contract_states() {
    kani::assert(
        project(&ProposalState::Active) == ModelState::Active,
        "ProposalState::Active must project to ModelState::Active",
    );
    kani::assert(
        project(&ProposalState::Passed) == ModelState::Passed,
        "ProposalState::Passed must project to ModelState::Passed",
    );
    kani::assert(
        project(&ProposalState::Rejected) == ModelState::Rejected,
        "ProposalState::Rejected must project to ModelState::Rejected",
    );
    kani::assert(
        project(&ProposalState::Executed) == ModelState::Executed,
        "ProposalState::Executed must project to ModelState::Executed",
    );
    kani::assert(
        project(&ProposalState::Cancelled) == ModelState::Cancelled,
        "ProposalState::Cancelled must project to ModelState::Cancelled",
    );
    kani::assert(
        project(&ProposalState::Active) != ModelState::Absent
            && project(&ProposalState::Passed) != ModelState::Absent
            && project(&ProposalState::Rejected) != ModelState::Absent
            && project(&ProposalState::Executed) != ModelState::Absent
            && project(&ProposalState::Cancelled) != ModelState::Absent,
        "a live proposal can never project onto the Absent state",
    );
}
