"""
SQLite layer — stores rate snapshots, agent decisions, and market log.
"""
import sqlite3
import threading
from datetime import datetime

DB_PATH = "agorafx.db"
_local  = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS rates (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pair        TEXT    NOT NULL,        -- e.g. 'USDC/EURC'
            rate        REAL    NOT NULL,         -- human-readable float
            rate_scaled INTEGER NOT NULL,         -- rate × 1e6 for contract
            source      TEXT    NOT NULL,
            recorded_at TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS decisions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            pair          TEXT    NOT NULL,
            action        TEXT    NOT NULL,       -- 'create_market' | 'hold'
            reasoning     TEXT,
            threshold     INTEGER,                -- scaled × 1e6
            is_above      INTEGER,                -- 1 = YES wins if rate >= threshold
            market_id_hex TEXT,                   -- onchain bytes32 after creation
            created_at    TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS markets (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id_hex TEXT    UNIQUE NOT NULL,
            pair          TEXT    NOT NULL,
            question      TEXT    NOT NULL,
            threshold     INTEGER NOT NULL,
            is_above      INTEGER NOT NULL,
            expiry_ts     INTEGER NOT NULL,
            tx_hash       TEXT,
            resolved      INTEGER DEFAULT 0,
            outcome       TEXT,
            created_at    TEXT    NOT NULL
        );
    """)
    conn.commit()


# ── Rates ─────────────────────────────────────────────────────────

def insert_rate(pair: str, rate: float, rate_scaled: int, source: str):
    conn = get_conn()
    conn.execute(
        "INSERT INTO rates (pair, rate, rate_scaled, source, recorded_at) VALUES (?,?,?,?,?)",
        (pair, rate, rate_scaled, source, datetime.utcnow().isoformat())
    )
    conn.commit()


def get_recent_rates(pair: str, limit: int = 20) -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM rates WHERE pair=? ORDER BY id DESC LIMIT ?",
        (pair, limit)
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


# ── Decisions ─────────────────────────────────────────────────────

def insert_decision(pair, action, reasoning, threshold=None, is_above=None, market_id_hex=None):
    conn = get_conn()
    conn.execute(
        """INSERT INTO decisions
           (pair, action, reasoning, threshold, is_above, market_id_hex, created_at)
           VALUES (?,?,?,?,?,?,?)""",
        (pair, action, reasoning, threshold, is_above, market_id_hex,
         datetime.utcnow().isoformat())
    )
    conn.commit()


# ── Markets ───────────────────────────────────────────────────────

def insert_market(market_id_hex, pair, question, threshold, is_above, expiry_ts, tx_hash):
    conn = get_conn()
    conn.execute(
        """INSERT OR IGNORE INTO markets
           (market_id_hex, pair, question, threshold, is_above, expiry_ts, tx_hash, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (market_id_hex, pair, question, threshold, is_above, expiry_ts, tx_hash,
         datetime.utcnow().isoformat())
    )
    conn.commit()


def get_unresolved_markets() -> list:
    conn = get_conn()
    import time
    rows = conn.execute(
        "SELECT * FROM markets WHERE resolved=0 AND expiry_ts <= ?",
        (int(time.time()),)
    ).fetchall()
    return [dict(r) for r in rows]


def mark_market_resolved(market_id_hex: str, outcome: str):
    conn = get_conn()
    conn.execute(
        "UPDATE markets SET resolved=1, outcome=? WHERE market_id_hex=?",
        (outcome, market_id_hex)
    )
    conn.commit()
