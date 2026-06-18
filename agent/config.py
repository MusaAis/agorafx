import os
from dotenv import load_dotenv

load_dotenv()

# ── Arc / Contract ────────────────────────────────────────────────
RPC_URL               = os.getenv("ARC_TESTNET_RPC_URL")
PRIVATE_KEY           = os.getenv("DEPLOYER_PRIVATE_KEY")

# V1 — stays live, users claim existing positions
CONTRACT_ADDRESS_V1   = os.getenv(
    "PREDICTION_MARKET_ADDRESS",
    "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5"
)
# V2 — agent creates all new markets here
CONTRACT_ADDRESS_V2   = os.getenv(
    "PREDICTION_MARKET_V2_ADDRESS",
    "0x833C71c1c261857538CEB8877aaFc80A47E66130"
)
# Active contract for new market creation
CONTRACT_ADDRESS      = CONTRACT_ADDRESS_V2

USDC_ADDRESS          = os.getenv("USDC_ADDRESS", "0x3600000000000000000000000000000000000000")
EURC_ADDRESS          = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"

# ── AI ────────────────────────────────────────────────────────────
GROQ_API_KEY          = os.getenv("GROQ_API_KEY")

# ── Timing ────────────────────────────────────────────────────────
MONITOR_INTERVAL_SEC  = 30
DECISION_INTERVAL_SEC = 300
RESOLVER_INTERVAL_SEC = 60

# ── Market params ─────────────────────────────────────────────────
MARKET_DURATION_SEC   = 3600
MIN_RATE_CHANGE_PCT   = 0.15
DECISION_LOOKBACK     = 20
RATE_SCALE            = 1_000_000

# ── Monitored pairs ───────────────────────────────────────────────
MONITORED_PAIRS = [
    {"pair": "USDC/EURC", "source": "okx_eurusdt",      "label": "EURC/USDC"},
    {"pair": "USDC/NGN",  "source": "flutterwave_ngn",  "label": "NGN per USDC"},
    {"pair": "USDC/GHS",  "source": "exchangerate_ghs", "label": "GHS per USDC"},
    {"pair": "USDC/KES",  "source": "exchangerate_kes", "label": "KES per USDC"},
    {"pair": "USDC/ZAR",  "source": "exchangerate_zar", "label": "ZAR per USDC"},
    {"pair": "USDC/EGP",  "source": "exchangerate_egp", "label": "EGP per USDC"},
]

# ── Circle Agent Wallet ───────────────────────────────────────────
CIRCLE_API_KEY              = os.getenv("CIRCLE_API_KEY")
CIRCLE_ENTITY_SECRET        = os.getenv("CIRCLE_ENTITY_SECRET")
CIRCLE_WALLET_SET_ID        = os.getenv("CIRCLE_WALLET_SET_ID")
CIRCLE_AGENT_WALLET_ID      = os.getenv("CIRCLE_AGENT_WALLET_ID")
CIRCLE_AGENT_WALLET_ADDRESS = os.getenv("CIRCLE_AGENT_WALLET_ADDRESS")

AGENT_WALLET_ADDRESS        = CIRCLE_AGENT_WALLET_ADDRESS
AGENT_WALLET_ID             = CIRCLE_AGENT_WALLET_ID

DAILY_BUDGET_USDC           = float(os.getenv("DAILY_BUDGET_USDC", "10.0"))
MIN_WALLET_BALANCE_USDC     = 0.05

# ── x402 ─────────────────────────────────────────────────────────
BACKEND_URL              = os.getenv("BACKEND_URL", "http://localhost:8000")
X402_FACILITATOR_URL     = os.getenv("X402_FACILITATOR_URL", "https://facilitator.circle.com")
X402_SIGNAL_PRICE_USDC   = float(os.getenv("X402_SIGNAL_PRICE_USDC",  "0.001"))
X402_ARTICLE_PRICE_USDC  = float(os.getenv("X402_ARTICLE_PRICE_USDC", "0.05"))
X402_RECEIVER_ADDRESS    = os.getenv("X402_RECEIVER_ADDRESS", AGENT_WALLET_ADDRESS)