# AgoraFX

**The first AI agent that autonomously pays for its own data, stakes on its own markets, and lets African analysts earn per article — on Arc, in USDC**

> *"An unverified but architecturally significant hackathon project for the agent economy."*
> — [The Agent Times](https://theagenttimes.com/articles/builder-ships-agorafx-an-autonomous-agent-for-african-fx-pre-37eca5a1)

> 🏆 **Standout Winner** — [Agora Agent Hackathon](https://agora.thecanteenapp.com) by The Canteen × Arc × Circle
> 🔨 **Currently building** — [Lepton Agents Hackathon](https://lepton.thecanteenapp.com) by Canteen × Circle × Arc

An autonomous AI agent that monitors real-time African FX rates 24/7, detects momentum using Groq + Llama 3.3, and **automatically creates and resolves on-chain prediction markets** — with no human intervention.

**v2 (Lepton):** The agent now has its own Circle wallet, pays for rate data autonomously via x402 nanopayments, **stakes its own USDC on every market it creates** (wrong predictions get slashed), and African analysts earn per article — making African FX intelligence sellable for the first time.

---

## 📊 Live Stats — Arc Testnet (June 18, 2026)

| Metric | Value |
|--------|-------|
| 🟢 Markets Created | 3,289+ |
| ✅ Resolution Rate | 100% |
| 💰 Total Volume (TVL) | $17,048 |
| 👛 Unique Wallets | 125 |
| 🌍 Currency Pairs | 6 |
| ⚡ Agent Uptime | 24/7 |
| 📜 Agent Decisions | 10,344+ |
| ⚡ Autonomous x402 Payments | 828+ |
| 💳 Agent Wallet Balance | $260 USDC |
| 📰 Analyst Articles Live | 2 |
| 👁️ Article Reads | 10 |
| 💸 Total Analyst Earned | $0.36 USDC |
| 🎯 Agent-Staked Markets (V2) | Live — first market deployed |

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
- 10,344+ autonomous decisions made to date

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
- 828+ live autonomous payments made and verifiable on-chain

### 🎯 Agent Stakes USDC Per Market (v2 — Lepton, NEW)
- Agent stakes real USDC on every market it creates via `PredictionMarketV2`
- Stake formula: `$0.50 base + (confidence × $0.50)` — higher conviction, higher stake
- $0.20 of every stake seeds YES/NO pools to prevent VOID markets
- Wrong prediction → remaining collateral slashed: 50% to winning bettors, 50% to protocol treasury
- Correct prediction → full collateral returned to agent
- On-chain agent reputation via `getAgentStats()`: total predictions, accuracy, total staked, total slashed, total returned
- V1 contract stays live forever — all existing positions remain claimable
- First V2 market live: [`0x3fa614a...4986f56`](https://testnet.arcscan.app/tx/0x3fa614adc8df239707b6c314a9618944b1d273bfec563152ab938309e4986f56)

### 📰 Signals — Creator Layer (v2 — RFB 06, Lepton)
- African analysts publish FX commentary on-platform
- Readers pay $0.05 per article via x402 nanopayments
- 80% to analyst instantly (raw on-chain ERC-20 transfer), 20% to protocol treasury
- Server-side wallet-keyed re-read bypass — no re-charge on refresh or device change
- No subscription needed — pay per piece, earn per piece
- First live article: *"NGN Parallel Market at ₦1,400"* — 8 paid reads, $0.32 USDC earned

### 📡 Rate Accuracy
- NGN/GHS/KES/ZAR/EGP: queries Flutterwave + ExchangeRate API + freeforex simultaneously
- NGN: picks highest rate (closest to real Nigerian parallel market rate)
- EURC/USDC: queries 4 sources simultaneously, uses median to filter outliers
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

**First V2 staked market:** [`0x3fa614adc8df239707b6c314a9618944b1d273bfec563152ab938309e4986f56`](https://testnet.arcscan.app/tx/0x3fa614adc8df239707b6c314a9618944b1d273bfec563152ab938309e4986f56)

---

## 🤖 Agent Architecture (v2)

```
┌──────────────────────────────────────────────────────────────────┐
│                       AgoraFX Agent v2                          │
├──────────────────┬─────────────────────┬────────────────────────┤
│  Rate Monitor    │   Decision Engine   │   Market Resolver      │
│  every 30s       │   every 5min        │   every 60s            │
├──────────────────┼─────────────────────┼────────────────────────┤
│ x402 pay $0.001  │ Budget: pay vs cache│ Resolves on correct    │
│ per rate fetch   │ Confidence ≥ 20%    │ contract (V1 or V2)    │
│ from agent wallet│ → pay for fresh     │                        │
│                  │ < 20% → use cache   │ Stake returned (right) │
│ Logs: PAID /     │                     │ or slashed (wrong) on  │
│ CACHED / HOLD    │ Stakes $0.50–$1.00  │ V2 markets             │
│ with SHA256 hash │ USDC per market     │                        │
│                  │ created on V2       │                        │
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

**Example at confidence = 0.73:**
Agent pulls $0.865 USDC total → $0.20 seeds both pools → $0.665 at risk. Wrong: $0.332 to bettors + $0.332 to treasury. Right: full $0.665 returned.

Every agent's track record is queryable on-chain via `getAgentStats(address)` — total predictions, accuracy, total staked, total slashed, total returned. Full transparency, no trust required.

---

## 🔄 Circle Tools Integration

| Tool | v1 | v2 (Lepton) |
|------|----|-------------|
| Circle USDC | ✅ Settlement token | ✅ + nanopayment + staking unit |
| Circle EURC | ✅ FX pair | ✅ unchanged |
| Arc Contracts | ✅ PredictionMarket v1 | ✅ + PredictionMarketV2 with staking |
| Circle Agent Wallet | ❌ | ✅ `0xf067...fe19` — agent economic identity |
| x402 Protocol | ❌ | ✅ Signal endpoint + article paywall, 828+ live payments |
| Gateway Nanopayments | ❌ | ✅ Sub-cent settlement for signals + articles |

---

## 📁 Project Structure

```
agorafx/
├── agent/
│   ├── main.py           # Orchestrator — 3 async loops
│   ├── monitor.py        # Rate polling (4 sources, 6 pairs)
│   ├── decision.py       # Groq/Llama market creation + budget logic
│   ├── market.py         # On-chain contract interaction + V1/V2 staking routing
│   ├── wallet.py         # Circle Agent Wallet wrapper
│   ├── x402_client.py    # x402 outbound payment client
│   ├── decision_log.py   # SHA256 decision audit log
│   ├── db.py             # SQLite layer + contract_version column
│   └── config.py         # Environment + monitored pairs + dual contract addresses
├── backend/
│   ├── main.py           # FastAPI — markets, rates, stats, agent (dual contract aware)
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
│       ├── onchain.js      # ethers.js — dual contract ABI + routing
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

### Deploy V2 contract
```bash
forge clean && forge build
forge script scripts/deploy_v2.sol:DeployV2 \
  --rpc-url "$ARC_TESTNET_RPC_URL" \
  --private-key "$PKEY" \
  --via-ir \
  --broadcast
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
| 5 | x402 nanopayments — agent pays per rate fetch, 828+ payments made | ✅ Complete (Lepton) |
| 6 | Agent budget system + SHA256 decision log | ✅ Complete (Lepton) |
| 7 | Signals creator layer — RFB 06, analysts earn per article on-chain | ✅ Complete (Lepton) |
| 8 | New homepage — live stats, how it works, analyst signals teaser | ✅ Complete (Lepton) |
| 9 | **PredictionMarketV2 — agent stakes USDC per market, slashing + reputation** | ✅ Complete (Lepton) |
| 10 | Traction push + Lepton submission | 🔨 June 29 deadline |
| 11 | Arc Mainnet + PostgreSQL | ⏳ 2026 |
| 12 | More African pairs (TZS, UGX, MAD) | ⏳ Q3 2026 |
| 13 | Mobile app | ⏳ Q4 2026 |
| 14 | Beyond FX — crypto prices, commodities, African stock indices | ⏳ 2027 |

---

## 📈 Traction

**Before Lepton — Agora baseline:**
- 119 unique wallets · 2,483 markets · $14,970 TVL · 9,683 bets · 8,032 agent decisions

**During Lepton (June 15–18):**
- 📊 **3,289+ markets** total, **100% resolution rate**, **$17,048 TVL**, **125 wallets**
- 🧠 **10,344+ autonomous agent decisions** to date
- ⚡ **828+ live x402 nanopayments** — agent pays for its own data, $0.001/signal
- 📰 **Signals live** — 2 analyst article, 7 paid reads, $0.36 USDC earned on-chain
- 🎯 **PredictionMarketV2 deployed** — first agent-staked market live on-chain

**Recognition:**
- 🏆 **Standout Winner** — Agora Agent Hackathon (Canteen × Arc × Circle)
- 📰 Covered by **The Agent Times** — *"architecturally significant for the agent economy"*
- 📣 Launch post **reposted by @arc official account** — 7.4K impressions, 88 likes
- 🤝 **Appointed Lepton Peer Mentor** by Canteen — announced in #announcements
- 🔗 Every payment + payout + stake verifiable on [Arc Testnet Explorer](https://testnet.arcscan.app)

---

## 🐛 Bugs Documented (All Phases)

Every bug we hit building on Arc + Circle is documented so future builders skip them:

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
| V2 deploy | 7 | V2 `getMarket` ABI (15 fields) vs V1 (11 fields) — decode mismatch | Separate `POSITION_ABI_V1` / `POSITION_ABI_V2` |

---

## 🏛️ Arc OSS — Primitives Other Builders Can Fork

1. **Multi-source African FX rate aggregator** — polls 4+ live sources with median/max outlier filtering.
2. **Autonomous AI decision engine** — Groq/Llama converts price signals into on-chain actions with no human in the loop.
3. **x402 V1 middleware factory** — `make_x402_guard()` FastAPI `Depends()` pattern with per-endpoint price + resource config.
4. **x402 V1 async payment client** — `pay_and_fetch()` using `EthAccountSigner` + Oracle Cloud DNS fix.
5. **Agent staking + slashing contract** — `PredictionMarketV2` with on-chain agent reputation (`getAgentStats()`), confidence-weighted stakes, dual-contract migration pattern.
6. **On-chain creator payout pattern** — `BackgroundTasks` ERC-20 transfer after x402 gate, 80/20 split, wallet-keyed re-read bypass.

None of this exists in circlefin/arc-* repos. Full stack open source.

---

## 🏆 Built For

- [Agora Agent Hackathon](https://agora.thecanteenapp.com) — The Canteen × Arc × Circle ✅ Standout Winner
- [Lepton Agents Hackathon](https://lepton.thecanteenapp.com) — Canteen × Circle × Arc 🔨 Active

---

## 👤 Builder

Built solo by **Musa Ali** — CS student at Federal University Dutse (FUD). Builder, PenTester & Dev. Appointed Lepton Peer Mentor by Canteen.

Founder of [KudiArc](https://x.com/KudiArc) — Africa-first stablecoin FX swap & remittance protocol on Arc.

- X: [@Musa_Ais](https://x.com/Musa_Ais)
- GitHub: [@MusaAis](https://github.com/MusaAis)

---

⭐ **Star the repo if you find it useful**

Contributions and feedback welcome — open an issue or reach out on X.
