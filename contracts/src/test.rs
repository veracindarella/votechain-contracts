#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

use crate::{Contract, ContractClient, ProposalStatus};

fn setup(env: &Env) -> (ContractClient, Address) {
    let contract_id = env.register_contract(None, Contract);
    let client = ContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (client, admin)
}

fn count_active(client: &ContractClient) -> u32 {
    client.count_active_proposals()
}

fn active_proposals(client: &ContractClient) -> u32 {
    let mut active = 0u32;
    let total = client.proposal_count();
    let mut i = 0u32;
    while i < total {
        if client.get_proposal(&i).status == ProposalStatus::Active {
            active += 1;
        }
        i += 1;
    }
    active
}

fn assert_invariant(client: &ContractClient) {
    assert_eq!(
        count_active(client),
        active_proposals(client),
        "count_active_proposals must equal the number of Active proposals"
    );
}

#[test]
fn invariant_holds_on_create() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    assert_invariant(&client);

    let mut i = 0u32;
    while i < 5 {
        client.create_proposal(&admin, &i);
        assert_invariant(&client);
        i += 1;
    }

    assert_eq!(count_active(&client), 5);
}

#[test]
fn invariant_holds_on_finalise() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let id = client.create_proposal(&admin, &1);
    assert_invariant(&client);

    client.finalise_proposal(&admin, &id);
    assert_invariant(&client);
    assert_eq!(count_active(&client), 0);
}

#[test]
fn cancel_active_decrements_once() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let id = client.create_proposal(&admin, &1);
    assert_eq!(count_active(&client), 1);

    client.cancel_proposal(&admin, &id);
    assert_eq!(count_active(&client), 0);
    assert_invariant(&client);

    // Cancelling again must not decrement below zero or double-decrement.
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.cancel_proposal(&admin, &id);
    }));
    assert!(res.is_err(), "double cancel must be rejected");
    assert_eq!(count_active(&client), 0);
    assert_invariant(&client);
}

#[test]
fn invariant_holds_across_mixed_transitions() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let a = client.create_proposal(&admin, &1);
    let b = client.create_proposal(&admin, &2);
    let c = client.create_proposal(&admin, &3);
    assert_invariant(&client);

    client.finalise_proposal(&admin, &a);
    assert_invariant(&client);

    client.cancel_proposal(&admin, &b);
    assert_invariant(&client);

    let d = client.create_proposal(&admin, &4);
    assert_invariant(&client);

    client.cancel_proposal(&admin, &c);
    assert_invariant(&client);

    client.finalise_proposal(&admin, &d);
    assert_invariant(&client);

    assert_eq!(count_active(&client), 0);
}

#[cfg(kani)]
mod kani_proofs {
    use super::*;

    /// Symbolic proof: for any sequence of create/finalise/cancel transitions
    /// over a bounded number of proposals, the counter equals the number of
    /// Active proposals in every reachable state.
    #[kani::proof]
    #[kani::unwind(8)]
    fn active_counter_matches_active_proposals() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let mut ids: Vec<u32> = Vec::new(&env);
        let steps: u8 = kani::any();
        kani::assume(steps <= 4);

        let mut s = 0u8;
        while s < steps {
            let op: u8 = kani::any();
            kani::assume(op < 3);
            match op {
                0 => {
                    let id = client.create_proposal(&admin, &(s as u32));
                    ids.push_back(id);
                }
                1 => {
                    if !ids.is_empty() {
                        let idx: u32 = kani::any();
                        kani::assume(idx < ids.len());
                        let id = ids.get(idx).unwrap();
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            client.finalise_proposal(&admin, &id);
                        }));
                    }
                }
                _ => {
                    if !ids.is_empty() {
                        let idx: u32 = kani::any();
                        kani::assume(idx < ids.len());
                        let id = ids.get(idx).unwrap();
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            client.cancel_proposal(&admin, &id);
                        }));
                    }
                }
            }
            assert_invariant(&client);
            s += 1;
        }
    }
}
