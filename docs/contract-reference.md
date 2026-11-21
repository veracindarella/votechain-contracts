# Contract Reference

## Governance Contract

### Configuration

#### `initialize`

Initializes the governance contract with its configuration parameters.

- `max_active_proposals` is only persisted when the provided value is greater than `0`.
- When `max_active_proposals` is left unset (or set to `0`), the contract falls back to a **default cap of 50 active proposals**.

#### `get_max_active_proposals`

Returns the effective maximum number of concurrently active proposals.

- If `max_active_proposals` was never set during `initialize` (i.e. the value was `0` or omitted), this returns the default of **50**.
- Once the number of active proposals reaches this cap, creating an additional proposal fails.

### Proposal Limits

When the active-proposal cap is unset, the contract enforces a default maximum of **50** active proposals. Creating the 51st concurrent proposal is rejected until an existing proposal is finalized or cancelled.
