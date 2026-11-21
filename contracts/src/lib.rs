//! # Handoff Contracts Library
//!
//! Shared types, validation helpers, and constants used across the
//! Handoff smart-contract suite.

use soroban_sdk::{contracttype, Address, Env, String, Vec};

/// Maximum length (in bytes) accepted by [`validate_string`].
pub const MAX_STRING_LEN: u32 = 1024;

/// Maximum number of bytes inspected by [`validate_string`] in a single
/// validation pass. Strings longer than this are rejected before scanning.
pub const MAX_VALIDATE_BUF: u32 = 1024;

/// Returns `true` when `byte` is a C0 control character (0x00-0x1F) or DEL
/// (0x7F). These are rejected by [`validate_string`].
pub fn is_forbidden_byte(byte: u8) -> bool {
    byte <= 0x1F || byte == 0x7F
}

/// Validates a user-supplied string.
///
/// Rejects:
/// - strings longer than [`MAX_STRING_LEN`] (and thus [`MAX_VALIDATE_BUF`]),
/// - any C0 control character (0x00-0x1F), including the null byte,
/// - the DEL character (0x7F).
///
/// Printable ASCII strings at the maximum length are accepted.
pub fn validate_string(env: &Env, value: &String) -> bool {
    let len = value.len();
    if len > MAX_STRING_LEN || len > MAX_VALIDATE_BUF {
        return false;
    }

    let bytes = value.to_bytes();
    let scan = if bytes.len() > MAX_VALIDATE_BUF {
        MAX_VALIDATE_BUF
    } else {
        bytes.len()
    };

    let mut i = 0u32;
    while i < scan {
        if is_forbidden_byte(bytes.get(i).unwrap()) {
            return false;
        }
        i += 1;
    }

    // Ensure the whole string was inspected within the buffer bound.
    bytes.len() <= MAX_VALIDATE_BUF
}

/// A proposal identifier.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalId {
    pub id: u64,
}

/// A token burn record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenBurn {
    pub from: Address,
    pub amount: i128,
}

/// Returns the list of proposal IDs held by `owner`.
pub fn proposal_ids_for(_env: &Env, _owner: &Address) -> Vec<ProposalId> {
    Vec::new(_env)
}
