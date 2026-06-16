# AgoraFX

**African FX Intelligence Marketplace — autonomous AI agent + nanopayments on Arc**

> *"An unverified but architecturally significant hackathon project for the agent economy."*
> — [The Agent Times](https://theagenttimes.com/articles/builder-ships-agorafx-an-autonomous-agent-for-african-fx-pre-37eca5a1)

> ** v1 Built for** — [Agora Agent Hackathon](https://agora.thecanteenapp.com) by The Canteen × Arc × Circle
> 🔨 **Currently building v2** — [Lepton Agents Hackathon](https://lepton.thecanteenapp.com) by Canteen × Circle × Arc

An autonomous AI agent that monitors real-time African FX rates 24/7, detects momentum using Groq + Llama 3.3, and **automatically creates and resolves on-chain prediction markets** — with no human intervention.

**v2 (Lepton):** The agent now has its own Circle wallet, pays for rate data autonomously via x402 nanopayments, stakes USDC on every market it creates, and African analysts earn per article — making African FX intelligence sellable for the first time.

---

## 📊 Live Stats — Arc Testnet (June 2026)

| Metric | Value |
|--------|-------|
| 🟢 Markets Created | 3,012 |
| ✅ Resolution Rate | 100% |
| 💰 Total Volume (TVL) | $14,970 |
| 🎯 Total Bets | 9,988 |
| 👛 Unique Wallets | 119 |
| 🌍 Currency Pairs | 6 |
| ⚡ Agent Uptime | 24/7 |
| 📜 Agent Decisions | 9,601 |
| ⚡ Autonomous x402 Payments | 90+ |
| 💳 Agent Wallet Balance | $260 USDC |

→ **[Live at agorafx.vercel.app](https://agorafx.vercel.app)**

---

## What is AgoraFX?

AgoraFX is the first micro-payment layer for African FX intelligence — where an AI agent autonomously buys and sells rate signals at $0.001 each, human analysts earn per article at $0.05, and every economic decision the agent makes is auditable on-chain.

**Before nanopayments:** African FX intelligence was Bloomberg ($2,000/month) or nothing. No African trader could afford it. No African analyst could earn from individual articles. Sub-cent payments were impossible — gas costs exceeded the value of the transaction.

**After Arc + Circle nanopayments:** Every signal is sellable for $0.001. Every article earns $0.04 for its author. The agent pays for its own data and stakes on what it believes.

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

---

## ✨ Features

### 🤖 Autonomous Agent (v1 — complete)
- Creates and resolves markets 24/7 with no manual intervention
- Groq/Llama 3.3 detects FX momentum signals every 5 minutes
- Scheduled fallback markets if no momentum detected
- Groq API key rotation — automatically switches keys on rate limit
- Monitors 6 African currency pairs simultaneously
- 8,560 autonomous decisions made to date

### 💳 Circle Agent Wallet (v2 — Lepton)
- Agent has its own Circle wallet identity on Arc Testnet
- Wallet: `0xf06774e07888620f2edf0565d1ae24e58778fe19`
- Holds and autonomously spends USDC for rate data and market staking
- Non-custodial — no exposed private keys

### 💸 x402 Nanopayments (v2 — Lepton, building)
- Agent pays $0.001 per FX rate fetch from its own Circle wallet via x402
- Budget system: pay for fresh data (confidence ≥ 20%) or use cache
- Every economic decision logged with SHA256 hash — fully auditable
- `/rates/signal` exposed as public x402 endpoint — other agents pay to consume

### 🎯 Agent Stakes USDC (v2 — Lepton, building)
- Agent stakes USDC on every market it creates
- Wrong predictions → stake slashed to protocol treasury
- Real skin in the game — not just automation

### 📰 Market Intelligence — RFB 06 (v2 — Lepton, building)
- African analysts publish FX commentary on-platform
- Readers pay $0.05 per article via x402 nanopayments
- 80% to analyst instantly, 20% to protocol treasury
- No subscription needed — pay per piece, earn per piece

### 📡 Rate Accuracy
- NGN/GHS/KES/ZAR/EGP: queries Flutterwave + ExchangeRate API + freeforex simultaneously
- NGN: picks highest rate (closest to real Nigerian parallel market rate)
- EURC/USDC: queries 4 sources simultaneously, uses median to filter outliers
- Stale rates automatically overridden by fresher sources

### 🖥️ Frontend
- Live scrolling ticker showing all 6 FX pairs in real time
- Markets tab with live YES/NO odds and multipliers
- Positions tab — Active / Closed split with Claim All button
- Real-time Agent Feed with All / Created / Resolved / Hold filters
- Agent decisions log — PAID / CACHED / HOLD with reasoning hashes
- Market Intelligence tab — publish and read FX analysis
- Creator earnings ticker — total USDC earned by African analysts
- Share to X directly from any market card
- Mobile-first responsive design

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity on Arc Testnet |
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
| PredictionMarket v1 | [`0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5`](https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5) |
| AgoraFx v2 | `🔨 deploying — adds USDC staking logic` |
| USDC | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| EURC | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) |

**Agent wallets:**
- Market creation wallet: `0xca3B6Cc345e82F063EF61d534cAaA36c20c2b061`
- Circle Agent Wallet (v2): `0xf06774e07888620f2edf0565d1ae24e58778fe19`

---

## 🤖 Agent Architecture (v2)

```
┌──────────────────────────────────────────────────────────────────┐
│                       AgoraFX Agent v2                          │
├──────────────────┬─────────────────────┬────────────────────────┤
│  Rate Monitor    │   Decision Engine   │   Market Resolver      │
│  every 30s       │   every 5min        │   every 60s            │
├──────────────────┼─────────────────────┼────────────────────────┤
│ x402 pay $0.001  │ Budget: pay vs cache│ Resolves expired       │
│ per rate fetch   │ Confidence ≥ 20%    │ markets on-chain       │
│ from agent wallet│ → pay for fresh     │                        │
│                  │ < 20% → use cache   │ Stakes returned or     │
│ Logs: PAID /     │                     │ slashed based on       │
│ CACHED / HOLD    │ Stakes USDC on each │ market quality         │
│ with SHA256 hash │ market created      │                        │
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

## 🔄 Circle Tools Integration

| Tool | v1 | v2 (Lepton) |
|------|----|-------------|
| Circle USDC | ✅ Settlement token | ✅ + nanopayment unit |
| Circle EURC | ✅ FX pair | ✅ unchanged |
| Arc Contracts | ✅ PredictionMarket v1 | ✅ + v2 with staking |
| Circle Agent Wallet | ❌ | ✅ `0xf067...fe19` — agent economic identity |
| x402 Protocol | ❌ | 🔨 Signal endpoint + article paywall |
| Gateway Nanopayments | ❌ | 🔨 Sub-cent bet placement + signal pricing |

---

## 📁 Project Structure

```
agorafx/
├── agent/
│   ├── main.py           # Orchestrator — 3 async loops
│   ├── monitor.py        # Rate polling (4 sources, 6 pairs)
│   ├── decision.py       # Groq/Llama market creation + budget logic
│   ├── market.py         # On-chain contract interaction + staking
│   ├── wallet.py         # Circle Agent Wallet wrapper (v2)
│   ├── x402_client.py    # x402 outbound payment client (v2)
│   ├── decision_log.py   # SHA256 decision audit log (v2)
│   ├── db.py             # SQLite layer
│   └── config.py         # Environment + monitored pairs
├── backend/
│   ├── main.py           # FastAPI — markets, rates, stats, agent
│   ├── x402_middleware.py # x402 payment middleware (v2)
│   └── intelligence.py   # Market Intelligence CRUD (v2)
├── contracts/
│   ├── PredictionMarket.sol    # v1 — live
│   └── AgoraFxV2.sol  # v2 — with staking (building)
├── frontend/
│   └── src/
│       ├── App.jsx        # Main UI
│       ├── Intelligence.jsx # Market Intelligence tab (v2)
│       ├── onchain.js     # ethers.js helpers
│       └── share.js       # X/Twitter sharing
└── agorafx.db
```

---

## ⚙️ Setup

### Prerequisites
```bash
pip install web3 httpx python-dotenv fastapi uvicorn groq requests
npm install -g @circle-fin/cli
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git
```

### Environment Variables (`.env`)
```env
# Arc
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
DEPLOYER_PRIVATE_KEY=0x...
PREDICTION_MARKET_ADDRESS=0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5

# AI
GROQ_API_KEY=gsk_...
GROQ_API_KEY_2=gsk_...

# Rate sources
FLW_SECRET_KEY=...

# Circle Agent Wallet (v2)
CIRCLE_API_KEY=...
CIRCLE_AGENT_WALLET_ID=...
CIRCLE_AGENT_WALLET_ADDRESS=0xf06774e07888620f2edf0565d1ae24e58778fe19

# x402 (v2)
X402_SIGNAL_PRICE_USDC=0.001
X402_ARTICLE_PRICE_USDC=0.05
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
| 5 | x402 nanopayments — agent pays per rate fetch, 90+ payments made | ✅ Complete (Lepton) |
| 6 | Agent budget system + SHA256 decision log | ✅ Complete (Lepton) |
| 7 | Market Intelligence tab — RFB 06 creator layer | 🔨 Building (Lepton) |
| 8 | Agent USDC staking — skin in the game per market | 🔨 Building (Lepton) |
| 9 | Arc Mainnet + PostgreSQL | ⏳ |
| 10 | More African pairs (TZS, UGX, MAD) | ⏳ Q3 2026 |
| 11 | Mobile app | ⏳ Q4 2026 |
| 12 | Beyond FX — crypto prices, commodities, African stock indices | ⏳ 2027 |

---

## 📈 Traction

- 🔨 **Active builder** — Lepton Agents Hackathon (June 15–29, 2026)
- 📰 Covered by **The Agent Times** — *"architecturally significant for the agent economy"*
- 📣 Launch post **reposted by @arc official account** — 7.4K impressions, 88 likes, 13 reposts
- 📊 **3,012 markets** created autonomously, **100% resolution rate**
- 💰 **$14,970 TVL**, **9,988 total bets**, **119 unique wallets**
- 🧠 **9,601 autonomous agent decisions** to date
- ⚡ **90+ live x402 nanopayments** — agent pays for its own data autonomously
- 💳 **$260 USDC** in Circle Agent Wallet — agent holds and spends its own money
- 🔗 Every payment verifiable on [Arc Testnet Explorer](https://testnet.arcscan.app)

---

## 🐛 x402 Integration — Bugs Documented

Every bug we hit building x402 on Arc is documented here so future builders skip them:

| # | Bug | Fix |
|---|-----|-----|
| 1 | x402 SDK `register()` is V2 only | Use `register_v1()` for the protocol |
| 2 | SDK 2.13.0 reads `requirements.amount` but V1 uses `max_amount_required` | Patch SDK with single `sed` command |
| 3 | Backend verified EIP-712 but never called Gateway to settle — USDC never moved | Call Gateway settle after signature verification |
| 4 | Wrong endpoint `/v1/payments/settle` | Correct: `/v1/x402/settle` |
| 5 | Gateway wants resource as object `{url, description, mimeType}` | Not a plain string |
| 6 | `maxTimeoutSeconds: 60` rejected by Gateway | Gateway requires minimum 7 days validity |
| 7 | Python httpx DNS fails inside uvicorn for `gateway-api-testnet.circle.com` | Fix: `asyncio.to_thread` + blocking requests to bypass async resolver |
| 8 | Heredoc deployment introduced stray `)` | Took 30 mins to find — check heredoc syntax carefully |

---



AgoraFX exposes four primitives other builders can fork:

1. **Multi-source African FX rate aggregator** — polls 4+ live sources with median/max outlier filtering. Reusable for any price-feed agent on Arc.
2. **Autonomous AI decision engine** — Groq/Llama converts price signals into on-chain actions with no human in the loop.
3. **Prediction market Solidity contract** — USDC settlement, auto-seeding, proportional payout logic.
4. **x402 agent payment client** — EIP-712 based autonomous nanopayment flow for any Python agent on Arc. *(v2)*

None of this exists in circlefin/arc-* repos. Full stack open source.

---

## 🏆 Built For

- [Agora Agent Hackathon](https://agora.thecanteenapp.com) — The Canteen × Arc × Circle ✅
- [Lepton Agents Hackathon](https://lepton.thecanteenapp.com) — Canteen × Circle × Arc 🔨 Active

---

## 👤 Builder

Built solo by **Musa Ali** — CS student at Federal University Dutse (FUD). Builder, PenTester & Dev.

Founder of [KudiArc](https://x.com/KudiArc) — Africa-first stablecoin FX swap & remittance protocol on Arc.

- X: [@Musa_Ais](https://x.com/Musa_Ais)
- GitHub: [@MusaAis](https://github.com/MusaAis)

---

⭐ **Star the repo if you find it useful**

Contributions and feedback welcome — open an issue or reach out on X.
