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

//! Upgrade / storage-version migration tests.
//!
//! ADR-001 defines an in-place upgrade strategy: `GovernanceContract::upgrade`
//! swaps the WASM at the *same* contract address, so storage is preserved and a
//! version bump that only adds storage keys is a pure storage migration — no
//! existing entry is rewritten.
//!
//! `update_current_contract_wasm` cannot be exercised in a unit test because the
//! replacement WASM must first be uploaded to a live network. These tests
//! therefore simulate the on-chain transition: they perform exactly the storage
//! writes a `migrate_v1_to_v1_1` routine would perform — record the rollback
//! hash, bump `Version` from `(1, 0, 0)` to `(1, 1, 0)`, and initialise the
//! storage keys introduced by the newer version — through the same `storage`
//! accessors a real migration uses, then assert that the version moved forward
//! and that no pre-existing proposal, vote, or configuration value was
//! corrupted.
//!
//! Acceptance criteria covered:
//!   1. Upgrading the version preserves existing proposals.
//!   2. New storage keys are initialised without clobbering old data.
//!   3. A re-init guard test confirms migration cannot reset admin/token.

#![cfg(test)]

use crate::storage;
use crate::types::{ContractError, ProposalState, Vote};
use crate::{GovernanceContract, GovernanceContractClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, String};

/// Version written by `initialize` under v1.0.0.
const V1_0_0: (u32, u32, u32) = (1, 0, 0);
/// Version this migration upgrades to.
const V1_1_0: (u32, u32, u32) = (1, 1, 0);

/// Handles needed by the migration tests.
///
/// Exposes the governance contract address so storage can be written in the
/// contract's own context via `Env::as_contract`.
struct MigrationEnv {
    env: Env,
    gov_id: Address,
    client: GovernanceContractClient<'static>,
    admin: Address,
    token_id: Address,
}

/// Deploy governance + token, initialise governance as v1.0.0, and return the
/// handles. Mirrors `test_helpers::setup_env` but also keeps the governance
/// contract address.
fn setup() -> MigrationEnv {
    let env = Env::default();
    env.mock_all_auths();

    let gov_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &gov_id);

    let admin = Address::generate(&env);

    let token_id = env.register(votechain_token::TokenContract, ());
    let token = votechain_token::TokenContractClient::new(&env, &token_id);
    token.initialize(&admin, &10_000_000);

    client.initialize(
        &admin,
        &token_id,
        &0_i128,
        &0_u64,
        &60_u64,
        &2_592_000_u64,
        &false,
        &0_u64,
        &0_u64,
        &0_u32,
    );

    MigrationEnv {
        env,
        gov_id,
        client,
        admin,
        token_id,
    }
}

/// Simulates the storage writes a `migrate_v1_to_v1_1` routine performs after
/// the new WASM has been swapped in:
///
/// 1. record the out-going WASM hash for rollback (ADR-001),
/// 2. bump the stored `Version` to `(1, 1, 0)`,
/// 3. initialise the storage keys introduced by the newer version.
///
/// The writes run inside `Env::as_contract` so they target the governance
/// contract's own storage, exactly as an on-chain migration function would.
fn migrate_v1_to_v1_1(m: &MigrationEnv) {
    m.env.as_contract(&m.gov_id, || {
        storage::set_previous_wasm_hash(&m.env, &BytesN::from_array(&m.env, &[7u8; 32]));
        storage::set_version(&m.env, V1_1_0);
        // Storage keys introduced by the newer version, initialised to explicit
        // values (old deployments simply did not have these entries).
        storage::set_min_quorum_bps(&m.env, 25);
        storage::set_max_active_proposals(&m.env, 75);
    });
}

/// Criterion 1: a version bump from (1, 0, 0) to (1, 1, 0) moves the stored
/// version forward while every pre-existing proposal, its tally, and its vote
/// records survive unchanged.
#[test]
fn test_migration_upgrades_version_and_preserves_proposals() {
    let m = setup();
    let proposer = Address::generate(&m.env);
    let voter = Address::generate(&m.env);

    let id = m.client.create_proposal(
        &proposer,
        &String::from_str(&m.env, "Pre-upgrade proposal"),
        &String::from_str(&m.env, "Created under v1.0.0"),
        &100,
        &3600,
    );

    // Cast a vote so the tally and vote record exist before the migration.
    let token = votechain_token::TokenContractClient::new(&m.env, &m.token_id);
    token.mint(&m.admin, &voter, &1_500);
    m.client.cast_vote(&voter, &id, &Vote::Yes, &None);

    // Snapshot state as written by v1.0.0.
    assert_eq!(m.client.get_version(), V1_0_0);
    let before = m.client.get_proposal(&id);
    let count_before = m.client.proposal_count();

    migrate_v1_to_v1_1(&m);

    // The version moved forward.
    assert_eq!(m.client.get_version(), V1_1_0);
    assert_eq!(m.client.get_config().version, V1_1_0);

    // The rollback hash recorded by the upgrade is readable.
    let rollback_hash = m
        .env
        .as_contract(&m.gov_id, || storage::get_previous_wasm_hash(&m.env));
    assert_eq!(rollback_hash, Some(BytesN::from_array(&m.env, &[7u8; 32])));

    // The pre-existing proposal is fully intact.
    let after = m.client.get_proposal(&id);
    assert_eq!(after.id, before.id);
    assert_eq!(after.proposer, before.proposer);
    assert_eq!(after.title, before.title);
    assert_eq!(after.description, before.description);
    assert_eq!(after.quorum, before.quorum);
    assert_eq!(after.start_time, before.start_time);
    assert_eq!(after.end_time, before.end_time);
    assert_eq!(after.execute_after, before.execute_after);
    assert_eq!(after.supply_snapshot, before.supply_snapshot);
    assert_eq!(after.state, ProposalState::Active);

    // The tally and vote record are untouched.
    assert_eq!(after.votes_yes, 1_500);
    assert_eq!(after.votes_no, 0);
    assert_eq!(after.votes_abstain, 0);
    assert_eq!(m.client.proposal_count(), count_before);
    assert!(m.client.has_voted(&id, &voter));
    assert_eq!(m.client.get_vote(&id, &voter).unwrap().weight, 1_500);
}

/// Criterion 2: initialising the storage keys added by the newer version leaves
/// every value written by the old version — singleton config and proposal data —
/// untouched.
#[test]
fn test_migration_new_storage_keys_do_not_clobber_existing_data() {
    let m = setup();
    let proposer = Address::generate(&m.env);

    let id = m.client.create_proposal(
        &proposer,
        &String::from_str(&m.env, "Survivor"),
        &String::from_str(&m.env, "Must survive the migration"),
        &500,
        &1800,
    );

    // Configuration as written by v1.0.0.
    let before = m.client.get_config();

    migrate_v1_to_v1_1(&m);

    // The new keys are readable with the values the migration wrote.
    let after = m.client.get_config();
    assert_eq!(after.min_quorum_bps, 25);
    assert_eq!(m.client.get_max_active_proposals(), 75);

    // Old singleton config is unchanged.
    assert_eq!(after.admin, before.admin);
    assert_eq!(after.voting_token, before.voting_token);
    assert_eq!(after.min_proposal_balance, before.min_proposal_balance);
    assert_eq!(after.proposal_cooldown, before.proposal_cooldown);
    assert_eq!(after.restrict_admin_vote, before.restrict_admin_vote);
    assert_eq!(after.timelock_duration, before.timelock_duration);
    assert_eq!(after.min_duration, before.min_duration);
    assert_eq!(after.max_duration, before.max_duration);

    // Old proposal data is unchanged.
    let p = m.client.get_proposal(&id);
    assert_eq!(p.title, String::from_str(&m.env, "Survivor"));
    assert_eq!(
        p.description,
        String::from_str(&m.env, "Must survive the migration")
    );
    assert_eq!(p.quorum, 500);
    assert_eq!(p.state, ProposalState::Active);
}

/// Criterion 3: a migration path that (incorrectly) tries to re-run
/// `initialize` to reset the admin/token is blocked by the SEC-009 re-init
/// guard — even after the version has been bumped.
#[test]
fn test_migration_cannot_reset_admin_or_token() {
    let m = setup();
    let proposer = Address::generate(&m.env);

    let id = m.client.create_proposal(
        &proposer,
        &String::from_str(&m.env, "Guarded proposal"),
        &String::from_str(&m.env, "Untouched by a failed re-init"),
        &100,
        &3600,
    );

    let admin_before = m.client.get_config().admin;
    let token_before = m.client.get_config().voting_token;

    // Simulate the version bump first: the guard must hold on the migrated
    // (v1.1.0) state too.
    migrate_v1_to_v1_1(&m);
    assert_eq!(m.client.get_version(), V1_1_0);

    // A migration that wrongly re-initialised with a new admin/token.
    let rogue_admin = Address::generate(&m.env);
    let rogue_token = Address::generate(&m.env);
    let res = m.client.try_initialize(
        &rogue_admin,
        &rogue_token,
        &0_i128,
        &0_u64,
        &60_u64,
        &2_592_000_u64,
        &false,
        &0_u64,
        &0_u64,
        &0_u32,
    );
    assert_eq!(res, Err(Ok(ContractError::AlreadyInitialized)));

    // Admin and token are unchanged, and existing data is intact.
    let after = m.client.get_config();
    assert_eq!(after.admin, admin_before);
    assert_eq!(after.voting_token, token_before);
    assert_eq!(m.client.get_proposal(&id).state, ProposalState::Active);
}
