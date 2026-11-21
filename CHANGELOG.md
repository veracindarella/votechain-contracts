# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- **Contracts: per-function Soroban gas report.** A reproducible gas report is now generated for the key contract entry points and attached to release notes so deployers can budget resource costs.

  | Function | CPU instructions (est.) | Memory (est.) |
  | --- | --- | --- |
  | `create_proposal` | see `gas-report.txt` | see `gas-report.txt` |
  | `cast_vote` | see `gas-report.txt` | see `gas-report.txt` |
  | `finalise` | see `gas-report.txt` | see `gas-report.txt` |
  | `execute` | see `gas-report.txt` | see `gas-report.txt` |

  The numbers are produced by the checked-in, deterministic script `scripts/gas-report.sh`, which runs the contract test suite with Soroban budget metering enabled and writes `gas-report.txt`. Re-run it locally or in CI to reproduce the figures; the generated report is attached to each release.

### Changed

### Fixed
