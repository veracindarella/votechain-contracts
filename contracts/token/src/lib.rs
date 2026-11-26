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

#![no_std]

mod events;
mod reward;
mod staking;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env};
use storage::*;
use types::{Allowance, ContractError, MIN_TRANSFER_WINDOW};

// SEC-004: Stellar null/zero address used as the sentinel for invalid inputs.
const ZERO_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    TotalSupply,
    ProposalCount,
    Proposal(u32),
}

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn mint(env: Env, amount: i128) {
        let supply = Self::total_supply(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));
    }

    /// Create a proposal, snapshotting the current total supply.
    ///
    /// Rejects a quorum that exceeds the current supply and stores the
    /// creation-time supply so later mints cannot relax the bound.
    pub fn create_proposal(env: Env, quorum: i128) -> u32 {
        let supply_snapshot = Self::total_supply(env.clone());
        if quorum > supply_snapshot {
            panic!("quorum exceeds supply");
        }

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);

        let proposal = Proposal {
            id,
            quorum,
            supply_snapshot,
        };
        env.storage()
            .instance()
            .set(&DataKey::Proposal(id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &(id + 1));

        id
    }

    pub fn get_proposal(env: Env, id: u32) -> Proposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(id))
            .expect("proposal not found")
    }

    /// Update a proposal's quorum, validating against the creation-time
    /// supply snapshot rather than the current total supply.
    pub fn update_quorum(env: Env, id: u32, quorum: i128) {
        let mut proposal = Self::get_proposal(env.clone(), id);
        if quorum > proposal.supply_snapshot {
            panic!("quorum exceeds supply snapshot");
        }
        set_admin(&env, &new_admin);
        events::admin_transferred(&env, &admin, &new_admin);
        Ok(())
    }

    /// SEC-006: Proposes a two-step admin key rotation.
    ///
    /// Nominates `new_admin` with an acceptance window of `window_secs` seconds
    /// (default 48 h when `0`). The admin key is NOT transferred until the
    /// nominee calls [`accept_admin_transfer`] within the window.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if either address is the zero address.
    /// - [`ContractError::NotAdmin`] if `admin` does not match the stored admin.
    /// - [`ContractError::TransferWindowTooShort`] if `window_secs` is non-zero and
    ///   less than [`MIN_TRANSFER_WINDOW`] (300 seconds).
    pub fn propose_admin_transfer(
        env: Env,
        admin: Address,
        new_admin: Address,
        window_secs: u64,
    ) -> Result<(), ContractError> {
        // SEC-005: auth first.
        admin.require_auth();
        // SEC-004: reject zero addresses for both parameters.
        require_non_zero_address(&env, &admin)?;
        require_non_zero_address(&env, &new_admin)?;
        if get_admin(&env)? != admin {
            return Err(ContractError::NotAdmin);
        }
        // Enforce minimum transfer window to absorb ledger-timestamp clock drift.
        if window_secs != 0 && window_secs < MIN_TRANSFER_WINDOW {
            return Err(ContractError::TransferWindowTooShort);
        }
        let window = if window_secs == 0 { 172_800 } else { window_secs }; // default 48 h
        let expiry = env.ledger().timestamp() + window;
        set_pending_admin(&env, &new_admin);
        set_admin_transfer_expiry(&env, expiry);
        events::admin_transfer_proposed(&env, &admin, &new_admin, expiry);
        Ok(())
    }

    /// SEC-006: Accepts a pending admin key rotation.
    ///
    /// Must be called by the nominated address before the acceptance window expires.
    /// On success the caller becomes the new admin and the nomination is cleared.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `new_admin` is the zero address.
    /// - [`ContractError::PendingAdminNotSet`] if no nomination is outstanding.
    /// - [`ContractError::NotPendingAdmin`] if `new_admin` is not the nominated address.
    /// - [`ContractError::AdminTransferExpired`] if the acceptance window has passed.
    pub fn accept_admin_transfer(env: Env, new_admin: Address) -> Result<(), ContractError> {
        // SEC-005: auth first.
        new_admin.require_auth();
        // SEC-004: reject zero address.
        require_non_zero_address(&env, &new_admin)?;
        let pending = get_pending_admin(&env).ok_or(ContractError::PendingAdminNotSet)?;
        if pending != new_admin {
            return Err(ContractError::NotPendingAdmin);
        }
        if env.ledger().timestamp() > get_admin_transfer_expiry(&env) {
            clear_pending_admin(&env);
            return Err(ContractError::AdminTransferExpired);
        }
        let old_admin = get_admin(&env)?;
        set_admin(&env, &new_admin);
        clear_pending_admin(&env);
        events::admin_transferred(&env, &old_admin, &new_admin);
        Ok(())
    }

    /// Returns the contract version as a `(major, minor, patch)` semver tuple.
    pub fn get_version(env: Env) -> (u32, u32, u32) {
        get_version(&env)
    }

    /// Returns the remaining spending allowance granted by `owner` to `spender`.
    ///
    /// Returns `0` if no allowance has been set, if the allowance has been fully
    /// spent, or if the allowance has expired (`current_ledger > expiry_ledger`).
    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        storage::allowance(&env, &owner, &spender)
    }

    /// SEC-013 / ADR-013: Locks `amount` tokens for `lock_duration_seconds`,
    /// granting a time-weighted voting-power multiplier once staked.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAmount`] if `amount` is zero or negative.
    /// - [`ContractError::InvalidLockDuration`] if the duration exceeds
    ///   `staking::MAX_LOCK_DAYS`.
    /// - [`ContractError::AlreadyStaked`] if `staker` already has a position.
    /// - [`ContractError::InsufficientBalance`] if the transferable balance is
    ///   less than `amount`.
    pub fn stake(
        env: Env,
        staker: Address,
        amount: i128,
        lock_duration_seconds: u64,
    ) -> Result<(), ContractError> {
        staking::stake(&env, staker, amount, lock_duration_seconds)
    }

    /// SEC-013 / ADR-013: Releases an expired stake position, restoring the
    /// locked tokens to the transferable balance.
    ///
    /// # Errors
    /// - [`ContractError::StakeNotFound`] if `staker` has no active position.
    /// - [`ContractError::StakeLocked`] if `locked_until` has not yet passed.
    pub fn unstake(env: Env, staker: Address) -> Result<(), ContractError> {
        staking::unstake(&env, staker)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn create_proposal_snapshots_supply() {
        let env = Env::default();
        let client = TokenContractClient::new(&env, &env.register_contract(None, TokenContract));

        client.mint(&100);
        let id = client.create_proposal(&50);
        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.supply_snapshot, 100);
        assert_eq!(proposal.quorum, 50);
    }

    #[test]
    #[should_panic(expected = "quorum exceeds supply")]
    fn create_proposal_rejects_quorum_above_supply() {
        let env = Env::default();
        let client = TokenContractClient::new(&env, &env.register_contract(None, TokenContract));

        client.mint(&100);
        client.create_proposal(&101);
    }

    #[test]
    fn mint_after_create_does_not_relax_quorum_bound() {
        let env = Env::default();
        let client = TokenContractClient::new(&env, &env.register_contract(None, TokenContract));

        client.mint(&100);
        let id = client.create_proposal(&50);

        // Minting after creation must not raise the effective bound.
        client.mint(&1000);
        assert_eq!(client.total_supply(), 1100);

        // Raising quorum above the creation-time snapshot must still fail.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.update_quorum(&id, &101);
        }));
        assert!(result.is_err());

        // The stored snapshot is unchanged and the quorum is still bounded.
        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.supply_snapshot, 100);
        assert_eq!(proposal.quorum, 50);

        // A quorum within the snapshot is still accepted.
        client.update_quorum(&id, &100);
        assert_eq!(client.get_proposal(&id).quorum, 100);
    }
}
