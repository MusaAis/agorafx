# AgoraFX

**The first AI agent that autonomously pays for its own data, stakes on its own markets, and lets African analysts earn per article — on Arc, in USDC**

> *"An unverified but architecturally significant hackathon project for the agent economy."*
> — [The Agent Times](https://theagenttimes.com/articles/builder-ships-agorafx-an-autonomous-agent-for-african-fx-pre-37eca5a1)

> 🏆 **Standout Winner** — [Agora Agent Hackathon](https://agora.thecanteenapp.com) by The Canteen × Arc × Circle
> 🥉 **3rd Place winner** — [Lepton Agents Hackathon](https://lepton.thecanteenapp.com) by Canteen × Circle × Arc

An autonomous AI agent that monitors real-time African FX rates 24/7, detects momentum using Groq + Llama 3.3, and **automatically creates and resolves on-chain prediction markets** — with no human intervention.

**v2 (Lepton):** The agent now has its own Circle wallet, pays for rate data autonomously via x402 nanopayments, **stakes its own USDC on every market it creates** (wrong predictions get slashed), and African analysts earn per article — making African FX intelligence sellable for the first time.

---

## 📊 Live Stats — Arc Testnet (September 1st, 2026)

| Metric | Value |
|--------|-------|
| 🟢 Markets Created | 6,019+ |
| ✅ Resolution Rate | 100% |
| 💰 Total Volume (TVL) | $17,841+ |
| 👛 Unique Wallets | 160 |
| 🌍 Currency Pairs | 6 |
| ⚡ Agent Uptime | 24/7 |
| 📜 Agent Decisions | 27,780+ |
| ⚡ Autonomous x402 Payments | 20,690+ |
| 💳 Agent Wallet Balance | $380 USDC |
| 🎯 Agent Staked (V2) | $2,098+ USDC |
| 💥 Agent Slashed | $796+ USDC |
| 🎯 Agent Accuracy | 48.8% |
| 📰 Analyst Articles Live | 3 |
| 💸 Total Analyst Earned | $1.20 USDC |

→ **[Live at agorafx.vercel.app](https://agorafx.vercel.app)**

---

## What is AgoraFX?

AgoraFX is the first micro-payment layer for African FX intelligence — where an AI agent autonomously buys and sells rate signals at $0.001 each, stakes its own USDC on every market it creates, human analysts earn per article at $0.05, and every economic decision the agent makes is auditable on-chain.

**Before nanopayments:** African FX intelligence was Bloomberg ($2,000/month) or nothing. No African trader could afford it. No African analyst could earn from individual articles. Sub-cent payments were impossible — gas costs exceeded the value of the transaction.

**After Arc + Circle nanopayments:** Every signal is sellable for $0.001. Every article earns $0.04 for its author. The agent pays for its own data and puts real money behind what it believes.

**Supported pairs:**
- 🇳🇬 USDC/NGN — Nigerian Naira
- 🇬🇭 USDC/GHS — Ghanaian Cedi
- 🇰🇪 USDC/KES — Kenyan Shilling
- 🇿🇦 USDC/ZAR — South African Rand
- 🇪🇬 USDC/EGP — Egyptian Pound
- 🇪🇺 EURC/USDC — Euro Stablecoin

---

## What makes it significant

| Problem | Scale |
|---------|-------|
| African FX volatility | NGN lost 70%+ vs USD in 2023–2024 |
| No on-chain African FX markets | Zero prediction markets exist for NGN, GHS, KES, ZAR, EGP |
| Bloomberg costs $2,000/month | Zero African traders can afford institutional FX intelligence |
| High gas costs on EVM chains | ETH gas makes micro-bet markets unviable — Arc solves this |
| Opaque price discovery | No transparent on-chain feed for African currency pairs |
| Analysts can't earn per article | No payment rail existed for $0.05 per piece — until now |
| Agents automate but never risk anything | AgoraFX's agent stakes real USDC — wrong calls cost it money |

---

## ✨ Features

### 🤖 Autonomous Agent (v1 — complete)
- Creates and resolves markets 24/7 with no manual intervention
- Groq/Llama 3.3 detects FX momentum signals every 5 minutes
- Scheduled fallback markets if no momentum detected
- Groq API key rotation — automatically switches keys on rate limit
- Monitors 6 African currency pairs simultaneously
- 11,000+ autonomous decisions made to date

### 💳 Circle Agent Wallet (v2 — Lepton)
- Agent has its own Circle wallet identity on Arc Testnet
- Wallet: `0xf06774e07888620f2edf0565d1ae24e58778fe19`
- Holds and autonomously spends USDC for rate data and market staking
- Non-custodial — no exposed private keys

### 💸 x402 Nanopayments (v2 — Lepton)
- Agent pays $0.001 per FX rate fetch from its own Circle wallet via x402
- Budget system: pay for fresh data (confidence ≥ 20%) or use cache
- Every economic decision logged with SHA256 hash — fully auditable
- `/rates/signal` exposed as public x402 endpoint — other agents pay to consume
- 1,400+ live autonomous payments made and verifiable on-chain

### 🎯 Agent Stakes USDC Per Market (v2 — Lepton)
- Agent stakes real USDC on every market it creates via `PredictionMarketV2`
- Stake formula: `$0.50 base + (confidence × $0.50)` — higher conviction, higher stake
- $0.20 of every stake seeds YES/NO pools to prevent VOID markets
- Wrong prediction → remaining collateral slashed: 50% to winning bettors, 50% to protocol treasury
- Correct prediction → full collateral returned to agent
- On-chain agent reputation via `getAgentStats()`: total predictions, accuracy, total staked, total slashed, total returned
- V1 contract stays live forever — all existing positions remain claimable

### 📰 Signals — Creator Layer (v2 — RFB 06, Lepton)
- African analysts publish FX commentary on-platform
- Readers pay $0.05 per article via x402 nanopayments
- 80% to analyst instantly (raw on-chain ERC-20 transfer), 20% to protocol treasury
- Server-side wallet-keyed re-read bypass — no re-charge on refresh or device change
- No subscription needed — pay per piece, earn per piece

### 🧠 Decision Engine v3 (June 30, 2026)
- **Root cause fixed:** previous version passed all 6 pairs to one LLM call and asked it to pick one — LLM primacy bias caused EURC (first in list) to be selected 720/731 times over 5 days, leaving GHS/KES/ZAR/NGN with near-zero real evaluation
- **Fix:** one focused LLM call per pair per cycle, pair order randomized each cycle — no positional bias possible
- Every pair now generates independent, genuine hold/create decisions with pair-specific reasoning and confidence
- Fallback gate now works correctly for all pairs (was silently broken for non-EURC pairs that had zero decision history)
- All decisions tagged `source="llm"` vs `source="fallback"` — fully auditable ratio

### 📡 Rate Accuracy
- NGN/GHS/KES/ZAR/EGP: queries Flutterwave + ExchangeRate API + freeforex simultaneously
- NGN: picks highest rate (closest to real Nigerian parallel market rate)
- EURC/USDC: prioritizes Coinbase (live tick) — fixed June 24 after discovering 3 of 4 sources were daily-refresh APIs, causing 0.000% momentum every cycle
- Stale rates automatically overridden by fresher sources

### 🖥️ Frontend
- New homepage — live stats bar, how it works, recently settled markets, analyst signals teaser
- Live scrolling ticker showing all 6 FX pairs in real time
- Markets tab with live YES/NO odds and multipliers (dual V1/V2 contract support)
- Positions tab — Active / Closed split with Claim All button
- Real-time Agent Feed with All / Created / Resolved / Hold filters
- Agent decisions log — PAID / CACHED / HOLD with reasoning hashes
- Signals tab — publish and read FX analysis, paywall + payment receipt UI
- Creator earnings ticker — total USDC earned by African analysts
- Share to X directly from any market card
- Mobile-first responsive design

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity on Arc Testnet (Foundry, via-ir) |
| AI Agent | Python + Groq (Llama 3.3-70b) |
| Backend API | FastAPI + SQLite |
| Frontend | React + Vite + Vercel |
| Blockchain | Arc Testnet (Chain 5042002) |
| Settlement | Circle USDC + EURC |
| Agent Wallet | Circle Agent Wallet (Arc Testnet) |
| Nanopayments | Circle x402 + Gateway |
| Rate Sources | Flutterwave, ExchangeRate API, freeforex, Frankfurter, Coinbase |
| Infrastructure | Oracle Cloud (Ubuntu), systemd, Nginx |

---

## 📋 Contracts (Arc Testnet)

| Contract | Address |
|----------|---------|
| PredictionMarket V1 | [`0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5`](https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5) — all existing positions claimable forever |
| **PredictionMarketV2** | [`0x833C71c1c261857538CEB8877aaFc80A47E66130`](https://testnet.arcscan.app/address/0x833c71c1c261857538ceb8877aafc80a47e66130) — all new markets, agent staking live |
| USDC | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| EURC | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) |

**Agent wallets:**
- Market creation / x402 receiver: `0xca3B6Cc345e82F063EF61d534cAaA36c20c2b061`
- Circle Agent Wallet: `0xf06774e07888620f2edf0565d1ae24e58778fe19`

---

## 🤖 Agent Architecture (v3)

```
┌──────────────────────────────────────────────────────────────────┐
│                     AgoraFX Agent v3                            │
├──────────────────┬─────────────────────┬────────────────────────┤
│  Rate Monitor    │   Decision Engine   │   Market Resolver      │
│  every 30s       │   every 5min        │   every 60s            │
├──────────────────┼─────────────────────┼────────────────────────┤
│ x402 pay $0.001  │ 1 LLM call PER PAIR │ Resolves on correct    │
│ per rate fetch   │ per cycle (6 calls) │ contract (V1 or V2)    │
│ from agent wallet│ Randomized order    │                        │
│                  │ each cycle —        │ Stake returned (right) │
│ Logs: PAID /     │ no positional bias  │ or slashed (wrong) on  │
│ CACHED / HOLD    │                     │ V2 markets             │
│ with SHA256 hash │ Stakes $0.50–$1.00  │                        │
│                  │ USDC per market     │ ABI fixed: 16-field    │
│                  │ created on V2       │ struct, not 15         │
└──────────────────┴─────────────────────┴────────────────────────┘
                            │
                ┌───────────▼──────────┐
                │  /rates/signal API   │
                │  x402 protected      │
                │  $0.001 per call     │
                │  Other agents pay    │
                │  to consume signals  │
                └──────────────────────┘
```

---

## 🎯 Staking Mechanics (PredictionMarketV2)

| Parameter | Value |
|-----------|-------|
| Base stake | $0.50 USDC (confidence = 0) |
| Max stake | $1.00 USDC (confidence = 1.0) |
| Formula | `stake = $0.50 + (confidence × $0.50)` |
| VOID prevention | $0.10 seeded to YES pool + $0.10 to NO pool from stake |
| Slash-able collateral | `stake − $0.20` |
| Wrong prediction | 50% of collateral → winning bettors, 50% → treasury |
| Correct prediction | Full collateral returned to agent |
| Min user bet | $0.10 USDC (lowered from $1.00) |

Every agent's track record is queryable on-chain via `getAgentStats(address)` — total predictions, accuracy, total staked, total slashed, total returned. Full transparency, no trust required.

---

## 🔄 Circle Tools Integration

| Tool | v1 | v2 (Lepton) |
|------|----|-------------|
| Circle USDC | ✅ Settlement token | ✅ + nanopayment + staking unit |
| Circle EURC | ✅ FX pair | ✅ unchanged |
| Arc Contracts | ✅ PredictionMarket v1 | ✅ + PredictionMarketV2 with staking |
| Circle Agent Wallet | ❌ | ✅ `0xf067...fe19` — agent economic identity |
| x402 Protocol | ❌ | ✅ Signal endpoint + article paywall, 1,400+ live payments |
| Gateway Nanopayments | ❌ | ✅ Sub-cent settlement for signals + articles |

---

## 📁 Project Structure

```
agorafx/
├── agent/
│   ├── main.py           # Orchestrator — 3 async loops
│   ├── monitor.py        # Rate polling (4 sources, 6 pairs)
│   ├── decision.py       # Decision engine v3 — per-pair LLM evaluation
│   ├── market.py         # On-chain contract interaction + V1/V2 routing
│   ├── wallet.py         # Circle Agent Wallet wrapper
│   ├── x402_client.py    # x402 outbound payment client
│   ├── decision_log.py   # SHA256 decision audit log
│   ├── db.py             # SQLite layer
│   └── config.py         # Environment + monitored pairs + dual contract addresses
├── backend/
│   ├── main.py           # FastAPI — markets, rates, stats, agent
│   ├── x402_middleware.py # x402 payment middleware — make_x402_guard() factory
│   └── intelligence.py   # Signals / creator layer router
├── contracts/
│   ├── PredictionMarket.sol  # v1 — live forever
│   └── AgoraFxV2.sol         # v2 — staking, slashing, agent reputation
├── frontend/
│   └── src/
│       ├── App.jsx         # Main dApp shell
│       ├── Home.jsx        # Landing page
│       ├── Signals.jsx     # Signals / creator tab
│       ├── onchain.js      # ethers.js — dual contract ABI (16-field V2 fixed)
│       └── share.js        # X/Twitter sharing
└── agorafx.db
```

---

## ⚙️ Setup

### Prerequisites
```bash
pip install web3 httpx python-dotenv fastapi uvicorn groq requests
npm install -g @circle-fin/cli
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git
forge --version  # Foundry required for V2 contract deployment
```

### Environment Variables (`.env`)
```env
# Arc
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc-node.thecanteenapp.com/v1/<key>
DEPLOYER_PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5
CONTRACT_ADDRESS_V2=0x833C71c1c261857538CEB8877aaFc80A47E66130
USDC_ADDRESS=0x3600000000000000000000000000000000000000

# AI
GROQ_API_KEY=gsk_...
GROQ_API_KEY_2=gsk_...
GROQ_API_KEY_3=gsk_...

# Rate sources
FLW_SECRET_KEY=...

# Circle Agent Wallet
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...
CIRCLE_AGENT_WALLET_ID=...
CIRCLE_AGENT_WALLET_ADDRESS=0xf06774e07888620f2edf0565d1ae24e58778fe19

# x402
BACKEND_URL=https://api.kudiarc.xyz
X402_SIGNAL_PRICE_USDC=0.001
X402_ARTICLE_PRICE_USDC=0.05
X402_RECEIVER_ADDRESS=0xca3B6Cc345e82F063EF61d534cAaA36c20c2b061

# Budget
DAILY_BUDGET_USDC=10.0
```

### Run

```bash
git clone https://github.com/MusaAis/agorafx.git
cd agorafx

# Agent
python -m agent.main

# API (separate terminal)
uvicorn backend.main:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend && npm install && npm run dev
```

### Production (systemd)
```bash
sudo systemctl start agorafx      # agent
sudo systemctl start agorafx-api  # backend
```

---

## 🗺️ Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Autonomous agent — 6 African FX pairs, 24/7 | ✅ Complete |
| 2 | On-chain prediction markets — USDC settlement, auto-resolution | ✅ Complete |
| 3 | React frontend — ticker, markets, positions, agent feed | ✅ Complete |
| 4 | Circle Agent Wallet — agent economic identity on Arc | ✅ Complete (Lepton) |
| 5 | x402 nanopayments — agent pays per rate fetch, 1,400+ payments | ✅ Complete (Lepton) |
| 6 | Agent budget system + SHA256 decision log | ✅ Complete (Lepton) |
| 7 | Signals creator layer — RFB 06, analysts earn per article on-chain | ✅ Complete (Lepton) |
| 8 | New homepage — live stats, how it works, analyst signals teaser | ✅ Complete (Lepton) |
| 9 | PredictionMarketV2 — agent stakes USDC per market, slashing + reputation | ✅ Complete (Lepton) |
| 10 | EURC rate fix — prioritize live Coinbase feed over daily-refresh sources | ✅ Complete (Lepton) |
| 11 | V2 ABI fix — 16-field struct, resolver sync working correctly | ✅ Complete (Lepton) |
| 12 | Decision engine v3 — per-pair LLM evaluation, eliminates positional bias | ✅ Complete (Lepton) |
| 13 | Traction push + final Lepton submission | 🔨 July 6 deadline |
| 14 | Arc Mainnet + PostgreSQL | ⏳ Q3 2026 |
| 15 | More African pairs (TZS, UGX, MAD) | ⏳ Q3 2026 |
| 16 | Mobile app | ⏳ Q4 2026 |
| 17 | Beyond FX — crypto prices, commodities, African stock indices | ⏳ 2027 |

---

## 📈 Traction

**Before Lepton — Agora baseline:**
- 119 unique wallets · 2,483 markets · $14,970 TVL · 9,683 bets · 8,032 agent decisions

**During Lepton (June 15 – July 6):**
- 📊 **3,700+ markets** total, **100% resolution rate**, **$17,230+ TVL**, **128 wallets**
- 🧠 **11,000+ autonomous agent decisions** to date
- ⚡ **1,400+ live x402 nanopayments** — agent pays for its own data, $0.001/signal
- 🎯 **$193+ USDC staked** by agent on V2 markets, **$78+ slashed** on wrong predictions
- 📰 **Signals live** — 2 analyst articles, $0.56 USDC earned on-chain by African analysts
- 🔍 **Decision engine v3** — all 6 pairs independently evaluated, bias eliminated

**Recognition:**

- 🏆 **Standout Winner** — Agora Agent Hackathon (Canteen × Arc × Circle)
- 🥉 **3rd Place Winner** — Lepton Agent Hackathon (Canteen × Arc × Circle)
- 📰 Covered by **The Agent Times** — *"architecturally significant for the agent economy"*
- 📣 Launch post **reposted by @arc official account** — 7.4K impressions, 88 likes
- 🔗 Every payment + payout + stake verifiable on [Arc Testnet Explorer](https://testnet.arcscan.app)

---

## 🐛 Bugs Documented (All Phases)

Every bug we hit is documented so future builders skip them:

| Phase | # | Bug | Fix |
|-------|---|-----|-----|
| x402 | 1 | SDK `register()` is V2 only | Use `register_v1()` |
| x402 | 2 | SDK reads `requirements.amount`, V1 has `max_amount_required` | `sed` patch on SDK file |
| x402 | 3 | Backend verified EIP-712 but never called Gateway — USDC never moved | Add `_settle()` call in middleware |
| x402 | 4 | Wrong endpoint `/v1/payments/settle` | Correct: `/v1/x402/settle` |
| x402 | 5 | Gateway wants `resource` as object, not string | Wrap in `{url, description, mimeType}` |
| x402 | 6 | `maxTimeoutSeconds: 60` rejected | Minimum is 7 days — use `608400` |
| x402 | 7 | httpx DNS fails inside uvicorn on Oracle Cloud | `asyncio.to_thread` + blocking `requests` |
| x402 | 8 | Heredoc stray `)` caused SyntaxError | Verify heredoc syntax before deploy |
| V2 deploy | 1 | `forge create --via-ir` miscounts constructor args | Use `forge script` with inline addresses |
| V2 deploy | 2 | `DEPLOYER_PRIVATE_KEY` not exported by `source .env` | Use `set -a; source .env; set +a` |
| V2 deploy | 3 | Solidity scripts require EIP-55 checksummed addresses | Use checksummed case, not lowercase |
| V2 deploy | 4 | `forge verify-contract` can't resolve file path | Set `src = "Contracts"` in `foundry.toml` |
| V2 deploy | 5 | `foundry.toml` duplicate keys from repeated appends | Rewrite file cleanly |
| V2 deploy | 6 | Stack too deep on `Market` struct | Set `via_ir = true` in `foundry.toml` |
| V2 contract | 1 | V2 `getMarket` ABI had 15 fields — struct has 16 (`agentCollateral` missing) | Add `agentCollateral uint256` between `agentStake` and `confidence` in both Python + JS ABI |
| V2 contract | 2 | Missing ABI field caused `getMarket` decode to fail silently — resolver retried already-resolved markets indefinitely | Fix ABI + manually sync stuck DB rows |
| Rate monitor | 1 | EURC sources 3/4 were daily-refresh APIs — Coinbase live tick outvoted by stale median | Prioritize Coinbase when available, daily sources as fallback only |
| Decision engine | 1 | All 6 pairs passed to one LLM call — primacy bias caused EURC to be selected 720/731 times | One focused LLM call per pair per cycle, randomized order |
| Decision engine | 2 | `_consecutive_llm_holds()` returned 0 for pairs with no decision history — fallback gate silently broken | Fixed by v3: all pairs now generate decision rows every cycle |

---

## 🏛️ Arc OSS — Primitives Other Builders Can Fork

1. **Multi-source African FX rate aggregator** — polls 4+ live sources with median/max outlier filtering, live-source prioritization.
2. **Autonomous AI decision engine v3** — per-pair focused LLM evaluation with randomized order, memory, asymmetric thresholds, source-tagged audit trail.
3. **x402 V1 middleware factory** — `make_x402_guard()` FastAPI `Depends()` pattern with per-endpoint price + resource config.
4. **x402 V1 async payment client** — `pay_and_fetch()` using `EthAccountSigner` + Oracle Cloud DNS fix.
5. **Agent staking + slashing contract** — `PredictionMarketV2` with on-chain agent reputation, confidence-weighted stakes, dual-contract migration pattern.
6. **On-chain creator payout pattern** — `BackgroundTasks` ERC-20 transfer after x402 gate, 80/20 split, wallet-keyed re-read bypass.

None of this exists in circlefin/arc-* repos. Full stack open source.

---

## 🏆 Built For

- [Agora Agent Hackathon](https://agora.thecanteenapp.com) — The Canteen × Arc × Circle ✅ Standout Winner
- [Lepton Agents Hackathon](https://lepton.thecanteenapp.com) — Canteen × Circle × Arc ✅️ 3rd Place Winner 

---

## 👤 Builder

Built solo by **Musa Ali** — CS student at Federal University Dutse (FUD). Builder, PenTester & Dev. Appointed Lepton Peer Mentor by Canteen.

Founder of [KudiArc](https://x.com/KudiArc) — Africa-first stablecoin FX swap & remittance protocol on Arc.

- X: [@Musa_Ais](https://x.com/Musa_Ais)
- GitHub: [@MusaAis](https://github.com/MusaAis)

---

⭐ **Star the repo if you find it useful**

Contributions and feedback welcome — open an issue or reach out on X.
