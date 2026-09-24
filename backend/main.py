"""
AgoraFX — FastAPI backend
"""
from fastapi.middleware.cors import CORSMiddleware
import sys, os, time, json
import hashlib
from datetime import datetime, timedelta
import base64
import json

from dotenv import load_dotenv
load_dotenv()
from .x402_middleware import build_x402_middleware
from .x402_middleware import require_x402
from fastapi import Depends
from fastapi.responses import JSONResponse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agent.db import get_conn, init_db
import logging
from fastapi import FastAPI, HTTPException, Request

log = logging.getLogger("backend")

app = FastAPI(title="AgoraFX API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─v2─ x402 middleware ───────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
def health():
    return {"status":"ok","service":"AgoraFX API"}

@app.get("/markets/ids")
def get_all_market_ids():
    conn = get_conn()
    rows = conn.execute("SELECT market_id_hex FROM markets ORDER BY id ASC").fetchall()
    return [r[0] for r in rows]

@app.get("/markets")
def get_markets(resolved: int = -1, limit: int = 2000):
    conn = get_conn()
    if resolved == -1:
        rows = conn.execute("SELECT * FROM markets ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM markets WHERE resolved=? ORDER BY id DESC LIMIT ?", (resolved,limit)).fetchall()
    return [dict(r) for r in rows]

@app.get("/markets/{market_id_hex}")
def get_market(market_id_hex: str):
    conn = get_conn()
    row  = conn.execute("SELECT * FROM markets WHERE market_id_hex=?", (market_id_hex,)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Not found")
    return dict(row)

@app.get("/rates")
def get_rates(pair: str = "USDC/EURC", limit: int = 100):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM rates WHERE pair=? ORDER BY id DESC LIMIT ?", (pair,limit)).fetchall()
    return [dict(r) for r in reversed(rows)]

@app.get("/rates/latest")
def get_latest_rates():
    conn  = get_conn()
    pairs = [r[0] for r in conn.execute("SELECT DISTINCT pair FROM rates").fetchall()]
    result = {}
    for pair in pairs:
        row = conn.execute("SELECT * FROM rates WHERE pair=? ORDER BY id DESC LIMIT 1", (pair,)).fetchone()
        result[pair] = dict(row) if row else None
    return result

@app.get("/rates/signal")
async def get_signal(payer: str = Depends(require_x402)):
    """
    x402 paywalled — $0.001 USDC per call.
    Depends(require_x402) enforces EIP-712 payment before this runs.
    payer = verified signer address recovered from EIP-712 signature.
    """
    import httpx, hashlib, time as _time

    conn = get_conn()

    rows = conn.execute("""
        SELECT pair, source, rate, recorded_at
        FROM rates
        WHERE recorded_at >= datetime('now', '-10 minutes')
        ORDER BY pair, id DESC
    """).fetchall()

    if not rows:
        raise HTTPException(status_code=503, detail="No rate data available")

    pair_data: dict = {}
    for pair, source, rate, ts in rows:
        pair_data.setdefault(pair, []).append({"rate": rate, "ts": ts, "source": source})

    best_conf, best_signal = 0.0, {}
    for pair, points in pair_data.items():
        if len(points) < 2: continue
        rates         = [d["rate"] for d in points]
        latest, oldest = rates[0], rates[-1]
        change        = abs(latest - oldest) / (oldest or 1)
        conf          = min(change / 0.015, 0.99)
        if conf > best_conf:
            best_conf   = conf
            best_signal = {
                "pair":             pair,
                "source":           points[0]["source"],
                "rate":             latest,
                "rate_change_pct":  round(change * 100, 4),
                "direction":        "UP" if latest > oldest else "DOWN",
                "confidence":       round(conf, 4),
                "lookback_points":  len(rates),
            }

    if not best_signal:
        raise HTTPException(status_code=503, detail="Insufficient rate history")

    signal_hash = hashlib.sha256(
        f"{best_signal['pair']}|{best_signal['rate']}|{best_signal['confidence']}".encode()
    ).hexdigest()

    payload = {
        **best_signal,
        "signal_hash": signal_hash,
        "payer":       payer,           # ← verified signer address from EIP-712
        "timestamp":   datetime.utcnow().isoformat() + "Z",
        "x402_version": 1,
    }

    # ── Facilitator settlement ────────────────────────────────────────────────
    # Submit the signed EIP-712 authorization to Circle's x402 facilitator
    facilitator_url = os.getenv(
        "X402_FACILITATOR_URL",
        "https://x402.org/facilitate"
    )
    settled = False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                facilitator_url,
                json={
                    "x402Version": 1,
                    "paymentPayload": payload.get("_payment_payload"),  # injected by middleware below
                },
            )
            if resp.status_code == 200:
                settled = True
                log.info("x402 facilitator settled: payer=%s", payer)
            else:
                log.warning("x402 facilitator %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        log.warning("x402 facilitator call failed: %s", e)

    # ── Response ──────────────────────────────────────────────────────────────
    price_units = int(float(os.getenv("X402_SIGNAL_PRICE_USDC", "0.001")) * 1_000_000)
    settle_hdr  = base64.b64encode(json.dumps(
        {
            "success": settled,
            "payer":   payer,
            "amount":  str(price_units),
            "network": "eip155:5042002",
        },
        separators=(",", ":")
    ).encode()).decode()

    response = JSONResponse(content=payload)
    response.headers["PAYMENT-RESPONSE"]              = settle_hdr
    response.headers["Access-Control-Expose-Headers"] = "PAYMENT-REQUIRED,PAYMENT-RESPONSE"
    return response

@app.get("/agent/decisions")
async def agent_decisions(limit: int = 50, offset: int = 0):
    """Public audit trail: every PAID / CACHED / HOLD decision the agent made."""
    conn = get_conn()

    rows = conn.execute(
        """
        SELECT reasoning_hash, action, pair, confidence,
               cost_usdc, rate, spend_date, created_at
        FROM x402_spend
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    ).fetchall()

    cols = ["reasoning_hash", "action", "pair", "confidence",
            "cost_usdc", "rate", "spend_date", "created_at"]
    decisions = [dict(zip(cols, r)) for r in rows]

    total_paid = conn.execute(
        "SELECT COALESCE(SUM(cost_usdc), 0) FROM x402_spend WHERE action='PAID'"
    ).fetchone()[0]

    paid_count = conn.execute(
        "SELECT COUNT(*) FROM x402_spend WHERE action='PAID'"
    ).fetchone()[0]

    return {
        "decisions":        decisions,
        "total_paid_usdc":  round(float(total_paid), 6),
        "paid_count":       int(paid_count),
        "limit":            limit,
        "offset":           offset,
    }

@app.get("/decisions")
def get_decisions(limit: int = 50):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM decisions ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]

@app.get("/stats")
def get_stats():
    conn = get_conn()
    total    = conn.execute("SELECT COUNT(*) FROM markets").fetchone()[0]
    active   = conn.execute("SELECT COUNT(*) FROM markets WHERE resolved=0").fetchone()[0]
    yes_wins = conn.execute("SELECT COUNT(*) FROM markets WHERE outcome='YES'").fetchone()[0]
    no_wins  = conn.execute("SELECT COUNT(*) FROM markets WHERE outcome='NO'").fetchone()[0]
    total_d  = conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
    create_d = conn.execute("SELECT COUNT(*) FROM decisions WHERE action='create_market'").fetchone()[0]
    pairs    = [r[0] for r in conn.execute("SELECT DISTINCT pair FROM rates").fetchall()]
    rates    = {}
    for pair in pairs:
        row = conn.execute("SELECT rate FROM rates WHERE pair=? ORDER BY id DESC LIMIT 1",(pair,)).fetchone()
        rates[pair] = row[0] if row else None
    return {
        "markets":{"total":total,"active":active,"resolved":total-active,"yes_wins":yes_wins,"no_wins":no_wins},
        "agent":{"total_decisions":total_d,"markets_created":create_d,"hold_decisions":total_d-create_d},
        "rates": rates,
    }

@app.get("/stats/performance")
def get_performance():
    conn = get_conn()
    total_resolved = conn.execute("SELECT COUNT(*) FROM markets WHERE resolved=1 AND outcome != 'VOID'").fetchone()[0]
    yes_wins = conn.execute("SELECT COUNT(*) FROM markets WHERE outcome='YES'").fetchone()[0]
    no_wins  = conn.execute("SELECT COUNT(*) FROM markets WHERE outcome='NO'").fetchone()[0]
    win_rate = round((yes_wins + no_wins) / total_resolved * 100, 1) if total_resolved > 0 else 0
    pair_stats = conn.execute(
        "SELECT pair, COUNT(*) as total, SUM(CASE WHEN resolved=1 THEN 1 ELSE 0 END) as resolved FROM markets GROUP BY pair"
    ).fetchall()
    avg_conf = conn.execute(
        "SELECT AVG(confidence) FROM decisions WHERE action='create_market' AND confidence > 0"
    ).fetchone()[0]
    total_markets  = conn.execute("SELECT COUNT(*) FROM markets WHERE resolved=1").fetchone()[0]
    void_markets   = conn.execute("SELECT COUNT(*) FROM markets WHERE outcome='VOID'").fetchone()[0]
    non_void       = total_markets - void_markets
    non_void_rate  = round(non_void / total_markets * 100, 1) if total_markets > 0 else 0
    decisions_today = conn.execute("SELECT COUNT(*) FROM decisions WHERE date(created_at) = date('now')").fetchone()[0]
    markets_today = conn.execute("SELECT COUNT(*) FROM markets WHERE date(created_at) = date('now')").fetchone()[0]
    return {
        "win_rate":        win_rate,
        "total_resolved":  total_resolved,
        "yes_wins":        yes_wins,
        "no_wins":         no_wins,
        "void_markets":    void_markets,
        "non_void_rate":   non_void_rate,
        "avg_confidence":  round(avg_conf or 0, 1),
        "decisions_today": decisions_today,
        "markets_today":   markets_today,
        "pair_stats": [dict(r) for r in pair_stats],
    }

def _human_message(item: dict) -> dict:
    action    = item.get("action","")
    reasoning = item.get("reasoning") or ""
    pair      = item.get("pair","")
    confidence= item.get("confidence") or 0
    outcome   = item.get("outcome")
    question  = item.get("question")
    is_market = item.get("type") == "market"

    if is_market and item.get("resolved"):
        emoji = {"YES":"✅","NO":"❌","VOID":"↩"}.get(outcome,"❓")
        label = "Resolved"
        msg   = f"{emoji} {outcome} — {question}"
        icon  = "🔵"
    elif is_market:
        label = "Created"
        msg   = f"📊 {question}"
        icon  = "🟢"
    elif action == "create_market":
        label = "Market"
        msg   = f"📈 Opening market — {reasoning}"
        icon  = "🟢"
    elif action == "hold":
        conf_str = f" (signal: {confidence}%)" if confidence > 0 else ""
        label = "Hold"
        msg   = f"🤔 Holding{conf_str} — {reasoning or 'No strong momentum detected'}"
        icon  = "⚪"
    else:
        label = action.title()
        msg   = reasoning or "—"
        icon  = "⚫"

    return {**item, "label": label, "message": msg, "icon": icon}

@app.get("/agent/activity")
def get_agent_activity(limit: int = 25):
    conn = get_conn()
    feed = []
    decisions = conn.execute(
        """SELECT 'decision' as type, action, reasoning, pair, created_at,
                  threshold, is_above, COALESCE(confidence,0) as confidence,
                  NULL as tx_hash, NULL as question, NULL as outcome, 0 as resolved
           FROM decisions ORDER BY id DESC LIMIT ?""", (limit,)
    ).fetchall()
    markets = conn.execute(
        """SELECT 'market' as type,
                  CASE WHEN resolved=1 THEN 'resolved' ELSE 'created' END as action,
                  NULL as reasoning, pair, created_at,
                  threshold, is_above, 50 as confidence,
                  tx_hash, question, outcome, resolved
           FROM markets ORDER BY id DESC LIMIT 20"""
    ).fetchall()
    for d in decisions:
        feed.append(_human_message(dict(d)))
    for m in markets:
        feed.append(_human_message(dict(m)))
    feed.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return feed[:limit]

@app.get("/agent/status")
def get_agent_status():
    import subprocess
    result = subprocess.run(["systemctl","is-active","agorafx"], capture_output=True, text=True)
    running = result.stdout.strip() == "active"
    conn = get_conn()
    markets_today = conn.execute("SELECT COUNT(*) FROM markets WHERE date(created_at) = date('now')").fetchone()[0]
    decisions_today = conn.execute("SELECT COUNT(*) FROM decisions WHERE date(created_at) = date('now')").fetchone()[0]
    last_decision = conn.execute("SELECT created_at FROM decisions ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "running": running,
        "markets_created_today": markets_today,
        "decisions_today": decisions_today,
        "last_scan": last_decision[0] if last_decision else None,
        "scan_interval_minutes": 5,
        "uptime": "active" if running else "stopped",
    }

@app.post("/agent/pause")
def pause_agent():
    import subprocess
    subprocess.run(["sudo","systemctl","stop","agorafx"], capture_output=True)
    return {"ok": True}

@app.post("/agent/resume")
def resume_agent():
    import subprocess
    subprocess.run(["sudo","systemctl","start","agorafx"], capture_output=True)
    return {"ok": True}

@app.get("/agent/logs")
def get_agent_logs():
    import subprocess
    result = subprocess.run(
        ["journalctl","-u","agorafx","-n","30","--no-pager","--output=short"],
        capture_output=True, text=True
    )
    lines = result.stdout.strip().split("\n") if result.stdout else []
    logs = []
    for line in lines:
        level = "error" if "error" in line.lower() else "warn" if "warn" in line.lower() else "info"
        logs.append({"message": line, "level": level, "ts": None})
    return logs

# ── Chain Stats ───────────────────────────────────────────────────

DEPLOY_BLOCK = 42065487
_v4_cache = {"data": None, "last_block": DEPLOY_BLOCK, "all_wallets": set(), "all_txns": set()}

@app.get("/stats/chain/v4")
def get_chain_stats_v4():
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
    from agent.config import RPC_URL, CONTRACT_ADDRESS
    BET_PLACED_ABI = [{"type":"event","name":"BetPlaced","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"user","type":"address","indexed":True},{"name":"isYes","type":"bool","indexed":False},{"name":"amount","type":"uint256","indexed":False}],"anonymous":False}]
    CHUNK = 99_000
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=BET_PLACED_ABI)
        latest=w3.eth.block_number; scan_from=_v4_cache["last_block"]
        total_volume=int((_v4_cache["data"] or {}).get("tvl_usdc",0)*1_000_000)
        yes_volume=int((_v4_cache["data"] or {}).get("yes_volume_usdc",0)*1_000_000)
        no_volume=int((_v4_cache["data"] or {}).get("no_volume_usdc",0)*1_000_000)
        yes_bets=(_v4_cache["data"] or {}).get("yes_bets",0); no_bets=(_v4_cache["data"] or {}).get("no_bets",0)
        wallets=_v4_cache["all_wallets"]; tx_hashes=_v4_cache["all_txns"]
        start=scan_from
        while start<=latest:
            end=min(start+CHUNK,latest)
            events=contract.events.BetPlaced().get_logs(from_block=start,to_block=end)
            for e in events:
                amt=e["args"]["amount"]; isYes=e["args"]["isYes"]; user=e["args"]["user"].lower()
                tx=e["transactionHash"].hex()
                total_volume+=amt; wallets.add(user); tx_hashes.add(tx)
                if isYes: yes_volume+=amt; yes_bets+=1
                else: no_volume+=amt; no_bets+=1
            start=end+1
        result={"tvl_usdc":round(total_volume/1_000_000,4),"yes_volume_usdc":round(yes_volume/1_000_000,4),"no_volume_usdc":round(no_volume/1_000_000,4),"yes_bets":yes_bets,"no_bets":no_bets,"total_bets":yes_bets+no_bets,"unique_wallets":len(wallets),"total_txns":len(tx_hashes),"blocks_scanned":latest-DEPLOY_BLOCK}
        _v4_cache["data"]=result; _v4_cache["last_block"]=latest+1
        return result
    except Exception as e:
        if _v4_cache["data"]: return _v4_cache["data"]
        return {"error":str(e),"tvl_usdc":0,"unique_wallets":0,"total_bets":0}

@app.get("/stats/chain/v5")
def get_chain_stats_v5():
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
    from agent.config import RPC_URL, CONTRACT_ADDRESS
    BET_PLACED_ABI = [{"type":"event","name":"BetPlaced","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"user","type":"address","indexed":True},{"name":"isYes","type":"bool","indexed":False},{"name":"amount","type":"uint256","indexed":False}],"anonymous":False}]
    CHUNK=99_000
    db=get_conn()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS chain_wallets (address TEXT PRIMARY KEY, first_seen_block INTEGER, first_seen_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS chain_cache (key TEXT PRIMARY KEY, value TEXT);
    """)
    db.commit()
    row=db.execute("SELECT value FROM chain_cache WHERE key='last_block'").fetchone()
    last_block=int(row[0]) if row else DEPLOY_BLOCK
    row=db.execute("SELECT value FROM chain_cache WHERE key='stats'").fetchone()
    cached=json.loads(row[0]) if row else {"tvl_usdc":0,"yes_volume_usdc":0,"no_volume_usdc":0,"yes_bets":0,"no_bets":0,"total_txns":0}
    try:
        w3=Web3(Web3.HTTPProvider(RPC_URL))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware,layer=0)
        contract=w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS),abi=BET_PLACED_ABI)
        latest=w3.eth.block_number
        total_volume=int(cached["tvl_usdc"]*1_000_000); yes_volume=int(cached["yes_volume_usdc"]*1_000_000)
        no_volume=int(cached["no_volume_usdc"]*1_000_000); yes_bets=cached["yes_bets"]; no_bets=cached["no_bets"]
        total_txns=cached["total_txns"]; new_wallets=[]
        start=last_block
        while start<=latest:
            end=min(start+CHUNK,latest)
            events=contract.events.BetPlaced().get_logs(from_block=start,to_block=end)
            for e in events:
                amt=e["args"]["amount"]; isYes=e["args"]["isYes"]; user=e["args"]["user"].lower(); block=e["blockNumber"]
                total_volume+=amt; total_txns+=1
                if isYes: yes_volume+=amt; yes_bets+=1
                else: no_volume+=amt; no_bets+=1
                new_wallets.append((user,block))
            start=end+1
        if new_wallets:
            db.executemany("INSERT OR IGNORE INTO chain_wallets (address, first_seen_block) VALUES (?,?)", new_wallets)
            db.commit()
        unique_wallets=db.execute("SELECT COUNT(*) FROM chain_wallets").fetchone()[0]
        result={"tvl_usdc":round(total_volume/1_000_000,4),"yes_volume_usdc":round(yes_volume/1_000_000,4),"no_volume_usdc":round(no_volume/1_000_000,4),"yes_bets":yes_bets,"no_bets":no_bets,"total_bets":yes_bets+no_bets,"unique_wallets":unique_wallets,"total_txns":total_txns,"blocks_scanned":latest-DEPLOY_BLOCK}
        db.execute("INSERT OR REPLACE INTO chain_cache (key, value) VALUES ('stats', ?)",(json.dumps(result),))
        db.execute("INSERT OR REPLACE INTO chain_cache (key, value) VALUES ('last_block', ?)",(str(latest+1),))
        db.commit()
        return result
    except Exception as e:
        if cached.get("tvl_usdc",0)>0:
            unique_wallets=db.execute("SELECT COUNT(*) FROM chain_wallets").fetchone()[0]
            cached["unique_wallets"]=unique_wallets
            return cached
        return {"error":str(e),"tvl_usdc":0,"unique_wallets":0,"total_bets":0}

@app.get("/bets/summary")
def get_bets_summary():
    conn = get_conn()
    try:
        yes_count = conn.execute("SELECT COUNT(*) FROM bets WHERE side=1 OR side='YES'").fetchone()[0]
        no_count  = conn.execute("SELECT COUNT(*) FROM bets WHERE side=0 OR side='NO'").fetchone()[0]
    except Exception:
        yes_count = 0; no_count = 0
    return {"yes_count":yes_count,"no_count":no_count,"total":yes_count+no_count}

# ── Market Bets Endpoint ─────────────────────────────────────────

@app.get("/markets/{market_id_hex}/bets")
def get_market_bets(market_id_hex: str):
    """Return all bets for a specific market from user_bets cache."""
    import sqlite3 as _sqlite3
    db = _sqlite3.connect(DB_PATH)
    db.row_factory = _sqlite3.Row
    try:
        rows = db.execute(
            """SELECT wallet, is_yes, SUM(amount) as amount, MAX(block_num) as block_num, tx_hash
               FROM user_bets WHERE market_id=?
               GROUP BY wallet, is_yes""",
            (market_id_hex,)
        ).fetchall()
        return [{"wallet": r["wallet"], "side": bool(r["is_yes"]),
                 "amount": r["amount"], "block_num": r["block_num"],
                 "tx_hash": r["tx_hash"], "ts": None} for r in rows]
    finally:
        db.close()

@app.get("/admin/stuck-markets")
def get_stuck_markets():
    """Markets expired on-chain but not resolved in DB."""
    import time
    conn = get_conn()
    rows = conn.execute(
        """SELECT * FROM markets WHERE resolved=0 AND expiry_ts <= ?
           ORDER BY expiry_ts ASC""",
        (int(time.time()),)
    ).fetchall()
    return [dict(r) for r in rows]

@app.post("/admin/force-resolve/{market_id_hex}")
def force_resolve_market(market_id_hex: str):
    """Force-sync a stuck market from on-chain state."""
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
    from agent.config import RPC_URL, CONTRACT_ADDRESS as CA
    ABI = [{"type":"function","name":"getMarket","inputs":[{"name":"marketId","type":"bytes32"}],
            "outputs":[{"name":"","type":"tuple","components":[
                {"name":"id","type":"bytes32"},{"name":"pair","type":"string"},
                {"name":"question","type":"string"},{"name":"threshold","type":"uint256"},
                {"name":"isAbove","type":"bool"},{"name":"expiry","type":"uint256"},
                {"name":"yesPool","type":"uint256"},{"name":"noPool","type":"uint256"},
                {"name":"outcome","type":"uint8"},{"name":"resolved","type":"bool"},
                {"name":"createdAt","type":"uint256"}]}],"stateMutability":"view"},
           {"type":"function","name":"resolveMarket",
            "inputs":[{"name":"marketId","type":"bytes32"},{"name":"finalRate","type":"uint256"}],
            "outputs":[],"stateMutability":"nonpayable"}]
    outcome_map = {0:"UNRESOLVED",1:"YES",2:"NO",3:"VOID"}
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        c = w3.eth.contract(address=Web3.to_checksum_address(CA), abi=ABI)
        b = bytes.fromhex(market_id_hex.replace("0x",""))
        m = c.functions.getMarket(b).call()
        if m[9]:  # already resolved on-chain
            outcome = outcome_map.get(m[8], "UNKNOWN")
            conn = get_conn()
            conn.execute("UPDATE markets SET resolved=1, outcome=? WHERE market_id_hex=?",
                        (outcome, market_id_hex))
            conn.commit()
            return {"ok": True, "outcome": outcome, "source": "onchain_sync"}
        # Not resolved on-chain yet — agent will handle it
        return {"ok": False, "reason": "Not yet resolved on-chain — agent will resolve shortly"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/admin/force-resolve-all")
def force_resolve_all():
    """Sync all stuck markets from on-chain state at once."""
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
    from agent.config import RPC_URL, CONTRACT_ADDRESS as CA
    import time
    ABI = [{"type":"function","name":"getMarket","inputs":[{"name":"marketId","type":"bytes32"}],
            "outputs":[{"name":"","type":"tuple","components":[
                {"name":"id","type":"bytes32"},{"name":"pair","type":"string"},
                {"name":"question","type":"string"},{"name":"threshold","type":"uint256"},
                {"name":"isAbove","type":"bool"},{"name":"expiry","type":"uint256"},
                {"name":"yesPool","type":"uint256"},{"name":"noPool","type":"uint256"},
                {"name":"outcome","type":"uint8"},{"name":"resolved","type":"bool"},
                {"name":"createdAt","type":"uint256"}]}],"stateMutability":"view"}]
    outcome_map = {0:"UNRESOLVED",1:"YES",2:"NO",3:"VOID"}
    conn = get_conn()
    rows = conn.execute(
        "SELECT market_id_hex FROM markets WHERE resolved=0 AND expiry_ts <= ?",
        (int(time.time()),)
    ).fetchall()
    if not rows:
        return {"ok": True, "fixed": 0, "message": "No stuck markets"}
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        c = w3.eth.contract(address=Web3.to_checksum_address(CA), abi=ABI)
        fixed = 0
        for (mid,) in rows:
            try:
                b = bytes.fromhex(mid.replace("0x",""))
                m = c.functions.getMarket(b).call()
                if m[9]:
                    outcome = outcome_map.get(m[8], "UNKNOWN")
                    conn.execute("UPDATE markets SET resolved=1, outcome=? WHERE market_id_hex=?",
                                (outcome, mid))
                    conn.commit()
                    fixed += 1
            except Exception:
                continue
        return {"ok": True, "fixed": fixed, "total": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── User Positions Cache ──────────────────────────────────────────

DB_PATH = "/home/ubuntu/agorafx/agorafx.db"

def _ensure_user_bets_table(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS user_bets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id   TEXT    NOT NULL,
            wallet      TEXT    NOT NULL,
            is_yes      INTEGER NOT NULL,
            amount      INTEGER NOT NULL,
            block_num   INTEGER NOT NULL,
            tx_hash     TEXT,
            UNIQUE(market_id, wallet, is_yes, block_num)
        );
        CREATE INDEX IF NOT EXISTS idx_user_bets_wallet ON user_bets(wallet);
        CREATE INDEX IF NOT EXISTS idx_user_bets_market ON user_bets(market_id);
    """)
    db.commit()

def _sync_user_bets(db, w3, contract, from_block, to_block):
    CHUNK = 99_000
    start = from_block
    while start <= to_block:
        end = min(start + CHUNK, to_block)
        try:
            events = contract.events.BetPlaced().get_logs(from_block=start, to_block=end)
            rows = []
            for e in events:
                mid  = "0x" + e["args"]["marketId"].hex()
                user = e["args"]["user"].lower()
                isYes= 1 if e["args"]["isYes"] else 0
                amt  = e["args"]["amount"]
                blk  = e["blockNumber"]
                tx   = e["transactionHash"].hex()
                rows.append((mid, user, isYes, amt, blk, tx))
            if rows:
                db.executemany(
                    "INSERT OR IGNORE INTO user_bets (market_id, wallet, is_yes, amount, block_num, tx_hash) VALUES (?,?,?,?,?,?)",
                    rows
                )
                db.commit()
        except Exception:
            pass
        start = end + 1

@app.get("/positions/{address}")
def get_user_positions(address: str):
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
    import sqlite3 as _sqlite3
    from agent.config import RPC_URL, CONTRACT_ADDRESS

    BET_PLACED_ABI = [{"type":"event","name":"BetPlaced","inputs":[
        {"name":"marketId","type":"bytes32","indexed":True},
        {"name":"user","type":"address","indexed":True},
        {"name":"isYes","type":"bool","indexed":False},
        {"name":"amount","type":"uint256","indexed":False}
    ],"anonymous":False}]

    db = _sqlite3.connect(DB_PATH)
    db.row_factory = _sqlite3.Row
    _ensure_user_bets_table(db)

    row = db.execute("SELECT value FROM chain_cache WHERE key='bets_last_block'").fetchone()
    scan_from = int(row[0]) if row else DEPLOY_BLOCK

    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        latest = w3.eth.block_number
        contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=BET_PLACED_ABI)
        if scan_from <= latest:
            _sync_user_bets(db, w3, contract, scan_from, latest)
            db.execute("INSERT OR REPLACE INTO chain_cache (key, value) VALUES ('bets_last_block', ?)", (str(latest+1),))
            db.commit()
    except Exception:
        pass

    wallet = address.lower()
    rows = db.execute(
        """SELECT market_id, SUM(CASE WHEN is_yes=1 THEN amount ELSE 0 END) as yes_amt,
                  SUM(CASE WHEN is_yes=0 THEN amount ELSE 0 END) as no_amt
           FROM user_bets WHERE wallet=?
           GROUP BY market_id""",
        (wallet,)
    ).fetchall()

    if not rows:
        return []

    market_ids = [r[0] for r in rows]
    placeholders = ",".join("?" * len(market_ids))
    markets_rows = db.execute(
        f"SELECT * FROM markets WHERE market_id_hex IN ({placeholders})", market_ids
    ).fetchall()
    markets_map = {m["market_id_hex"]: dict(m) for m in markets_rows}

    result = []
    for r in rows:
        mid     = r[0]
        yes_amt = r[1] or 0
        no_amt  = r[2] or 0
        m       = markets_map.get(mid)
        if not m:
            continue
        result.append({"market_id": mid, "market": m, "yes_amt": yes_amt, "no_amt": no_amt})

    db.close()
    return result
