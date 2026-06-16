"""
Decision Engine — runs every 5 minutes.
Forces direction alternation on scheduled markets.
"""

import os
import json, logging, time
from datetime import datetime, timezone
from groq import AsyncGroq
import itertools
from .x402_client import pay_and_fetch

# ── Groq key rotation ─────────────────────────────────────────────
def _get_groq_keys():
    keys = [k for k in [
        os.environ.get("GROQ_API_KEY"),
        os.environ.get("GROQ_API_KEY_2"),                       os.environ.get("GROQ_API_KEY_3"),
    ] if k]
    return keys                                         
_key_cycle = None                                       

def _next_groq_client():
    global _key_cycle
    keys = _get_groq_keys()
    if not keys:
        raise ValueError("No Groq API keys found")
    if _key_cycle is None:
        _key_cycle = itertools.cycle(keys)
    return AsyncGroq(api_key=next(_key_cycle))
from .config import GROQ_API_KEY, DECISION_LOOKBACK, MONITORED_PAIRS
from .db     import get_recent_rates, insert_decision, get_conn

log = logging.getLogger("decision")

SYSTEM_PROMPT = """You are AgoraFX — an AI agent creating African FX prediction markets on Arc blockchain.

Given rate snapshots, decide whether to open a prediction market.

Rules:
- Open ONLY if there is clear directional momentum ≥0.15%
- Pick the pair with the strongest signal
- Include confidence 0-100

Respond ONLY with valid JSON, no markdown:

If opening:
{"action":"create_market","reasoning":"Short reason","pair":"USDC/NGN","question":"Will 1 USDC be worth more than ₦1,371 in the next hour?","threshold":1371000000,"is_above":true,"expiry_offset_sec":3600,"confidence":78}

If not:
{"action":"hold","reasoning":"Short reason","confidence":15}

threshold = rate × 1000000 as integer.

IMPORTANT question formatting:
- NGN/GHS/KES/ZAR: round to nearest whole number. Example: ₦1,371 not ₦1371.06316
- EURC/USDC: round to 4 decimal places. Example: 1.1606 not 1.16061662
- Always use comma thousands separator for fiat amounts"""


def _last_market_direction(pair: str) -> bool | None:
    """Returns is_above of last created market for a pair, or None if first."""
    conn = get_conn()
    row  = conn.execute(
        "SELECT is_above FROM markets WHERE pair=? ORDER BY id DESC LIMIT 1", (pair,)
    ).fetchone()
    return bool(row["is_above"]) if row else None


def _calc_momentum(rates: list) -> float:
    if len(rates) < 2: return 0.0
    start = rates[0]["rate"]
    if start == 0: return 0.0
    return abs((rates[-1]["rate"] - start) / start * 100)


def _build_prompt(all_rates: dict) -> str:
    """Trimmed prompt — saves ~40% tokens."""
    now = datetime.now(timezone.utc).strftime("%H:%M UTC")
    sections = []
    for pair, rates in all_rates.items():
        if not rates: continue
        m   = _calc_momentum(rates)
        if len(rates) < 2:
            continue
        diff  = rates[-1]["rate"] - rates[0]["rate"]
        trend = "up" if diff > 0 else "down"
        latest = rates[-1]["rate"]
        oldest = rates[0]["rate"]
        # Only send 3 snapshots max instead of 5
        snaps = [{"r": round(r["rate"], 6), "t": r["recorded_at"][11:16]} for r in rates[-3:]]
        sections.append(f"{pair} {trend} {m:.3f}% | now={latest} | {snaps}")
    return f"{now}\n" + "\n".join(sections) + "\nOpen market?"


def _insert_decision(pair, action, reasoning, threshold=None, is_above=True, confidence=0):
    """Insert with confidence — gracefully handles missing column."""
    conn = get_conn()
    try:
        conn.execute(
            """INSERT INTO decisions (pair, action, reasoning, threshold, is_above, confidence, created_at)
               VALUES (?,?,?,?,?,?,datetime('now'))""",
            (pair, action, reasoning, threshold, int(is_above), confidence)
        )
    except Exception:
        # Fallback if confidence column doesn't exist yet
        conn.execute(
            """INSERT INTO decisions (pair, action, reasoning, threshold, is_above, created_at)
               VALUES (?,?,?,?,?,datetime('now'))""",
            (pair, action, reasoning, threshold, int(is_above))
        )
    conn.commit()


def _clean_question(decision: dict) -> dict:
    """Round thresholds and clean question text for readability."""
    pair      = decision.get("pair", "")
    threshold = decision.get("threshold", 0)
    is_above  = decision.get("is_above", True)
    direction = "more than" if is_above else "less than"

    currency  = pair.split("/")[1] if "/" in pair else ""
    symbols   = {"NGN": "₦", "GHS": "₵", "KES": "KSh", "ZAR": "R", "EGP": "E£", "TZS": "TSh", "UGX": "USh", "MAD": "MAD "}

    if pair == "USDC/EURC":
        rate_display = f"{threshold / 1_000_000:.4f}"
        decision["question"] = f"Will EURC/USDC be {'above' if is_above else 'below'} {rate_display} in the next hour?"
    elif currency in symbols:
        rate_int = round(threshold / 1_000_000)
        sym      = symbols[currency]
        decision["question"] = f"Will 1 USDC be worth {direction} {sym}{rate_int:,} in the next hour?"
        # Re-snap threshold to rounded rate
        decision["threshold"] = rate_int * 1_000_000
    return decision


async def run_decision_cycle() -> dict | None:
    # ── V2: pay for the signal before deciding ────────────────────────
    signal_result = await pay_and_fetch()
    _paid_signal: dict = {}
    if signal_result["action"] == "PAID" and signal_result.get("data"):
        _paid_signal = signal_result["data"]
        log.info(
            "x402 PAID $%.4f — %s %s conf=%.2f hash=%.12s",
            signal_result["cost_usdc"],
            _paid_signal.get("pair", "?"),
            _paid_signal.get("direction", "?"),
            _paid_signal.get("confidence", 0.0),
            signal_result["reasoning_hash"],
        )
    else:
        log.info("x402 %s — proceeding with cached rates", signal_result["action"])

    all_rates = {}
    any_data  = False
    for p in MONITORED_PAIRS:
        rates = get_recent_rates(p["pair"], DECISION_LOOKBACK)
        all_rates[p["pair"]] = rates
        if len(rates) >= 3: any_data = True

    if not any_data:
        log.info("Not enough data yet"); return None

    keys = _get_groq_keys()
    response = None
    last_err = None
    for _ in range(len(keys)):
        try:
            client   = _next_groq_client()
            response = await client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role":"system","content":SYSTEM_PROMPT},
                    {"role":"user",  "content":_build_prompt(all_rates)},
                ],
                max_tokens=150, temperature=0.2,
            )
            break  # success
        except Exception as e:
            last_err = e
            if "rate_limit" in str(e).lower() or "429" in str(e):
                log.warning(f"Groq key limit hit, rotating to next key")
                continue
            log.error(f"Groq error: {e}")
            return None
    if response is None:
        log.error(f"All Groq keys exhausted: {last_err}")
        return None

    raw = response.choices[0].message.content.strip()
    if "```" in raw:
        for p in raw.split("```"):
            p=p.strip()
            if p.startswith("json"): p=p[4:].strip()
            if p.startswith("{"): raw=p; break

    try: decision = json.loads(raw)
    except: log.error("JSON parse failed"); return None

    action     = decision.get("action","hold")
    reasoning  = decision.get("reasoning","")
    confidence = min(100, max(0, int(decision.get("confidence",0))))

    log.info(f"🤖 [{action}] {reasoning} (confidence: {confidence}%)")

    _insert_decision(
        pair=decision.get("pair","USDC/EURC"), action=action,
        reasoning=reasoning, threshold=decision.get("threshold"),
        is_above=decision.get("is_above",True), confidence=confidence,
    )

    if action=="create_market":
        required = ["pair","question","threshold","is_above","expiry_offset_sec"]
        if all(f in decision for f in required):
            # Post-process: clean up question formatting
            decision = _clean_question(decision)
            return decision
    return None


async def build_scheduled_market() -> dict | None:
    """
    Fallback: rotate through all pairs.
    ALWAYS alternates direction — never creates same direction twice in a row.
    """
    conn = get_conn()
    for p in MONITORED_PAIRS:
        pair   = p["pair"]
        active = conn.execute(
            "SELECT COUNT(*) FROM markets WHERE resolved=0 AND pair=?", (pair,)
        ).fetchone()[0]
        if active > 0: continue

        rates = get_recent_rates(pair, 1)
        if not rates: continue

        rate      = rates[0]["rate"]
        threshold = int(rate * 1_000_000)

        # FORCE alternation — never same direction twice
        last_dir = _last_market_direction(pair)
        is_above = (not last_dir) if last_dir is not None else True

        currency = pair.split("/")[1]
        symbols  = {"NGN":"₦","GHS":"₵","KES":"KSh","ZAR":"R","EGP":"E£"}
        sym      = symbols.get(currency, currency+" ")

        if pair == "USDC/EURC":
            dw = "above" if is_above else "below"
            question = f"Will EURC/USDC be {dw} {rate:.4f} in the next hour?"
        else:
            dw = "more than" if is_above else "less than"
            question = f"Will 1 USDC be worth {dw} {sym}{int(rate):,} in the next hour?"

        direction_str = "↑ above" if is_above else "↓ below"
        log.info(f" Scheduled {pair} ({direction_str}): {question}")

        _insert_decision(pair=pair, action="create_market",
                         reasoning=f"Scheduled {pair} market — {direction_str} direction",
                         threshold=threshold, is_above=is_above, confidence=50)

        return {"action":"create_market","pair":pair,"question":question,
                "threshold":threshold,"is_above":is_above,"expiry_offset_sec":3600}
    return None
