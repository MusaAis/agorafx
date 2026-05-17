# AgoraFX

**African FX Prediction Markets — powered by an autonomous AI agent on Arc Testnet**

Live at: [agorafx.vercel.app](https://agorafx.vercel.app)

---

## What is AgoraFX?

AgoraFX lets anyone bet on African FX rate movements — USDC/EURC and USDC/NGN — using a fully autonomous AI agent that monitors rates, detects momentum, and creates prediction markets onchain without human intervention.

Users connect a wallet, pick YES or NO, deposit USDC, and earn proportional payouts from the losing pool when they're right. All settlement happens on Arc with sub-second finality and ~$0.01 gas fees.

---

## How it works

```
OKX / Flutterwave          AI Agent (Groq/Llama 3.3)       Arc Testnet
─────────────────    →    ──────────────────────────    →   ────────────────
Rate feed every 30s        Detects momentum signals         PredictionMarket.sol
EURC/USDC + NGN/USDC       Creates market if signal         USDC settlement
                           Resolves at expiry               Sub-second finality
```

---

## Stack

| Layer | Tech |
|-------|------|
| Smart Contract | Solidity 0.8.20, OpenZeppelin, Arc Testnet |
| AI Agent | Python, Groq (Llama 3.3 70B), asyncio |
| Rate Feeds | OKX API (EURC), Flutterwave (NGN) |
| Backend | FastAPI, SQLite, Oracle Cloud |
| Frontend | React, ethers.js, Vercel |

---

## Contracts (Arc Testnet)

| Contract | Address |
|----------|---------|
| PredictionMarket | [`0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5`](https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5) |
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |

---

## Architecture

```
agorafx/
├── agent/
│   ├── main.py        # Orchestrator — 3 async loops
│   ├── monitor.py     # Rate polling every 30s
│   ├── decision.py    # Groq/Llama decision engine (5min)
│   ├── market.py      # On-chain market creation & resolution
│   ├── db.py          # SQLite layer
│   └── config.py      # Environment config
├── backend/
│   └── main.py        # FastAPI REST API
├── contracts/
│   └── PredictionMarket.sol
└── frontend/
    └── src/App.jsx    # React + ethers.js
```

---

## Agent Logic

The AI agent runs three concurrent loops:

- **Rate Monitor (30s):** Polls EURC/USDC from OKX and USDC/NGN from Flutterwave
- **Decision Engine (5min):** Feeds recent rate history to Llama 3.3, which returns a structured JSON decision on whether to open a market and with what parameters. Falls back to a scheduled market if no momentum is detected and no active market exists
- **Resolver (60s):** Checks for expired markets and calls `resolveMarket()` with the final observed rate

---

## Circle Tools Used

- **USDC** — settlement token for all bets and payouts
- **EURC** — primary FX pair (EURC/USDC)
- **App Kit** — wallet connection and transaction signing
- **Paymaster** — USDC gas fees on Arc (~$0.01 per tx)

---

## Setup

```bash
# Install dependencies
pip install web3 httpx python-dotenv anthropic fastapi uvicorn groq

# Environment variables (.env)
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
DEPLOYER_PRIVATE_KEY=0x...
PREDICTION_MARKET_ADDRESS=0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5
GROQ_API_KEY=...
FLW_SECRET_KEY=...  # Optional: Flutterwave for NGN rates

# Run agent
python -m agent.main

# Run API
uvicorn backend.main:app --host 0.0.0.0 --port 8001
```

---

## Built for

[Agora Agent Hackathon](https://agora.thecanteenapp.com) by The Canteen × Arc — May 2026

Built by [@MusaAis](https://github.com/MusaAis) 
