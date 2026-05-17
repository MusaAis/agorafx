"""
Decision Engine — runs every 5 minutes.
Uses Groq (Llama 3.3) to analyse rate data.
Fallback: scheduled market alternating EURC/USDC and USDC/NGN.
"""
import json, logging
from datetime import datetime, timezone
from groq import AsyncGroq
from .config import GROQ_API_KEY, DECISION_LOOKBACK
from .db     import get_recent_rates, insert_decision, get_conn

log = logging.getLogger("decision")

SYSTEM_PROMPT = """You are AgoraFX — an AI agent creating African FX prediction markets on Arc.

Given recent rate snapshots, decide whether to open a market.
Only open if there is clear directional momentum ≥0.15%.

Respond ONLY with valid JSON:

If opening:
{"action":"create_market","reasoning":"one sentence","pair":"USDC/EURC","question":"Will EURC/USDC exceed 1.085 in the next hour?","threshold":1085000,"is_above":true,"expiry_offset_sec":3600}

If not:
{"action":"hold","reasoning":"one sentence"}

threshold = rate × 1000000 as integer. No markdown."""


def _build_prompt(eurc_rates, ngn_rates):
    now = datetime.now(timezone.utc).isoformat()
    hints = []
    if len(eurc_rates)>=2:
        d=(eurc_rates[-1]["rate"]-eurc_rates[0]["rate"])/eurc_rates[0]["rate"]*100
        hints.append(f"USDC/EURC change: {d:+.4f}%")
    if len(ngn_rates)>=2:
        d=(ngn_rates[-1]["rate"]-ngn_rates[0]["rate"])/ngn_rates[0]["rate"]*100
        hints.append(f"USDC/NGN change: {d:+.4f}%")
    return f"""Time: {now}
Momentum: {chr(10).join(hints) if hints else "Insufficient data"}
EURC rates: {json.dumps([{"rate":r["rate"],"at":r["recorded_at"]} for r in eurc_rates])}
NGN rates: {json.dumps([{"rate":r["rate"],"at":r["recorded_at"]} for r in ngn_rates])}
Should I open a market?"""


async def run_decision_cycle():
    eurc_rates = get_recent_rates("USDC/EURC", DECISION_LOOKBACK)
    ngn_rates  = get_recent_rates("USDC/NGN",  DECISION_LOOKBACK)
    if len(eurc_rates)<3 and len(ngn_rates)<3:
        log.info("Not enough data yet"); return None
    try:
        client   = AsyncGroq(api_key=GROQ_API_KEY)
        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role":"system","content":SYSTEM_PROMPT},
                {"role":"user","content":_build_prompt(eurc_rates,ngn_rates)},
            ],
            max_tokens=300, temperature=0.2,
        )
    except Exception as e:
        log.error(f"Groq error: {e}"); return None

    raw = response.choices[0].message.content.strip()
    if "```" in raw:
        for p in raw.split("```"):
            p=p.strip()
            if p.startswith("json"): p=p[4:].strip()
            if p.startswith("{"): raw=p; break
    try: decision=json.loads(raw)
    except Exception as e: log.error(f"JSON parse failed: {e}"); return None

    action,reasoning = decision.get("action","hold"), decision.get("reasoning","")
    log.info(f"🤖 [{action}] {reasoning}")
    insert_decision(pair=decision.get("pair","USDC/EURC"),action=action,reasoning=reasoning,
                    threshold=decision.get("threshold"),is_above=int(bool(decision.get("is_above",True))))

    if action=="create_market":
        required=["pair","question","threshold","is_above","expiry_offset_sec"]
        if all(f in decision for f in required): return decision
    return None


async def build_scheduled_market():
    """
    Fallback: alternates between EURC and NGN markets.
    Opens a market only if no active market for that pair.
    """
    conn = get_conn()
    # Count active per pair
    eurc_active = conn.execute(
        "SELECT COUNT(*) FROM markets WHERE resolved=0 AND pair='USDC/EURC'"
    ).fetchone()[0]
    ngn_active = conn.execute(
        "SELECT COUNT(*) FROM markets WHERE resolved=0 AND pair='USDC/NGN'"
    ).fetchone()[0]

    # Pick pair with no active market; prefer EURC first
    if eurc_active==0:
        pair="USDC/EURC"; rates=get_recent_rates("USDC/EURC",1)
    elif ngn_active==0:
        pair="USDC/NGN"; rates=get_recent_rates("USDC/NGN",1)
    else:
        log.info("Both pairs have active markets — skipping scheduled market"); return None

    if not rates: log.warning(f"No rate data for {pair}"); return None

    rate      = rates[0]["rate"]
    threshold = int(rate * 1_000_000)

    if pair=="USDC/EURC":
        question = f"Will EURC/USDC be above {rate:.4f} in the next hour?"
    else:
        ngn_int = int(rate)
        question = f"Will 1 USDC be worth more than ₦{ngn_int:,} in the next hour?"

    log.info(f"📅 Scheduled market ({pair}): {question}")
    insert_decision(pair=pair,action="create_market",
                    reasoning=f"Scheduled {pair} market — no active market for this pair",
                    threshold=threshold,is_above=1)
    return {"action":"create_market","pair":pair,"question":question,
            "threshold":threshold,"is_above":True,"expiry_offset_sec":3600}

