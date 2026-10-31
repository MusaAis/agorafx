# AgoraFX

An autonomous AI agent that creates, stakes on and settles FX prediction markets on [Arc](https://www.arc.network), pays for its own market data over x402, and sells analyst research per article. Everything settles in USDC.

**Live app:** [agorafx.vercel.app](https://agorafx.vercel.app) · **Network:** Arc Testnet (chain 5042002)

- 🏆 Standout Winner — [Agora Agent Hackathon](https://agora.thecanteenapp.com)
- 🥉 3rd Place — [Lepton Agents Hackathon](https://lepton.thecanteenapp.com)
- 📰 Coverage: [The Agent Times](https://theagenttimes.com/articles/builder-ships-agorafx-an-autonomous-agent-for-african-fx-pre-37eca5a1)

---

## How it works

1. **Monitor** — every 30 seconds the agent polls several public FX sources and stores the rate, preferring a live Coinbase tick over daily-refresh APIs.
2. **Decide** — every 5 minutes the agent buys a rate signal from the AgoraFX API for $0.001 over x402, then asks an LLM (Groq, `openai/gpt-oss-120b` by default) whether to open a market. The prompt contains the pair's momentum, the paid signal, and the agent's own resolved track record on that pair. Holding is a normal outcome.
3. **Create and stake** — a market is opened on `PredictionMarketV2` for the next hour. The agent stakes its own USDC, scaled by its confidence.
4. **Fallback** — if the LLM holds six consecutive cycles (about 30 minutes) and the pair has no open market, a scheduled market is opened at the current rate. These decisions are tagged `source=fallback` so they can be told apart from LLM decisions.
5. **Resolve** — expired markets are resolved on-chain on the contract they belong to. A correct prediction returns the agent's stake; a wrong one slashes it.

## Features

**Agent staking.** The agent puts real USDC behind every market it opens (details below) and its record is readable on-chain via `getAgentStats`.

**x402 nanopayments.** `GET /rates/signal` costs $0.001 and `GET /intelligence/{id}` costs $0.05. Payments are EIP-3009 authorizations settled through Circle Gateway on Arc Testnet. The endpoints are public, so any client or agent can pay to use them. The agent's own signal purchases pay an address the operator controls.

**Signals.** Analysts publish FX commentary. Readers pay $0.05 per article; 80% goes to the author and 20% to the protocol treasury. Publishing and re-reading paid articles require a wallet-signed session (one signature, valid for 24 hours).

**Auditability.** Every agent decision and every payment decision (paid, cached, hold, error) is stored with its reasoning and exposed through the API.

**Frontend.** A landing page with live stats, markets with live YES/NO odds, positions with one-click claim, an agent activity feed, the Signals tab, and an operator panel at `/admin`. V1 and V2 markets are supported side by side.

## Current scope

- **Active pair:** EURC/USDC. The NGN, GHS, KES, ZAR and EGP pairs are paused until an intraday rate source is available, since the free APIs for those currencies only refresh daily.
- **Network:** Arc Testnet with test USDC.
- **Signing:** on-chain transactions are signed by the agent's operational account. A Circle Agent Wallet address is tracked on the dashboard for balance and spend.

## Staking (PredictionMarketV2)

| Parameter | Value |
|-----------|-------|
| Stake | `$0.50 + confidence × $0.50` (confidence 0–1, so $0.50–$1.00) |
| Market seed | $0.10 to the YES pool and $0.10 to the NO pool, taken from the stake, so markets never resolve empty |
| Collateral | stake − $0.20, held until resolution |
| Correct prediction | collateral returned to the agent |
| Wrong prediction | 50% of collateral to winning bettors, 50% to the treasury |
| Minimum bet | $0.10 |

## Contracts (Arc Testnet)

| Contract | Address |
|----------|---------|
| PredictionMarketV2 (current) | [`0x833C71c1c261857538CEB8877aaFc80A47E66130`](https://testnet.arcscan.app/address/0x833C71c1c261857538CEB8877aaFc80A47E66130) |
| PredictionMarket V1 (legacy, positions remain claimable) | [`0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5`](https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5) |
| USDC | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| EURC | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) |

## Architecture

```
 FX sources ──► Monitor ──► SQLite ◄── FastAPI backend ◄── React frontend
                              ▲              ▲
 x402 signal ◄── Decision ────┤              │ x402 gate
 (paid, $0.001)   engine      │              └─ /rates/signal, /intelligence/{id}
                    │         │
                    ▼         │
               Market creator ┴──► PredictionMarketV2 ◄── Resolver
                                      (Arc Testnet)
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /markets`, `/markets/{id}` | Markets with pool and outcome data |
| `GET /rates`, `/rates/latest` | Stored rate history |
| `GET /rates/signal` | Momentum signal, x402 ($0.001) |
| `GET /stats`, `/stats/performance` | Platform and agent statistics |
| `GET /agent/decisions`, `/decisions` | Audit trail of agent decisions and payments |
| `GET /agent/reputation`, `/agent/status`, `/agent/wallet` | Agent staking record, health, balance |
| `GET /positions/{address}` | A wallet's positions |
| `GET /intelligence`, `/intelligence/{id}` | Article list; full article via x402 ($0.05) |
| `POST /intelligence` | Publish an article (wallet-signed session) |

Operator endpoints (pause, resume, logs, stuck markets, force-resolve) require an `X-Admin-Token` header.

## Getting started

Requires Python 3.12+, Node 20+, and [Foundry](https://book.getfoundry.sh) for the contracts.

```bash
git clone --recurse-submodules https://github.com/MusaAis/agorafx.git
cd agorafx

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in your values

python -m agent.main                                    # agent
uvicorn backend.main:app --host 0.0.0.0 --port 8001     # API

cd frontend && npm install
VITE_API_URL=http://localhost:8001 npm run dev          # frontend
```

Build the contracts with `forge build`.

### Configuration

| Variable | Purpose |
|----------|---------|
| `ARC_TESTNET_RPC_URL` | Arc Testnet RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Agent operational account (market creation, x402 payments) |
| `PREDICTION_MARKET_ADDRESS`, `PREDICTION_MARKET_V2_ADDRESS` | Contract addresses |
| `GROQ_API_KEY` (`_2`, `_3`) | LLM access; extra keys are rotated on rate limits |
| `GROQ_MODEL` | Model name (default `openai/gpt-oss-120b`) |
| `BACKEND_URL` | Public URL of the API, used by the agent and the x402 resource |
| `X402_RECEIVER_ADDRESS` | Address that receives x402 payments |
| `X402_SIGNAL_PRICE_USDC`, `X402_ARTICLE_PRICE_USDC` | Prices per call |
| `DAILY_BUDGET_USDC` | Cap on the agent's daily signal spend |
| `MOMENTUM_MIN_PCT`, `MOMENTUM_BAND_LOW_PCT`, `MOMENTUM_BAND_HIGH_PCT` | Momentum thresholds, in percent over the lookback window |
| `ADMIN_TOKEN` | Secret for operator endpoints |
| `CIRCLE_AGENT_WALLET_ADDRESS` | Circle Agent Wallet shown on the dashboard |

## Project structure

```
agent/       monitor, decision engine, market creation and resolution, x402 client
backend/     FastAPI app, x402 payment gate, Signals (articles) router
Contracts/   PredictionMarket.sol (V1), AgoraFxV2.sol (V2 with staking)
frontend/    React + Vite dApp
claim_winnings.py   claims the agent's winning positions on V1 and V2
```

## Roadmap

- Re-enable the African currency pairs once an intraday rate source is in place
- Arc mainnet deployment and a PostgreSQL backend
- Additional pairs (TZS, UGX, MAD) and non-FX markets
- Mobile app

## License

[MIT](LICENSE)

## Author

Built by [@MusaAis](https://github.com/MusaAis) · [@Musa_Ais](https://x.com/Musa_Ais) on X
