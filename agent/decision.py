"""
Decision Engine — runs every 5 minutes.

v2.1 changes (fixes EURC positional bias bug found June 29):
- ROOT CAUSE FOUND: previous version showed the LLM all 6 pairs in one prompt
  and asked it to pick ONE to respond about. The model defaulted to whichever
  pair appeared first in MONITORED_PAIRS (USDC/EURC) almost every single time
  due to LLM primacy bias — 720/731 decisions over 5 days were logged against
  EURC specifically, even when reasoning text said "momentum unclear for all
  pairs." NGN/GHS/KES/ZAR/EGP were getting essentially zero real evaluation.
- FIX: the LLM now runs ONCE PER PAIR per cycle, with a focused single-pair
  prompt. No pair competes with another for "selection." Every pair gets a
  genuine, independent decision every cycle. Pair order is also shuffled each
  cycle so even residual model bias can't anchor to list position.
- This also fixes the fallback gate: _consecutive_llm_holds() was always
  returning 0 for non-EURC pairs (since they had zero decision rows at all),
  which silently meant fallback NEVER fired for them either — they were
  getting no markets from either source. Now every pair accumulates real
  decision history, so the fallback gate works as originally designed.

v2 changes (post-Lepton judge feedback) — retained:
- LLM decisions use memory of recent history per pair (own track record)
- Asymmetric confidence thresholds — raises the bar after recent misses
- Real abstention — LLM can explicitly HOLD on ambiguous signal
- Fallback tagged source="fallback" vs source="llm" — honest, auditable
- Fallback only fires after sustained genuine LLM holds on that specific pair
"""

import os
import json, logging, random
from datetime import datetime, timezone
from groq import AsyncGroq
import itertools
from .x402_client import pay_and_fetch

# ── Groq key rotation ─────────────────────────────────────────────
def _get_groq_keys():
    keys = [k for k in [
        os.environ.get("GROQ_API_KEY"),
        os.environ.get("GROQ_API_KEY_2"),
        os.environ.get("GROQ_API_KEY_3"),
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

FALLBACK_HOLD_THRESHOLD = 6   # at 5min cycles ≈ 30 min of genuine LLM inaction

AMBIGUOUS_MOMENTUM_LOW  = 0.10
AMBIGUOUS_MOMENTUM_HIGH = 0.20

# Single-pair focused prompt — no competition with other pairs for "selection"
SYSTEM_PROMPT = """You are AgoraFX — an AI agent creating African FX prediction markets on Arc blockchain.

You are evaluating ONE specific currency pair right now. You are shown:
1. Live rate momentum for this pair only
2. Your own recent decision history for this exact pair (what you decided, your confidence, and whether each resolved market was correct)

Decide whether to open a market for THIS pair only.

Rules:
- Only act (create_market) if momentum is clear (>=0.15%) AND your recent track record on this pair does not suggest you should be more cautious.
- If your last 2 decisions on this pair were WRONG, raise your effective confidence bar — require stronger momentum or explicitly HOLD instead.
- If momentum is in the ambiguous band (0.10%-0.20%), prefer HOLD unless your recent history on this pair has been accurate — explain this tradeoff in your reasoning.
- Confidence must reflect genuine certainty given momentum AND track record — not just momentum size. Strong momentum with a recent wrong call should NOT get a high confidence score.
- It is correct and expected to HOLD often. Do not force a directional guess to "have something to report."

Respond ONLY with valid JSON, no markdown:

If opening:
{"action":"create_market","reasoning":"Short reason referencing both momentum and track record","question":"Will 1 USDC be worth more than ₦1,371 in the next hour?","threshold":1371000000,"is_above":true,"expiry_offset_sec":3600,"confidence":78}

If not:
{"action":"hold","reasoning":"Short reason — state whether this is a momentum issue, a track-record caution, or both","confidence":15}

threshold = rate × 1000000 as integer.

IMPORTANT question formatting:
- NGN/GHS/KES/ZAR/EGP: round to nearest whole number. Example: ₦1,371 not ₦1371.06316
- EURC/USDC: round to 4 decimal places. Example: 1.1606 not 1.16061662
- Always use comma thousands separator for fiat amounts"""


def _last_market_direction(pair: str) -> bool | None:
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


def _consecutive_llm_holds(pair: str) -> int:
    conn = get_conn()
    rows = conn.execute(
        """SELECT action, source FROM decisions
           WHERE pair=? ORDER BY id DESC LIMIT 50""",
        (pair,)
    ).fetchall()
    count = 0
    for r in rows:
        if r["source"] != "llm":
            break
        if r["action"] == "hold":
            count += 1
        else:
            break
    return count


def _recent_decision_history(pair: str, n: int = 5) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        """SELECT d.action, d.confidence, d.is_above, d.reasoning, d.created_at,
                  m.resolved, m.outcome
           FROM decisions d
           LEFT JOIN markets m
             ON m.pair = d.pair AND m.created_at = d.created_at
           WHERE d.pair=? AND d.source='llm'
           ORDER BY d.id DESC LIMIT ?""",
        (pair, n)
    ).fetchall()
    return [dict(r) for r in rows]


def _format_history_for_prompt(history: list[dict]) -> str:
    if not history:
        return "no prior decisions on this pair"
    lines = []
    for h in history:
        outcome = "unresolved"
        if h.get("resolved"):
            outcome = "CORRECT" if h.get("outcome") == h.get("is_above") else "WRONG"
        lines.append(f"  - {h['action']} conf={h['confidence']} -> {outcome}")
    return "\n".join(lines)


def _build_single_pair_prompt(pair: str, rates: list, momentum: float) -> str:
    """Focused prompt for exactly one pair — no other pairs shown, no selection bias possible."""
    now    = datetime.now(timezone.utc).strftime("%H:%M UTC")
    diff   = rates[-1]["rate"] - rates[0]["rate"]
    trend  = "up" if diff > 0 else "down"
    latest = rates[-1]["rate"]
    snaps  = [{"r": round(r["rate"], 6), "t": r["recorded_at"][11:16]} for r in rates[-3:]]

    history_str = _format_history_for_prompt(_recent_decision_history(pair, n=3))
    ambiguous   = AMBIGUOUS_MOMENTUM_LOW <= momentum <= AMBIGUOUS_MOMENTUM_HIGH

    return (
        f"{now}\n"
        f"Pair: {pair}\n"
        f"Momentum: {trend} {momentum:.3f}%{' [AMBIGUOUS BAND]' if ambiguous else ''}\n"
        f"Latest rate: {latest}\n"
        f"Recent snapshots: {snaps}\n"
        f"Recent history on this pair:\n{history_str}\n"
        f"Open market for {pair}?"
    )


def _insert_decision(pair, action, reasoning, threshold=None, is_above=True,
                      confidence=0, source="llm"):
    conn = get_conn()
    try:
        conn.execute(
            """INSERT INTO decisions
               (pair, action, reasoning, threshold, is_above, confidence, source, created_at)
               VALUES (?,?,?,?,?,?,?,datetime('now'))""",
            (pair, action, reasoning, threshold, int(is_above), confidence, source)
        )
    except Exception:
        conn.execute(
            """INSERT INTO decisions (pair, action, reasoning, threshold, is_above, created_at)
               VALUES (?,?,?,?,?,datetime('now'))""",
            (pair, action, reasoning, threshold, int(is_above))
        )
    conn.commit()


def _clean_question(decision: dict) -> dict:
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
        decision["threshold"] = rate_int * 1_000_000
    return decision


async def _call_groq(prompt: str) -> dict | None:
    """Single Groq call with key rotation — returns parsed JSON dict or None."""
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
                    {"role":"user",  "content":prompt},
                ],
                max_tokens=180, temperature=0.3,
            )
            break
        except Exception as e:
            last_err = e
            if "rate_limit" in str(e).lower() or "429" in str(e):
                log.warning("Groq key limit hit, rotating to next key")
                continue
            log.error(f"Groq error: {e}")
            return None
    if response is None:
        log.error(f"All Groq keys exhausted: {last_err}")
        return None

    raw = response.choices[0].message.content.strip()
    if "```" in raw:
        for p in raw.split("```"):
            p = p.strip()
            if p.startswith("json"): p = p[4:].strip()
            if p.startswith("{"): raw = p; break

    try:
        return json.loads(raw)
    except Exception:
        log.error(f"JSON parse failed. Raw: {raw[:200]}")
        return None


async def run_decision_cycle() -> dict | None:
    """
    v3: evaluates EVERY pair independently this cycle, one focused LLM call
    each, in randomized order. Returns the FIRST create_market decision found
    (if any); all pairs still get their hold/create decision logged either way.
    """
    # ── pay for the signal before deciding ────────────────────────
    signal_result = await pay_and_fetch()
    if signal_result["action"] == "PAID" and signal_result.get("data"):
        d = signal_result["data"]
        log.info(
            "x402 PAID $%.4f — %s %s conf=%.2f hash=%.12s",
            signal_result["cost_usdc"], d.get("pair", "?"), d.get("direction", "?"),
            d.get("confidence", 0.0), signal_result["reasoning_hash"],
        )
    else:
        log.info("x402 %s — proceeding with cached rates", signal_result["action"])

    pairs_to_check = MONITORED_PAIRS.copy()
    random.shuffle(pairs_to_check)  # no positional bias — order changes every cycle

    market_to_create = None

    for p in pairs_to_check:
        pair  = p["pair"]
        rates = get_recent_rates(pair, DECISION_LOOKBACK)

        if len(rates) < 3:
            log.info(f"Skipping {pair} — not enough rate data yet ({len(rates)} points)")
            continue

        momentum = _calc_momentum(rates)
        prompt   = _build_single_pair_prompt(pair, rates, momentum)

        decision = await _call_groq(prompt)
        if decision is None:
            log.warning(f"No usable LLM response for {pair} this cycle")
            continue

        action     = decision.get("action", "hold")
        reasoning  = decision.get("reasoning", "")
        confidence = min(100, max(0, int(decision.get("confidence", 0))))

        log.info(f"🤖 LLM [{action}] {pair} {reasoning} (confidence: {confidence}%)")

        _insert_decision(
            pair=pair, action=action, reasoning=reasoning,
            threshold=decision.get("threshold"), is_above=decision.get("is_above", True),
            confidence=confidence, source="llm",
        )

        if action == "create_market" and market_to_create is None:
            required = ["question", "threshold", "is_above", "expiry_offset_sec"]
            if all(f in decision for f in required):
                decision["pair"] = pair
                market_to_create = _clean_question(decision)
                # Don't break — still evaluate remaining pairs so their
                # decisions get logged too. Only the first create wins this cycle.

    return market_to_create


async def build_scheduled_market() -> dict | None:
    """
    True last-resort fallback — ONLY fires for a pair after the LLM has
    genuinely held FALLBACK_HOLD_THRESHOLD consecutive cycles on it.
    Now functions correctly for ALL pairs since run_decision_cycle() v3
    logs a real decision row for every pair every cycle.
    """
    conn = get_conn()
    for p in MONITORED_PAIRS:
        pair   = p["pair"]
        active = conn.execute(
            "SELECT COUNT(*) FROM markets WHERE resolved=0 AND pair=?", (pair,)
        ).fetchone()[0]
        if active > 0: continue

        hold_streak = _consecutive_llm_holds(pair)
        if hold_streak < FALLBACK_HOLD_THRESHOLD:
            continue

        rates = get_recent_rates(pair, 1)
        if not rates: continue

        rate      = rates[0]["rate"]
        threshold = int(rate * 1_000_000)

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
        log.info(
            f"⏱️  FALLBACK fired for {pair} after {hold_streak} consecutive LLM holds "
            f"({direction_str}): {question}"
        )

        _insert_decision(
            pair=pair, action="create_market",
            reasoning=f"Fallback after {hold_streak} consecutive LLM holds — {direction_str}",
            threshold=threshold, is_above=is_above, confidence=30,
            source="fallback",
        )

        return {"action":"create_market","pair":pair,"question":question,
                "threshold":threshold,"is_above":is_above,"expiry_offset_sec":3600}
    return None
