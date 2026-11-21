# Governance Contract

## Overview

The governance contract manages proposals, voting, and execution for the protocol.

## Configuration

### `max_active_proposals`

The maximum number of proposals that may be active at the same time.

- **Default:** `50`
- **Behavior:** `initialize` only persists `max_active_proposals` when the provided value is greater than `0`. If the value is unset (or `0`), `get_max_active_proposals` returns the default of `50`.
- **Enforcement:** Once the number of active proposals reaches the cap, creating another proposal fails. With the default in effect, the 51st concurrent proposal is rejected.

## Reference

| Function | Description |
| --- | --- |
| `initialize` | Sets up the contract. Stores `max_active_proposals` only when `> 0`. |
| `get_max_active_proposals` | Returns the configured cap, or `50` when unset. |
| `create_proposal` | Creates a proposal; fails when the active-proposal cap is reached. |
