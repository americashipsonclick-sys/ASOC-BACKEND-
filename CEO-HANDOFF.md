# ASOC Phase 1 — CEO Handoff

**Date:** September 10, 2026  
**Status:** Code complete and proven locally; not yet deployed to Polygon mainnet.

## Conclusion

ASOC Phase 1 can securely mint a verified purchase into a wallet, stake ASOC, and pay the hourly holder bonus. The complete HTTP webhook → on-chain mint → wallet stake → hourly claim workflow passes locally.

The system is not authorized or configured for a live transaction yet. No mainnet deployment or real-money transfer has occurred.

## Completed

- Verified-purchase minting with mandatory payment ID
- On-chain protection against duplicate webhook minting
- 30-day sell/transfer lock while staking and rewards remain available
- Regular 1× and premium 5× reward weighting without stacking
- Reward payouts restricted to the 0.7% transaction-volume slice
- Pro-rata haircut when the reward slice is insufficient
- Strong webhook authorization and wallet-address validation
- Paid-membership premium attestation path
- Polygon mainnet wallet guard in the Phase 1 interface
- Separate Base-only configuration for driver USDC payouts
- 32 automated tests passing with no lint errors



## CEO Decisions and Inputs Required

1. Authorize the Polygon mainnet deployment.
2. Select and fund the deployment/contract-owner wallet with Polygon gas.
3. Enter `PRIVATE_KEY` locally—never send it through chat, email, or documentation.
4. Generate a unique webhook secret of at least 32 characters.
5. Deploy the updated ASOC contract and record its `ASOC_ADDRESS`.
6. Keep `DRY_RUN=1` until the deployment and wallet details are verified.
7. Approve one controlled live mint, stake, and hourly claim test before public use.



## Production Gate

Do not process a live shipment or promise instant settlement until:

- `npm test` passes
- `npm run env:check` passes
- `PAYOUT_CHAIN=base`
- `ASOC_ADDRESS` is the newly deployed Polygon mainnet contract
- The webhook secret is no longer `change-me`
- The signing wallet has sufficient gas
- A controlled wallet receives a real transaction hash
- The wallet stakes successfully
- The wallet claims its bonus after at least one real hour



## Locked Scope

Phase 1 is the contract and webhook proof only.

Load posting, plate logging, email, messaging, and the public haul ledger remain Phase 2. Driver payouts are a separate USDC-on-Base pipe and must not be mixed with holder reward funding.

## Verification Commands

```powershell
Set-Location C:\Users\karna\asoc-contracts
npm test
npm run env:check
npm run phase1
```

For an authorized Polygon mainnet deployment:

```powershell
npm run deploy:polygon:mainnet
```



## Final Assessment

**Engineering:** Ready for controlled deployment.  
**Local proof:** Passed.  
**Mainnet proof:** Pending CEO authorization, funded wallet, secure local credentials, deployment, and the real one-hour claim.