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

//! # Staking Reward Accrual — Overflow Safety and Supply Invariant
//!
//! `staking.rs` locks a holder's principal for a chosen lock duration
//! (ADR-013).  This module models the **reward** half of the same accounting:
//! a locked position accrues a reward linearly with the time it remains
//! locked, and the sum of a position's principal plus its accrued reward must
//! never exceed the token's total supply.
//!
//! Two properties are established and exercised by the tests below.
//!
//! 1. **Checked arithmetic.**  [`accrued_reward`] performs every step with
//!    `checked_*` and returns [`RewardError::Overflow`] instead of silently
//!    wrapping when an intermediate value leaves the `i128` range.
//! 2. **Supply invariant.**  [`check_supply_invariant`] asserts
//!    `principal + reward <= total_supply`, and [`accrue_and_verify`] couples
//!    the accrual to that invariant so a reward can never be realised that
//!    would account for more tokens than the supply contains.
//!
//! No step relies on `i128` wrap-around: an overflowing sum in the invariant
//! is reported as [`RewardError::ExceedsSupply`] rather than being allowed to
//! wrap to a small value that would spuriously satisfy the comparison.

// This is a modelling/scaffold module: the entry points are not yet wired to
// the contract API (matching `staking.rs`), so unused items are expected.
#![allow(dead_code)]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Reward rates are expressed in basis points: `10_000` bps == 100 %.
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Seconds in a 365-day year, kept in lock-step with
/// `staking::SECONDS_PER_DAY` so both halves of the accounting share one
/// notion of a year.
pub const SECONDS_PER_YEAR: i128 = 365 * crate::staking::SECONDS_PER_DAY as i128;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Failure modes of the reward-accrual computation and the supply invariant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RewardError {
    /// A checked arithmetic operation overflowed the `i128` range.
    Overflow,
    /// `principal + reward` exceeds the accounting `total_supply` — realising
    /// the reward would account for more tokens than exist.
    ExceedsSupply,
    /// A negative principal or reward was supplied; accounting values are
    /// always non-negative.
    NegativeAmount,
}

// ---------------------------------------------------------------------------
// Reward accrual (checked arithmetic)
// ---------------------------------------------------------------------------

/// Accrues the reward earned by `principal` locked at `rate_bps` for
/// `elapsed_seconds`, using **only checked arithmetic**.
///
/// ## Formula
///
/// ```text
/// reward = principal * rate_bps * elapsed_seconds
///          / (BPS_DENOMINATOR * SECONDS_PER_YEAR)
/// ```
///
/// The multiplications are performed before the single division so integer
/// truncation always rounds *down* — the accrual can never grant more reward
/// than was actually earned.  Every step is checked: if any intermediate value
/// would overflow `i128` the call returns [`RewardError::Overflow`] rather
/// than wrapping to a bogus result.
///
/// # Arguments
///
/// * `principal` — Locked amount; must be non-negative.
/// * `rate_bps` — Annual rate in basis points; must be non-negative.
/// * `elapsed_seconds` — Time the principal has been locked.
///
/// # Errors
///
/// - [`RewardError::NegativeAmount`] if `principal` or `rate_bps` is negative.
/// - [`RewardError::Overflow`] if an intermediate value leaves the `i128`
///   range.
pub fn accrued_reward(
    principal: i128,
    rate_bps: i128,
    elapsed_seconds: u64,
) -> Result<i128, RewardError> {
    if principal < 0 || rate_bps < 0 {
        return Err(RewardError::NegativeAmount);
    }

    let numerator = principal
        .checked_mul(rate_bps)
        .ok_or(RewardError::Overflow)?
        .checked_mul(elapsed_seconds as i128)
        .ok_or(RewardError::Overflow)?;
    let denominator = BPS_DENOMINATOR
        .checked_mul(SECONDS_PER_YEAR)
        .ok_or(RewardError::Overflow)?;

    // `denominator` is a positive compile-time constant, so it can never be 0.
    Ok(numerator / denominator)
}

// ---------------------------------------------------------------------------
// Supply invariant
// ---------------------------------------------------------------------------

/// The core accounting invariant: a position's `principal` plus its `reward`
/// can never exceed `total_supply`.
///
/// Returns `Ok(())` when the accounting is within supply, otherwise the exact
/// violation.  The sum is computed with `checked_add`, so an overflow is
/// reported as [`RewardError::ExceedsSupply`] (an overflowing accounting can
/// never be inside a finite supply) instead of wrapping below `total_supply`.
///
/// # Errors
///
/// - [`RewardError::NegativeAmount`] if `principal` or `reward` is negative.
/// - [`RewardError::ExceedsSupply`] if `principal + reward > total_supply` or
///   the sum overflows `i128`.
pub fn check_supply_invariant(
    principal: i128,
    reward: i128,
    total_supply: i128,
) -> Result<(), RewardError> {
    if principal < 0 || reward < 0 {
        return Err(RewardError::NegativeAmount);
    }
    let accounted = principal
        .checked_add(reward)
        .ok_or(RewardError::ExceedsSupply)?;
    if accounted > total_supply {
        return Err(RewardError::ExceedsSupply);
    }
    Ok(())
}

/// Accrues a reward and verifies the supply invariant in one step — the
/// accounting performed when a position's reward is realised.
///
/// Returns the accrued reward on success, or the first failure encountered
/// (an accrual [`RewardError::Overflow`] or a supply
/// [`RewardError::ExceedsSupply`]).
///
/// # Arguments
///
/// * `principal` — Locked amount backing the position.
/// * `rate_bps` — Annual reward rate in basis points.
/// * `elapsed_seconds` — Time the principal has been locked.
/// * `total_supply` — Current total token supply.
///
/// # Errors
///
/// Propagates [`accrued_reward`] and [`check_supply_invariant`] errors.
pub fn accrue_and_verify(
    principal: i128,
    rate_bps: i128,
    elapsed_seconds: u64,
    total_supply: i128,
) -> Result<i128, RewardError> {
    let reward = accrued_reward(principal, rate_bps, elapsed_seconds)?;
    check_supply_invariant(principal, reward, total_supply)?;
    Ok(reward)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 5 % per year, expressed in basis points.
    const APR_5_PCT_BPS: i128 = 500;

    /// One full 365-day year, in seconds.
    fn one_year() -> u64 {
        SECONDS_PER_YEAR as u64
    }

    #[test]
    fn test_seconds_per_year_is_365_days() {
        assert_eq!(SECONDS_PER_YEAR, 31_536_000);
    }

    #[test]
    fn test_accrual_at_zero_elapsed_is_zero() {
        let reward = accrued_reward(1_000_000, APR_5_PCT_BPS, 0);
        assert_eq!(reward, Ok(0));
    }

    #[test]
    fn test_accrual_one_year_at_ten_percent_is_exact() {
        // 1_000_000 principal at 10 % for exactly one year == 100_000.
        let reward = accrued_reward(1_000_000, 1_000, one_year()).unwrap();
        assert_eq!(reward, 100_000);
    }

    /// Acceptance criterion: the accrual uses checked arithmetic.  An input
    /// that overflows `i128` mid-computation returns an error — never a
    /// wrapped, negative value.
    #[test]
    fn test_accrual_overflow_is_reported_not_wrapped() {
        let overflowed = accrued_reward(i128::MAX, i128::MAX, one_year());
        assert_eq!(overflowed, Err(RewardError::Overflow));
    }

    /// Acceptance criterion: a **long-duration** accrual completes without
    /// overflow, and the reward scales linearly with time.
    #[test]
    fn test_long_duration_accrual_without_overflow() {
        // 10_000_000 principal at 10 % compounded linearly for 1 000 years —
        // far beyond any real lock period — stays well inside the i128 range.
        let millennium = 1_000 * one_year();
        let reward = accrued_reward(10_000_000, 1_000, millennium).unwrap();

        // reward = principal * rate * years / (bps) = 10_000_000 * 10 % * 1 000
        let expected = 10_000_000 * 1_000 * 1_000 / BPS_DENOMINATOR;
        assert_eq!(reward, expected);
        assert!(reward > 0);
    }

    /// Even the largest representable elapsed time is overflow-safe for a
    /// small principal: the checked path returns a value rather than wrapping.
    #[test]
    fn test_accrual_max_elapsed_is_overflow_safe() {
        let reward = accrued_reward(1, 1, u64::MAX);
        assert!(reward.is_ok());
    }

    /// The supply invariant holds exactly at the boundary and fails one unit
    /// past it.
    #[test]
    fn test_supply_invariant_at_boundary() {
        assert!(check_supply_invariant(600, 400, 1_000).is_ok());
        assert!(check_supply_invariant(1_000, 0, 1_000).is_ok());

        let one_unit_over = check_supply_invariant(1_000, 1, 1_000);
        assert_eq!(one_unit_over, Err(RewardError::ExceedsSupply));
    }

    /// A checked sum that would overflow is treated as a supply violation, not
    /// allowed to wrap below `total_supply`.
    #[test]
    fn test_supply_invariant_overflow_is_a_violation() {
        let max = i128::MAX;
        let violated = check_supply_invariant(max, max, max);
        assert_eq!(violated, Err(RewardError::ExceedsSupply));
    }

    /// Negative accounting values are rejected outright.
    #[test]
    fn test_negative_accounting_values_are_rejected() {
        let negative_reward = accrued_reward(-1, 1, 1);
        assert_eq!(negative_reward, Err(RewardError::NegativeAmount));

        let negative_principal = check_supply_invariant(-1, 0, 0);
        assert_eq!(negative_principal, Err(RewardError::NegativeAmount));
    }

    /// [`accrue_and_verify`] couples the accrual to the supply invariant: a
    /// reward that would breach supply is refused even though the accrual
    /// itself is in range.
    #[test]
    fn test_accrue_and_verify_couples_accrual_and_invariant() {
        // Supply comfortably above principal + reward (1_100_000).
        let reward = accrue_and_verify(1_000_000, 1_000, one_year(), 2_000_000);
        assert_eq!(reward, Ok(100_000));

        // Supply one unit short of principal + reward.
        let short = accrue_and_verify(1_000_000, 1_000, one_year(), 1_099_999);
        assert_eq!(short, Err(RewardError::ExceedsSupply));
    }

    /// Property/invariant test: over a representative grid of principals,
    /// rates and durations, the accounting is overflow-free, non-negative,
    /// monotonic in time, and — for any supply at or above `principal +
    /// reward` — never exceeds supply; one unit below the boundary it fails.
    #[test]
    fn test_property_accounting_never_exceeds_supply() {
        let principals = [0_i128, 1, 1_000, 1_000_000, 1_000_000_000_000];
        let rates = [0_i128, 1, 500, 1_000, 10_000];
        let day = 86_400_u64;
        let durations = [0_u64, day, 30 * day, 365 * day, 100 * 365 * day];

        for &principal in &principals {
            for &rate in &rates {
                let mut previous = 0_i128;
                for &elapsed in &durations {
                    let reward = accrued_reward(principal, rate, elapsed).unwrap();

                    // Accrual is non-negative and never decreases with time.
                    assert!(reward >= 0);
                    assert!(reward >= previous, "reward must not decrease in time");

                    // The invariant holds throughout the supplied range...
                    let accounted = principal.checked_add(reward).unwrap();
                    assert!(check_supply_invariant(principal, reward, accounted).is_ok());
                    assert!(check_supply_invariant(principal, reward, accounted + 1).is_ok());

                    // ...and a single unit less than principal + reward fails.
                    if accounted > 0 {
                        let short = check_supply_invariant(principal, reward, accounted - 1);
                        assert_eq!(short, Err(RewardError::ExceedsSupply));
                    }

                    previous = reward;
                }
            }
        }
    }
}
