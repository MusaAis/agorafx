"""
AgoraFX — FastAPI backend
Exposes agent data (markets, rates, decisions) to the React frontend.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import sys, os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agent.db import get_conn, init_db

app = FastAPI(title="AgoraFX API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    init_db()


# ── Markets ───────────────────────────────────────────────────────

@app.get("/markets")
def get_markets(resolved: int = -1, limit: int = 50):
    """
    All markets. Pass resolved=0 for active, resolved=1 for settled.
    """
    conn = get_conn()
    if resolved == -1:
        rows = conn.execute(
            "SELECT * FROM markets ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM markets WHERE resolved=? ORDER BY id DESC LIMIT ?",
            (resolved, limit)
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/markets/{market_id_hex}")
def get_market(market_id_hex: str):
    conn = get_conn()
    row  = conn.execute(
        "SELECT * FROM markets WHERE market_id_hex=?", (market_id_hex,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Market not found")
    return dict(row)


# ── Rates ─────────────────────────────────────────────────────────

@app.get("/rates")
def get_rates(pair: str = "USDC/EURC", limit: int = 100):
    """Recent rate snapshots for a given pair."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM rates WHERE pair=? ORDER BY id DESC LIMIT ?",
        (pair, limit)
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


@app.get("/rates/latest")
def get_latest_rates():
    """Most recent rate for each pair."""
    conn  = get_conn()
    pairs = ["USDC/EURC", "USDC/NGN"]
    result = {}
    for pair in pairs:
        row = conn.execute(
            "SELECT * FROM rates WHERE pair=? ORDER BY id DESC LIMIT 1", (pair,)
        ).fetchone()
        result[pair] = dict(row) if row else None
    return result


# ── Decisions ─────────────────────────────────────────────────────

@app.get("/decisions")
def get_decisions(limit: int = 50):
    """Agent decision log — what the AI decided and why."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM decisions ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


# ── Stats ─────────────────────────────────────────────────────────

@app.get("/stats")
def get_stats():
    """Summary stats for the dashboard header."""
    conn = get_conn()

    total_markets  = conn.execute("SELECT COUNT(*) FROM markets").fetchone()[0]
    active_markets = conn.execute("SELECT COUNT(*) FROM markets WHERE resolved=0").fetchone()[0]
    resolved_markets = total_markets - active_markets

    yes_wins = conn.execute(
        "SELECT COUNT(*) FROM markets WHERE outcome='YES'"
    ).fetchone()[0]
    no_wins  = conn.execute(
        "SELECT COUNT(*) FROM markets WHERE outcome='NO'"
    ).fetchone()[0]

    total_decisions = conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
    create_decisions = conn.execute(
        "SELECT COUNT(*) FROM decisions WHERE action='create_market'"
    ).fetchone()[0]

    latest_eurc = conn.execute(
        "SELECT rate FROM rates WHERE pair='USDC/EURC' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    latest_ngn = conn.execute(
        "SELECT rate FROM rates WHERE pair='USDC/NGN' ORDER BY id DESC LIMIT 1"
    ).fetchone()

    return {
        "markets": {
            "total":    total_markets,
            "active":   active_markets,
            "resolved": resolved_markets,
            "yes_wins": yes_wins,
            "no_wins":  no_wins,
        },
        "agent": {
            "total_decisions":  total_decisions,
            "markets_created":  create_decisions,
            "hold_decisions":   total_decisions - create_decisions,
        },
        "rates": {
            "USDC/EURC": latest_eurc[0] if latest_eurc else None,
            "USDC/NGN":  latest_ngn[0]  if latest_ngn  else None,
        }
    }


# ── Health ────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "AgoraFX API"}
