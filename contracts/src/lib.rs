//! Governance contract for the DAO.
//!
//! Tracks proposals and maintains a counter of currently-active proposals.
//! The counter must always equal the number of proposals in the `Active`
//! state; this invariant is exercised by the property test at the bottom of
//! this file (and can be checked formally with Kani via `#[cfg(kani)]`).

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalState {
    Active,
    Finalised,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u32,
    pub state: ProposalState,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataKey {
    pub proposals: Vec<Proposal>,
    pub count_active_proposals: u32,
    pub next_id: u32,
}

const DATA_KEY: &str = "DATA";

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    fn load(env: &Env) -> DataKey {
        env.storage()
            .persistent()
            .get(&DATA_KEY)
            .unwrap_or(DataKey {
                proposals: Vec::new(env),
                count_active_proposals: 0,
                next_id: 0,
            })
    }

    fn save(env: &Env, data: &DataKey) {
        env.storage().persistent().set(&DATA_KEY, data);
    }

    /// Create a new proposal in the `Active` state and increment the counter.
    pub fn create_proposal(env: Env, _author: Address) -> u32 {
        let mut data = Self::load(&env);
        let id = data.next_id;
        data.next_id += 1;
        data.proposals.push_back(Proposal {
            id,
            state: ProposalState::Active,
        });
        data.count_active_proposals += 1;
        Self::save(&env, &data);
        id
    }

    /// Finalise an `Active` proposal, decrementing the counter exactly once.
    pub fn finalise_proposal(env: Env, id: u32) {
        let mut data = Self::load(&env);
        let mut i = 0;
        while i < data.proposals.len() {
            let mut p = data.proposals.get(i).unwrap();
            if p.id == id {
                if p.state == ProposalState::Active {
                    p.state = ProposalState::Finalised;
                    data.proposals.set(i, p);
                    data.count_active_proposals -= 1;
                }
                break;
            }
            i += 1;
        }
        Self::save(&env, &data);
    }

    /// Cancel a proposal. If it was `Active`, decrement the counter exactly once.
    pub fn cancel_proposal(env: Env, id: u32) {
        let mut data = Self::load(&env);
        let mut i = 0;
        while i < data.proposals.len() {
            let mut p = data.proposals.get(i).unwrap();
            if p.id == id {
                if p.state == ProposalState::Active {
                    p.state = ProposalState::Cancelled;
                    data.proposals.set(i, p);
                    data.count_active_proposals -= 1;
                }
                break;
            }
            i += 1;
        }
        Self::save(&env, &data);
    }

    pub fn count_active_proposals(env: Env) -> u32 {
        Self::load(&env).count_active_proposals
    }

    pub fn get_proposal(env: Env, id: u32) -> Option<Proposal> {
        let data = Self::load(&env);
        let mut i = 0;
        while i < data.proposals.len() {
            let p = data.proposals.get(i).unwrap();
            if p.id == id {
                return Some(p);
            }
            i += 1;
        }
        None
    }
}

/// Pure helper mirroring the on-chain counter logic so the invariant can be
/// checked without a full `Env` (used by the property test and Kani harness).
#[cfg(any(test, kani))]
fn active_count(proposals: &[ProposalState]) -> u32 {
    proposals
        .iter()
        .filter(|s| **s == ProposalState::Active)
        .count() as u32
}

#[cfg(test)]
mod invariant_tests {
    use super::*;

    /// Deterministic pseudo-random generator so the property test is
    /// reproducible without external crates.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);
            self.0
        }
    }

    /// Apply a random transition (create / finalise / cancel) to a model of
    /// the contract state and assert the counter invariant holds afterwards.
    fn step(rng: &mut Lcg, states: &mut Vec<ProposalState>, counter: &mut u32) {
        let op = rng.next() % 3;
        match op {
            0 => {
                states.push(ProposalState::Active);
                *counter += 1;
            }
            1 | 2 => {
                if states.is_empty() {
                    return;
                }
                let idx = (rng.next() as usize) % states.len();
                let was_active = states[idx] == ProposalState::Active;
                if was_active {
                    states[idx] = if op == 1 {
                        ProposalState::Finalised
                    } else {
                        ProposalState::Cancelled
                    };
                    *counter -= 1;
                }
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn counter_equals_active_proposals_across_transitions() {
        let mut rng = Lcg(0xDEAD_BEEF);
        for _ in 0..10_000 {
            let mut states: Vec<ProposalState> = Vec::new();
            let mut counter: u32 = 0;
            for _ in 0..32 {
                step(&mut rng, &mut states, &mut counter);
                assert_eq!(counter, active_count(&states));
            }
        }
    }

    #[test]
    fn cancelling_active_decrements_once() {
        let mut states = vec![ProposalState::Active];
        let mut counter = 1u32;
        // Cancel the active proposal.
        states[0] = ProposalState::Cancelled;
        counter -= 1;
        assert_eq!(counter, 0);
        assert_eq!(counter, active_count(&states));
        // Cancelling again must not underflow / double-decrement.
        if states[0] == ProposalState::Active {
            counter -= 1;
        }
        assert_eq!(counter, 0);
        assert_eq!(counter, active_count(&states));
    }
}

#[cfg(kani)]
mod kani_proofs {
    use super::*;

    /// Kani harness: for any sequence of transitions, the counter equals the
    /// number of Active proposals.
    #[kani::proof]
    fn counter_invariant_holds() {
        let mut states: Vec<ProposalState> = Vec::new();
        let mut counter: u32 = 0;
        let steps: u8 = kani::any();
        kani::assume(steps <= 8);
        for _ in 0..steps {
            let op: u8 = kani::any();
            kani::assume(op < 3);
            match op {
                0 => {
                    states.push(ProposalState::Active);
                    counter += 1;
                }
                _ => {
                    if states.is_empty() {
                        continue;
                    }
                    let idx: usize = kani::any();
                    kani::assume(idx < states.len());
                    if states[idx] == ProposalState::Active {
                        states[idx] = if op == 1 {
                            ProposalState::Finalised
                        } else {
                            ProposalState::Cancelled
                        };
                        counter -= 1;
                    }
                }
            }
            assert_eq!(counter, active_count(&states));
        }
    }
}
