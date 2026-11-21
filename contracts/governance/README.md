# Governance Contract

The governance contract manages proposals, voting, and execution for the protocol.

## Overview

- **Admin**: privileged account that can update configuration.
- **Token**: governance token used for voting power.
- **Durations**: voting period, execution delay, and related timing parameters.
- **Cooldown**: minimum time between proposal actions.
- **Timelock**: delay before an approved proposal can be executed.
- **Caps**: maximum proposal/voting limits.
- **Quorum floor**: minimum participation required for a vote to be valid.
- **Version**: contract version identifier.

## Read Functions

### `get_config`

Returns the full current configuration in a single call so indexers and
frontends can render parameters without issuing N separate reads.

```rust
pub struct Config {
    pub admin: Address,
    pub token: Address,
    pub voting_period: u64,
    pub execution_delay: u64,
    pub cooldown: u64,
    pub timelock: u64,
    pub proposal_cap: u32,
    pub voting_cap: u32,
    pub quorum_floor: u32,
    pub version: u32,
}

pub fn get_config(env: Env) -> Config;
```

| Field | Type | Description |
| --- | --- | --- |
| `admin` | `Address` | Current admin account. |
| `token` | `Address` | Governance token contract address. |
| `voting_period` | `u64` | Length of the voting window. |
| `execution_delay` | `u64` | Delay before execution after approval. |
| `cooldown` | `u64` | Minimum time between proposal actions. |
| `timelock` | `u64` | Timelock duration for approved proposals. |
| `proposal_cap` | `u32` | Maximum number of active proposals. |
| `voting_cap` | `u32` | Maximum voting weight per account. |
| `quorum_floor` | `u32` | Minimum participation for a valid vote. |
| `version` | `u32` | Contract version identifier. |

All values returned by `get_config` reflect the parameters supplied to
`initialize` (or the latest values set by the admin).
