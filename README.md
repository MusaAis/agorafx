# AgoraFX

**African FX Prediction Markets — powered by an autonomous AI agent on Arc Testnet**

> *"An unverified but architecturally significant hackathon project for the agent economy."*
> — [The Agent Times](https://theagenttimes.com/articles/builder-ships-agorafx-an-autonomous-agent-for-african-fx-pre-37eca5a1)

An autonomous AI agent that monitors real-time African FX rates 24/7, detects momentum using Groq + Llama 3.3, and **automatically creates and resolves on-chain prediction markets** — with no human intervention.

---

## 📊 Live Stats

| Metric | Value |
|--------|-------|
| 🟢 Markets Created | 628 |
| ✅ Resolution Rate | 100% |
| 💰 Total Volume (TVL) | $5,700 |
| 🎯 Total Bets | 2,883 |
| 👛 Unique Wallets | 54 |
| 🌍 Currency Pairs | 6 |
| ⚡ Agent Uptime | 24/7 |

→ **[Live at agorafx.vercel.app](https://agorafx.vercel.app)**

---

## What is AgoraFX?

AgoraFX lets anyone bet on African FX rate movements using a fully autonomous AI agent that monitors rates, detects momentum, and creates prediction markets onchain without human intervention.

Users connect a wallet, pick YES or NO, deposit USDC, and earn proportional payouts from the losing pool when they're right. All settlement happens on Arc with sub-second finality and ~$0.01 gas fees.

**Supported pairs:**
- 🇳🇬 USDC/NGN — Nigerian Naira
- 🇬🇭 USDC/GHS — Ghanaian Cedi
- 🇰🇪 USDC/KES — Kenyan Shilling
- 🇿🇦 USDC/ZAR — South African Rand
- 🇪🇬 USDC/EGP — Egyptian Pound
- 🇪🇺 EURC/USDC — Euro

---

## What makes it significant

**African traders** have no way to hedge FX volatility between USDC and African currencies. Traditional prediction markets ignore African currency pairs entirely.

**AgoraFX** is the first autonomous agent-driven prediction market focused entirely on **African FX** — running 24/7 with no human intervention, fully on-chain, USDC-settled.

---

## ✨ Features

**Autonomous Agent**
- Creates and resolves markets 24/7 with no manual intervention
- Groq/Llama 3.3 detects FX momentum signals every 5 minutes
- Scheduled fallback markets if no momentum detected
- Groq API key rotation — automatically switches keys on rate limit
- Monitors 6 African currency pairs simultaneously

**Rate Accuracy**
- NGN/GHS/KES/ZAR/EGP: queries Flutterwave + ExchangeRate API + freeforex simultaneously
- NGN: picks highest rate (closest to real Nigerian black market rate)
- EURC/USDC: queries 4 sources simultaneously, uses median to filter outliers
- Stale rates automatically overridden by fresher sources

**Smart Contracts**
- Fully on-chain prediction markets with USDC settlement
- Auto-seeds YES and NO pools on market creation (1 USDC each)
- 1% protocol fee on winning payouts
- Autonomous resolution via `resolveMarket()` with final observed rate

**Frontend**
- Live scrolling ticker showing all 6 FX pairs in real time
- Markets tab with live YES/NO odds and multipliers
- Positions tab — Active / Closed split with Claim All button
- Real-time Agent Feed with All / Created / Resolved / Hold filters
- Bet modal with live multiplier and estimated payout calculation
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
| Rate Sources | Flutterwave, ExchangeRate API, freeforex, Frankfurter, Coinbase |

---

## 📋 Contracts (Arc Testnet)

| Contract | Address |
|----------|---------|
| PredictionMarket | [`0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5`](https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5) |
| USDC | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| EURC | [`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`](https://testnet.arcscan.app/address/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a) |

Agent wallet: `0xca3B6Cc345e82F063EF61d534cAaA36c20c2b061`

---

## 🤖 Agent Architecture

Three async loops running concurrently:

```
┌─────────────────────────────────────────────────────────┐
│                    AgoraFX Agent                        │
├─────────────────┬───────────────────┬───────────────────┤
│  Rate Monitor   │  Decision Engine  │  Market Resolver  │
│  every 30s      │  every 5min       │  every 60s        │
├─────────────────┼───────────────────┼───────────────────┤
│ Polls 4 sources │ Feeds rates to    │ Checks expired    │
│ simultaneously  │ Llama 3.3         │ markets           │
│                 │                   │                   │
│ 6 pairs:        │ Returns JSON:     │ Calls             │
│ NGN, GHS, KES,  │ create_market     │ resolveMarket()   │
│ ZAR, EGP, EURC  │ or hold           │ with final rate   │
│                 │                   │                   │
│ NGN: picks      │ Fallback: creates │ Marks outcome     │
│ highest rate    │ scheduled market  │ YES/NO/VOID       │
│ Others: median  │ if none active    │ in DB             │
└─────────────────┴───────────────────┴───────────────────┘
```

---

## 🔄 Circle / Arc Tools Used

- **USDC** — settlement token for all bets and payouts
- **EURC** — primary FX pair (EURC/USDC)
- **Arc Testnet** — sub-second finality, gas paid in USDC (~$0.01/tx)
- **Paymaster** — USDC gas fees make high-frequency agent transactions viable

> **Note on Circle UCW:** Circle Programmable Wallets were integrated during development. We got wallet creation, PIN setup, and persistent login working. However, Circle UCW testnet runs on ETH-SEPOLIA — not Arc — making it impossible to sign Arc transactions from Circle wallets today. We're removing it until Circle adds Arc testnet support. [@circle](https://x.com/circle) — this would unlock a whole class of African FX apps.

---

## 📁 Project Structure

```
agorafx/
├── agent/
│   ├── main.py          # Orchestrator — 3 async loops
│   ├── monitor.py       # Rate polling (4 sources, 6 pairs)
│   ├── decision.py      # Groq/Llama market creation logic
│   ├── market.py        # On-chain contract interaction
│   ├── db.py            # SQLite layer
│   └── config.py        # Environment + monitored pairs
├── backend/
│   └── main.py          # FastAPI — markets, rates, stats, agent endpoints
├── contracts/
│   └── PredictionMarket.sol
├── frontend/
│   └── src/
│       ├── App.jsx      # Main UI — ticker, markets, positions, feed
│       ├── onchain.js   # ethers.js contract helpers
│       └── share.js     # X/Twitter sharing
└── agorafx.db           # SQLite database
```

---

## ⚙️ Setup

### Prerequisites
```bash
pip install web3 httpx python-dotenv fastapi uvicorn groq requests
```

### Environment Variables (`.env`)
```env
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
DEPLOYER_PRIVATE_KEY=0x...
PREDICTION_MARKET_ADDRESS=0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5
GROQ_API_KEY=gsk_...
GROQ_API_KEY_2=gsk_...        # Optional: second key for rotation
FLW_SECRET_KEY=...             # Optional: Flutterwave for NGN rates
```

### Run

```bash
# Clone
git clone https://github.com/MusaAis/agorafx.git
cd agorafx

# Run agent
python -m agent.main

# Run API (separate terminal)
uvicorn backend.main:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend && npm install && npm run dev
```

### Production (systemd)
```bash
# Agent
sudo systemctl start agorafx

# API
sudo systemctl start agorafx-api
```

---

## 📈 Traction

- Covered by **The Agent Times** — *"architecturally significant for the agent economy"*
- Launch post **reposted by @arc official account** — 6.1K impressions, 81 likes, 13 reposts
- **628 markets** resolved with 100% resolution rate
- **54 unique wallets** verified on-chain via contract event logs
- **$5,700 TVL**, **2,883 total bets**

---

## 🏛️ Arc OSS

AgoraFX exposes three primitives other builders can fork:

1. **Multi-source FX rate aggregator** — polls 4+ live sources with median/max outlier filtering. Reusable for any price-feed agent on Arc.
2. **Autonomous AI decision engine** — Groq/Llama converts price signals into on-chain actions with no human in the loop. Reusable for any agent-driven protocol.
3. **Prediction market Solidity contract** — USDC settlement, auto-seeding, proportional payout logic. Reusable for any prediction market on Arc.

None of this exists in circlefin/arc-* repos. Full stack open source.

---

## 🏆 Built For

[Agora Agent Hackathon](https://agora.thecanteenapp.com) by The Canteen × Arc × Circle

---

## 👤 Builder

Built solo by **Musa Ali** — 20 years old, Nigeria.
Founder of [KudiArc](https://kudiarc.xyz) — Africa's stablecoin FX desk on Arc.

- X: [@Musa_Ais](https://x.com/Musa_Ais)
- GitHub: [@MusaAis](https://github.com/MusaAis)

---

⭐ **Star the repo if you find it useful**

Contributions and feedback welcome — open an issue or reach out on X.
