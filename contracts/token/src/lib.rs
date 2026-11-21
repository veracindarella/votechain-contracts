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
use types::{Allowance, ContractError};

// SEC-004: Stellar null/zero address used as the sentinel for invalid inputs.
const ZERO_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// SEC-004: Rejects the Stellar zero/default address on any address parameter.
fn require_non_zero_address(env: &Env, addr: &Address) -> Result<(), ContractError> {
    if *addr == Address::from_str(env, ZERO_ADDRESS) {
        return Err(ContractError::InvalidAddress);
    }
    Ok(())
}

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    /// Initialises the token contract, minting the entire initial supply to the admin.
    ///
    /// Must be called once before any other function.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `admin` – Address that receives the initial supply and gains admin privileges.
    /// - `initial_supply` – Total tokens minted to `admin` at initialisation.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `admin` is the zero address.
    pub fn initialize(env: Env, admin: Address, initial_supply: i128) -> Result<(), ContractError> {
        // SEC-005: auth first.
        admin.require_auth();
        // SEC-004: reject zero address before any state change.
        require_non_zero_address(&env, &admin)?;
        set_admin(&env, &admin);
        set_balance(&env, &admin, initial_supply);
        set_total_supply(&env, initial_supply);
        set_version(&env, (1, 0, 0));
        Ok(())
    }

    /// Returns the total token supply in circulation.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    ///
    /// # Returns
    /// Total supply as `i128`.
    pub fn total_supply(env: Env) -> i128 {
        total_supply(&env)
    }

    /// Returns the token balance of an address.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `owner` – Address to query.
    ///
    /// # Returns
    /// Balance as `i128`. Returns `0` if the address has never held tokens.
    pub fn balance(env: Env, owner: Address) -> i128 {
        balance_of(&env, &owner)
    }

    /// Returns the token balance of an address (alias for [`balance`]).
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `owner` – Address to query.
    ///
    /// # Returns
    /// Balance as `i128`. Returns `0` if the address has never held tokens.
    pub fn balance_of(env: Env, owner: Address) -> i128 {
        balance_of(&env, &owner)
    }

    /// Transfers tokens from one address to another.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `from` – Sender address; must authorise the call.
    /// - `to` – Recipient address.
    /// - `amount` – Number of tokens to transfer; must be positive.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `from` or `to` is the zero address.
    /// - [`ContractError::InvalidAmount`] if `amount` is zero or negative.
    /// - [`ContractError::InsufficientBalance`] if `from` has fewer tokens than `amount`.
    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        // SEC-005: auth first.
        from.require_auth();
        // SEC-004: reject zero addresses.
        require_non_zero_address(&env, &from)?;
        require_non_zero_address(&env, &to)?;
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        // Transfer to self is a no-op: auth is still required but no state changes occur.
        if from == to {
            return Ok(());
        }
        let b = balance_of(&env, &from);
        if b < amount {
            return Err(ContractError::InsufficientBalance);
        }
        // SEC-013 §2.3: tokens committed to an active stake lock cannot be
        // transferred until the lock expires.
        if staking::transferable_balance(&env, &from, b) < amount {
            return Err(ContractError::TokensLocked);
        }
        set_balance(&env, &from, b - amount);
        set_balance(&env, &to, balance_of(&env, &to) + amount);
        events::transferred(&env, &from, &to, amount);
        Ok(())
    }

    /// Approves `spender` to transfer up to `amount` tokens on behalf of `owner`,
    /// with an explicit ledger-sequence expiry.
    ///
    /// Overwrites any existing allowance. Stored in temporary storage (expires with
    /// the ledger-entry TTL **or** when `expiry_ledger` is reached, whichever comes
    /// first).
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `owner` – Token owner granting the allowance; must authorise the call.
    /// - `spender` – Address permitted to spend on behalf of `owner`.
    /// - `amount` – Maximum tokens the spender may transfer. Use `0` to revoke.
    /// - `expiry_ledger` – The ledger sequence number at which the allowance expires
    ///   (inclusive). Must be `>= env.ledger().sequence()`. After this ledger the
    ///   allowance is treated as zero by `allowance()` and `transfer_from()`.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `owner` or `spender` is the zero address.
    /// - [`ContractError::InvalidExpiry`] if `expiry_ledger < env.ledger().sequence()`.
    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        amount: i128,
        expiry_ledger: u32,
    ) -> Result<(), ContractError> {
        // SEC-005: auth first.
        owner.require_auth();
        // SEC-004: reject zero addresses.
        require_non_zero_address(&env, &owner)?;
        require_non_zero_address(&env, &spender)?;
        // Expiry must not be in the past.
        if expiry_ledger < env.ledger().sequence() {
            return Err(ContractError::InvalidExpiry);
        }
        set_allowance(
            &env,
            &owner,
            &spender,
            &Allowance {
                amount,
                expiry_ledger,
            },
        );
        Ok(())
    }

    /// Transfers tokens on behalf of `from` using a pre-approved allowance.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `spender` – Address spending the allowance; must authorise the call.
    /// - `from` – Token owner whose balance is debited.
    /// - `to` – Recipient address.
    /// - `amount` – Number of tokens to transfer; must not exceed the allowance.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `spender`, `from`, or `to` is the zero address.
    /// - [`ContractError::AllowanceExpired`] if the allowance has expired.
    /// - [`ContractError::AllowanceExceeded`] if `amount` exceeds the current allowance.
    /// - [`ContractError::InsufficientBalance`] if `from` has fewer tokens than `amount`.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        // SEC-005: auth first.
        spender.require_auth();
        // SEC-004: reject zero addresses.
        require_non_zero_address(&env, &spender)?;
        require_non_zero_address(&env, &from)?;
        require_non_zero_address(&env, &to)?;

        // Check allowance — returns 0 for expired or missing allowances.
        // We also need the raw record to distinguish "expired" from "never set".
        let record = get_allowance(&env, &from, &spender);
        match &record {
            Some(a) if env.ledger().sequence() > a.expiry_ledger => {
                return Err(ContractError::AllowanceExpired);
            }
            _ => {}
        }
        let allowed = record.map(|a| a.amount).unwrap_or(0);
        if allowed < amount {
            return Err(ContractError::AllowanceExceeded);
        }
        let b = balance_of(&env, &from);
        if b < amount {
            return Err(ContractError::InsufficientBalance);
        }
        // SEC-013 §2.1/§2.3: block the allowance-trick lock bypass — a
        // spender cannot move `from`'s tokens past the transferable
        // (unstaked) balance, even with a valid, unexpired allowance.
        if staking::transferable_balance(&env, &from, b) < amount {
            return Err(ContractError::TokensLocked);
        }
        // Update allowance: keep same expiry, reduce amount.
        if let Some(a) = get_allowance(&env, &from, &spender) {
            set_allowance(
                &env,
                &from,
                &spender,
                &Allowance {
                    amount: allowed - amount,
                    expiry_ledger: a.expiry_ledger,
                },
            );
        }
        set_balance(&env, &from, b - amount);
        set_balance(&env, &to, balance_of(&env, &to) + amount);
        events::transferred(&env, &from, &to, amount);
        Ok(())
    }

    /// Mints new tokens to an address, increasing the total supply.
    ///
    /// Only the admin may mint tokens.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `admin` – Admin address; must authorise the call.
    /// - `to` – Address that receives the newly minted tokens.
    /// - `amount` – Number of tokens to mint; must be positive.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `admin` or `to` is the zero address.
    /// - [`ContractError::NotAdmin`] if `admin` does not match the stored admin.
    /// - [`ContractError::InvalidAmount`] if `amount` is zero or negative.
    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> Result<(), ContractError> {
        // SEC-005: auth first.
        admin.require_auth();
        // SEC-004: reject zero addresses.
        require_non_zero_address(&env, &admin)?;
        require_non_zero_address(&env, &to)?;
        if get_admin(&env)? != admin {
            return Err(ContractError::NotAdmin);
        }
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        set_balance(&env, &to, balance_of(&env, &to) + amount);
        set_total_supply(&env, total_supply(&env) + amount);
        events::minted(&env, &to, amount);
        Ok(())
    }

    /// Burns tokens from an address, reducing the total supply.
    ///
    /// Only the admin may burn tokens.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `admin` – Admin address; must authorise the call.
    /// - `from` – Address whose tokens are burned.
    /// - `amount` – Number of tokens to burn.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `admin` or `from` is the zero address.
    /// - [`ContractError::NotAdmin`] if `admin` does not match the stored admin.
    /// - [`ContractError::InsufficientBalance`] if `from` has fewer tokens than `amount`.
    pub fn burn(
        env: Env,
        admin: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        // SEC-005: auth first.
        admin.require_auth();
        // SEC-004: reject zero addresses.
        require_non_zero_address(&env, &admin)?;
        require_non_zero_address(&env, &from)?;
        if get_admin(&env)? != admin {
            return Err(ContractError::NotAdmin);
        }
        let b = balance_of(&env, &from);
        if b < amount {
            return Err(ContractError::InsufficientBalance);
        }
        set_balance(&env, &from, b - amount);
        set_total_supply(&env, total_supply(&env) - amount);
        events::burned(&env, &from, amount);
        Ok(())
    }

    /// Transfers admin rights to a new address. Only the current admin may call this.
    ///
    /// The old admin loses all privileges immediately upon successful transfer.
    ///
    /// # Parameters
    /// - `env` – Soroban execution environment.
    /// - `admin` – Current admin address; must authorise the call.
    /// - `new_admin` – Address that will become the new admin.
    ///
    /// # Errors
    /// - [`ContractError::InvalidAddress`] if `admin` or `new_admin` is the zero address.
    /// - [`ContractError::NotAdmin`] if `admin` does not match the stored admin.
    pub fn transfer_admin(
        env: Env,
        admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        // SEC-005: auth first.
        admin.require_auth();
        // SEC-004: reject zero addresses for both parameters.
        require_non_zero_address(&env, &admin)?;
        require_non_zero_address(&env, &new_admin)?;
        if get_admin(&env)? != admin {
            return Err(ContractError::NotAdmin);
        }
        set_admin(&env, &new_admin);
        events::admin_transferred(&env, &admin, &new_admin);
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

    /// SEC-013 / ADR-013: Returns the time-weighted voting power for `staker`,
    /// accounting for any active stake lock multiplier.
    pub fn staked_voting_power(env: Env, staker: Address) -> i128 {
        staking::staked_voting_power(&env, staker)
    }
}
