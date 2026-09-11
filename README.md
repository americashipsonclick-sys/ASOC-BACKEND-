# ASOC Phase 1

America Ships On Click. This repo is the contract + webhook foundation.

**This build:** webhook + ASOC contract. Prove a wallet can mint, stake, and receive the hourly bonus.

**Not this build:** plate logging, email, messaging. Those wait until mint/stake/bonus is solid on a connected wallet.

## Locked economics

- ASOC buy-in required. No minimum purchase (any amount above zero).
- Regular holders: **1% hourly**, forever, no per-holder cap.
- Premium app subscribers: **5% hourly instead of 1%** (does not stack).
- **30-day** lock before sell or transfer. Stake and hourly bonus still work during the lock.
- Hourly bonus budget = **7% of the 10% reserve** (0.7% of volume). Over-claims are haircut.
- 1% and 5% are split weights (`1×` vs `5×` staked balance).

## Universal load-posting rule

Every load must include at least one photo when it is posted. If no photo is available, the post must include all four exact positive measurements: **length, width, height, and weight**. The API rejects incomplete posts before they reach any load board.

Driver USDC on Base and the public haul ledger are already sketched in this repo. Do not block Phase 1 on them.

## Prove Phase 1

```bash
copy .env.example .env
npm install
npm run compile
npm test
npx hardhat run scripts/phase1-local.ts
```

The local script is a wallet: it purchases 100 ASOC, stakes, waits one hour, and claims a 1 ASOC bonus.

Webhook mint (owner/platform mints into a wallet):

```bash
curl -X POST http://localhost:3001/api/webhook/ASOC ^
  -H "content-type: application/json" ^
  -H "x-webhook-secret: change-me" ^
  -d "{\"type\":\"token.mint\",\"purchaseId\":\"PAYMENT-PROVIDER-ID\",\"to\":\"0xWALLET\",\"tokens\":\"100\",\"volumeTokens\":\"100\"}"
```

`purchaseId` is mandatory and can only mint once on-chain, so webhook retries cannot duplicate a purchase. Stake and `claimBonus` are signed by the wallet itself. After deploy, open `http://localhost:3001/phase1.html`.

```bash
npm run db:migrate
npm run api
npm run deploy:polygon
```

Set `ASOC_ADDRESS` from the deploy output. Set `DRY_RUN=0` and `PRIVATE_KEY` to mint on-chain through the webhook.

## Later

- Phase 2: delivery receipt writes plate, load ID, miles, rate, reserve. Email triggers. Messaging (needs this wallet connection).
- Separate: Gemini bots (Scribe, Front Desk, Circuit, Scout, Anchor, Commander, Coinstall).
