import os
from dotenv import load_dotenv

load_dotenv()

# ── Arc / Contract ────────────────────────────────────────────────
RPC_URL              = os.getenv("ARC_TESTNET_RPC_URL")
PRIVATE_KEY          = os.getenv("DEPLOYER_PRIVATE_KEY")
CONTRACT_ADDRESS     = os.getenv("PREDICTION_MARKET_ADDRESS", "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5")
USDC_ADDRESS         = os.getenv("USDC_ADDRESS", "0x3600000000000000000000000000000000000000")
EURC_ADDRESS         = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"

# ── AI ────────────────────────────────────────────────────────────
GROQ_API_KEY         = os.getenv("GROQ_API_KEY")

# ── Timing ────────────────────────────────────────────────────────
MONITOR_INTERVAL_SEC = 30
DECISION_INTERVAL_SEC= 300
RESOLVER_INTERVAL_SEC= 60

# ── Market params ─────────────────────────────────────────────────
MARKET_DURATION_SEC  = 3600
MIN_RATE_CHANGE_PCT  = 0.15
DECISION_LOOKBACK    = 20
RATE_SCALE           = 1_000_000

# ── Monitored pairs ───────────────────────────────────────────────
# Add any pair here — agent will monitor rates and create markets.
# Format: (pair_name, rate_source, display_name)
# rate_source options: "okx_eurusdt", "flutterwave_ngn", "exchangerate_ngn",
#                      "exchangerate_ghs", "exchangerate_kes", "exchangerate_zar"
MONITORED_PAIRS = [
    {"pair": "USDC/EURC", "source": "okx_eurusdt",     "label": "EURC/USDC"},
    {"pair": "USDC/NGN",  "source": "flutterwave_ngn", "label": "NGN per USDC"},
    {"pair": "USDC/GHS",  "source": "exchangerate_ghs","label": "GHS per USDC"},
    {"pair": "USDC/KES",  "source": "exchangerate_kes","label": "KES per USDC"},
    {"pair": "USDC/ZAR",  "source": "exchangerate_zar","label": "ZAR per USDC"},
    {"pair": "USDC/EGP",  "source": "exchangerate_egp","label": "EGP per USDC"},
]