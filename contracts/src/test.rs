//! Tests for the governance contract.

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, GovernanceContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_initialize() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_create_proposal_increments_id() {
    let (env, client, admin) = setup();
    let title = String::from_str(&env, "Proposal");
    let description = String::from_str(&env, "Description");

    let id0 = client.create_proposal(&admin, &title, &description);
    let id1 = client.create_proposal(&admin, &title, &description);

    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
}

#[test]
fn test_next_id_overflow_returns_error() {
    let (env, client, _admin) = setup();
    env.storage().instance().set(&DataKey::NextId, &u64::MAX);

    let result = client.try_next_id();
    assert_eq!(result, Err(Ok(Error::ProposalCountOverflow)));
}

#[cfg(test)]
mod prop_tests {
    use super::*;

    #[test]
    fn prop_proposal_ids_strictly_increasing_and_unique() {
        let (env, client, admin) = setup();
        let title = String::from_str(&env, "Proposal");
        let description = String::from_str(&env, "Description");

        let mut seen: Vec<u64> = Vec::new();
        let mut prev: Option<u64> = None;

        for _ in 0..100 {
            let id = client.create_proposal(&admin, &title, &description);

            if let Some(prev_id) = prev {
                assert!(id > prev_id, "IDs must be strictly increasing");
            }
            assert!(!seen.contains(&id), "IDs must be unique");

            seen.push(id);
            prev = Some(id);
        }

        assert_eq!(seen.len(), 100);
    }

    #[test]
    fn prop_next_id_overflow_returns_proposal_count_overflow() {
        let (env, client, _admin) = setup();
        env.storage().instance().set(&DataKey::NextId, &u64::MAX);

        let result = client.try_next_id();
        assert_eq!(result, Err(Ok(Error::ProposalCountOverflow)));
    }
}
