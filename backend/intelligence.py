"""
AgoraFX — Market Intelligence router (v2-Phase 4 / RFB-06)

Endpoints
---------
POST /intelligence                → publish article (free, analyst-signed)
GET  /intelligence                → list articles  (title + preview, no gate)
GET  /intelligence/{id}           → full article   (x402 gated, $0.05 USDC)
GET  /intelligence/stats          → total earnings, article count
GET  /intelligence/{id}/status    → payout tx status for a given article-read

Payment flow
------------
1. Reader hits GET /intelligence/{id}
2. x402 middleware demands $0.05 EIP-712 payment → returns 402 if missing
3. Once middleware passes, payer address is injected as `analyst_share_payer`
4. Article content returned to reader immediately (low latency)
5. asyncio background task fires raw ERC-20 transfer:
       receiver wallet (DEPLOYER_PRIVATE_KEY) → analyst wallet   $0.04 (80%)
6. Both the $0.05 reader payment and $0.04 analyst payout visible on arcscan.app
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from .x402_middleware import make_x402_guard
from agent.db import get_conn

log = logging.getLogger("intelligence")

# ── Environment ──────────────────────────────────────────────────────────────

RPC_URL          = os.getenv("ARC_TESTNET_RPC_URL", "https://rpc.testnet.arc.network")
PRIVATE_KEY      = os.getenv("DEPLOYER_PRIVATE_KEY", "")
USDC_ADDRESS     = os.getenv("USDC_ADDRESS", "0x3600000000000000000000000000000000000000")
ARTICLE_PRICE    = float(os.getenv("X402_ARTICLE_PRICE_USDC", "0.05"))
RECEIVER_ADDRESS = os.getenv("X402_RECEIVER_ADDRESS", "")   # controlled by DEPLOYER_PRIVATE_KEY

ANALYST_SHARE_PCT = 0.80   # 80% to analyst
PROTOCOL_SHARE_PCT = 0.20  # 20% to protocol treasury

# Minimal ERC-20 ABI — only transfer() needed
USDC_TRANSFER_ABI = [
    {
        "type": "function",
        "name": "transfer",
        "inputs": [
            {"name": "to",     "type": "address"},
            {"name": "value",  "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
    }
]

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

# ── DB helpers ───────────────────────────────────────────────────────────────

def init_intelligence_tables() -> None:
    """Create intelligence tables if they don't exist. Safe to call multiple times."""
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS intelligence_articles (
            id              TEXT PRIMARY KEY,
            title           TEXT    NOT NULL,
            author_wallet   TEXT    NOT NULL,
            pair            TEXT,
            preview         TEXT,
            content         TEXT    NOT NULL,
            created_at      TIMESTAMP DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS intelligence_payments (
            id              TEXT PRIMARY KEY,
            article_id      TEXT    NOT NULL,
            reader_wallet   TEXT    NOT NULL,
            amount_usdc     REAL    NOT NULL,
            analyst_share   REAL    NOT NULL,
            protocol_share  REAL    NOT NULL,
            payout_tx       TEXT,
            payout_status   TEXT    DEFAULT 'pending',
            paid_at         TIMESTAMP DEFAULT (datetime('now')),
            FOREIGN KEY (article_id) REFERENCES intelligence_articles(id)
        );

        CREATE INDEX IF NOT EXISTS idx_intel_payments_article
            ON intelligence_payments(article_id);
        CREATE INDEX IF NOT EXISTS idx_intel_payments_reader
            ON intelligence_payments(reader_wallet);
        CREATE INDEX IF NOT EXISTS idx_intel_articles_author
            ON intelligence_articles(author_wallet);
    """)
    conn.commit()
    log.info("Intelligence tables initialised")


def _article_id(title: str, author: str) -> str:
    return hashlib.sha256(
        f"{title}|{author}|{time.time()}".encode()
    ).hexdigest()[:24]


def _payment_id(article_id: str, reader: str) -> str:
    return hashlib.sha256(
        f"{article_id}|{reader}|{time.time()}".encode()
    ).hexdigest()[:24]


# ── ERC-20 payout (background task) ─────────────────────────────────────────

def _send_analyst_payout(
    analyst_wallet: str,
    payment_id: str,
    analyst_share_units: int,
) -> None:
    """
    Blocking function — called via asyncio.to_thread so it doesn't block the
    event loop. Sends a raw ERC-20 USDC transfer from the receiver wallet
    (controlled by DEPLOYER_PRIVATE_KEY) to the analyst wallet.
    """
    conn = get_conn()

    if not PRIVATE_KEY:
        log.error("payout skipped — DEPLOYER_PRIVATE_KEY not set")
        conn.execute(
            "UPDATE intelligence_payments SET payout_status='error_no_key' WHERE id=?",
            (payment_id,)
        )
        conn.commit()
        return

    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 30}))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        account  = w3.eth.account.from_key(PRIVATE_KEY)
        usdc     = w3.eth.contract(
            address=Web3.to_checksum_address(USDC_ADDRESS),
            abi=USDC_TRANSFER_ABI,
        )
        checksum_analyst = Web3.to_checksum_address(analyst_wallet)

        nonce    = w3.eth.get_transaction_count(account.address)
        gas_est  = usdc.functions.transfer(
            checksum_analyst, analyst_share_units
        ).estimate_gas({"from": account.address})

        tx = usdc.functions.transfer(
            checksum_analyst, analyst_share_units
        ).build_transaction({
            "from":     account.address,
            "nonce":    nonce,
            "gas":      int(gas_est * 1.2),      # 20% buffer
            "gasPrice": w3.eth.gas_price,
            "chainId":  w3.eth.chain_id,
        })

        signed  = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        tx_hex = receipt["transactionHash"].hex()
        status  = "confirmed" if receipt["status"] == 1 else "reverted"

        conn.execute(
            "UPDATE intelligence_payments SET payout_tx=?, payout_status=? WHERE id=?",
            (tx_hex, status, payment_id)
        )
        conn.commit()

        log.info(
            "Analyst payout %s | %d USDC-units → %s | tx=%s | status=%s",
            payment_id, analyst_share_units, analyst_wallet, tx_hex, status
        )

    except Exception as exc:
        log.error("Analyst payout failed (payment_id=%s): %s", payment_id, exc, exc_info=True)
        try:
            conn.execute(
                "UPDATE intelligence_payments SET payout_status='error' WHERE id=?",
                (payment_id,)
            )
            conn.commit()
        except Exception:
            pass


async def _async_payout(analyst_wallet: str, payment_id: str, analyst_share_units: int) -> None:
    """Wrap the blocking payout in asyncio.to_thread to avoid blocking the event loop."""
    await asyncio.to_thread(_send_analyst_payout, analyst_wallet, payment_id, analyst_share_units)


# ── Pydantic models ───────────────────────────────────────────────────────────

class PublishArticle(BaseModel):
    title:         str
    author_wallet: str
    pair:          str | None = None
    preview:       str | None = None
    content:       str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("")
def publish_article(body: PublishArticle):
    """
    Publish an FX intelligence article. Free to submit. Author wallet is
    self-declared — no auth required (hackathon scope). In production this
    would require a signed message proving wallet ownership.
    """
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title required")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="content required")
    if not body.author_wallet.startswith("0x") or len(body.author_wallet) != 42:
        raise HTTPException(status_code=400, detail="invalid author_wallet")

    article_id = _article_id(body.title, body.author_wallet)
    preview    = body.preview or body.content[:280] + ("…" if len(body.content) > 280 else "")

    conn = get_conn()
    conn.execute(
        """INSERT INTO intelligence_articles
               (id, title, author_wallet, pair, preview, content)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (article_id, body.title.strip(), body.author_wallet.lower(),
         body.pair, preview, body.content.strip())
    )
    conn.commit()

    log.info("Article published: %s by %s", article_id, body.author_wallet)
    return {
        "ok":         True,
        "article_id": article_id,
        "title":      body.title,
        "preview":    preview,
    }


@router.get("/stats")
def intelligence_stats():
    """Public stats: total articles, total analyst earnings, payment count."""
    conn = get_conn()

    article_count = conn.execute(
        "SELECT COUNT(*) FROM intelligence_articles"
    ).fetchone()[0]

    total_earned = conn.execute(
        "SELECT COALESCE(SUM(analyst_share), 0) FROM intelligence_payments WHERE payout_status='confirmed'"
    ).fetchone()[0]

    payment_count = conn.execute(
        "SELECT COUNT(*) FROM intelligence_payments"
    ).fetchone()[0]

    top_authors = conn.execute(
        """SELECT a.author_wallet,
                  COUNT(p.id)         AS articles_sold,
                  COALESCE(SUM(p.analyst_share), 0) AS total_earned
           FROM intelligence_articles a
           LEFT JOIN intelligence_payments p ON p.article_id = a.id
                                            AND p.payout_status = 'confirmed'
           GROUP BY a.author_wallet
           ORDER BY total_earned DESC
           LIMIT 5"""
    ).fetchall()

    return {
        "article_count":   article_count,
        "total_earned":    round(float(total_earned), 6),
        "payment_count":   payment_count,
        "top_authors": [
            {
                "wallet":        row[0],
                "articles_sold": row[1],
                "total_earned":  round(float(row[2]), 6),
            }
            for row in top_authors
        ],
    }


@router.get("")
def list_articles(limit: int = 50, offset: int = 0, pair: str | None = None):
    """
    Public feed — returns title + preview only. Content is gated.
    Optionally filter by currency pair.
    """
    conn = get_conn()

    if pair:
        rows = conn.execute(
            """SELECT a.id, a.title, a.author_wallet, a.pair, a.preview, a.created_at,
                      COUNT(p.id) AS read_count
               FROM intelligence_articles a
               LEFT JOIN intelligence_payments p ON p.article_id = a.id
               WHERE a.pair = ?
               GROUP BY a.id
               ORDER BY a.created_at DESC
               LIMIT ? OFFSET ?""",
            (pair, limit, offset)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT a.id, a.title, a.author_wallet, a.pair, a.preview, a.created_at,
                      COUNT(p.id) AS read_count
               FROM intelligence_articles a
               LEFT JOIN intelligence_payments p ON p.article_id = a.id
               GROUP BY a.id
               ORDER BY a.created_at DESC
               LIMIT ? OFFSET ?""",
            (limit, offset)
        ).fetchall()

    return [
        {
            "id":           row[0],
            "title":        row[1],
            "author_wallet": row[2],
            "pair":         row[3],
            "preview":      row[4],
            "created_at":   row[5],
            "read_count":   row[6],
            "price_usdc":   ARTICLE_PRICE,
        }
        for row in rows
    ]


@router.get("/{article_id}/status")
def article_payment_status(article_id: str, reader: str):
    """
    Check if a specific reader has paid for an article and what the payout
    tx looks like. Used by the frontend to show the arcscan link.
    """
    conn = get_conn()
    row = conn.execute(
        """SELECT p.id, p.amount_usdc, p.analyst_share, p.payout_tx,
                  p.payout_status, p.paid_at
           FROM intelligence_payments p
           WHERE p.article_id = ? AND p.reader_wallet = ?
           ORDER BY p.paid_at DESC LIMIT 1""",
        (article_id, reader.lower())
    ).fetchone()

    if not row:
        return {"paid": False}

    return {
        "paid":           True,
        "payment_id":     row[0],
        "amount_usdc":    row[1],
        "analyst_share":  row[2],
        "payout_tx":      row[3],
        "payout_status":  row[4],
        "paid_at":        row[5],
        "arcscan_url":    f"https://testnet.arcscan.app/tx/{row[3]}" if row[3] else None,
    }


@router.get("/{article_id}/read")
def read_article_bypass(article_id: str, reader: str):
    """
    Wallet-verified re-read endpoint — no x402 payment required.
    Returns full article content if the reader wallet already paid.

    Called by the frontend on mount to check if this wallet already paid
    and restore the article without charging again. Works across devices,
    tab switches, refreshes, and wallet switches.

    GET /intelligence/{id}/read?reader=0x...
    → {"paid": false}                          — not paid, frontend shows paywall
    → {"paid": true, "content": "...", ...}    — paid, frontend shows article
    """
    if not reader or not reader.startswith("0x"):
        raise HTTPException(status_code=400, detail="reader wallet address required")

    conn = get_conn()

    # Check payment record
    payment_row = conn.execute(
        """SELECT p.id, p.amount_usdc, p.analyst_share, p.payout_tx,
                  p.payout_status, p.paid_at
           FROM intelligence_payments p
           WHERE p.article_id = ? AND p.reader_wallet = ?
           ORDER BY p.paid_at DESC LIMIT 1""",
        (article_id, reader.lower())
    ).fetchone()

    if not payment_row:
        return {"paid": False}

    # Wallet paid — return full content
    article = conn.execute(
        "SELECT * FROM intelligence_articles WHERE id = ?",
        (article_id,)
    ).fetchone()

    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    article_dict = dict(article)

    return {
        "paid":           True,
        "id":             article_dict["id"],
        "title":          article_dict["title"],
        "author_wallet":  article_dict["author_wallet"],
        "pair":           article_dict["pair"],
        "content":        article_dict["content"],
        "created_at":     article_dict["created_at"],
        "payment": {
            "payment_id":    payment_row[0],
            "amount_usdc":   payment_row[1],
            "analyst_share": payment_row[2],
            "payout_tx":     payment_row[3],
            "payout_status": payment_row[4],
            "paid_at":       payment_row[5],
            "arcscan_url":   f"https://testnet.arcscan.app/tx/{payment_row[3]}" if payment_row[3] else None,
        },
    }


@router.get("/{article_id}")
async def get_article(
    article_id: str,
    background_tasks: BackgroundTasks,
    payer: str = Depends(make_x402_guard(price_usdc=ARTICLE_PRICE)),
):
    """
    x402 gated — $0.05 USDC per read.
    Depends(require_x402) enforces EIP-712 payment before this handler runs.
    payer = verified signer address recovered from EIP-712 signature.

    After the 200 is returned, a background task fires the analyst payout.
    """
    conn = get_conn()

    article = conn.execute(
        "SELECT * FROM intelligence_articles WHERE id = ?",
        (article_id,)
    ).fetchone()

    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    article_dict: dict[str, Any] = dict(article)

    # ── Record the payment ────────────────────────────────────────────────────
    analyst_share   = round(ARTICLE_PRICE * ANALYST_SHARE_PCT, 6)
    protocol_share  = round(ARTICLE_PRICE * PROTOCOL_SHARE_PCT, 6)
    payment_id      = _payment_id(article_id, payer)
    analyst_wallet  = article_dict["author_wallet"]

    conn.execute(
        """INSERT OR IGNORE INTO intelligence_payments
               (id, article_id, reader_wallet, amount_usdc, analyst_share, protocol_share)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (payment_id, article_id, payer.lower(),
         ARTICLE_PRICE, analyst_share, protocol_share)
    )
    conn.commit()

    # ── Fire analyst payout as background task ────────────────────────────────
    # Converts USDC amount to on-chain units (6 decimals)
    analyst_share_units = int(analyst_share * 1_000_000)

    background_tasks.add_task(
        _async_payout,
        analyst_wallet,
        payment_id,
        analyst_share_units,
    )

    log.info(
        "Article %s unlocked by %s | payout $%.4f → %s (background)",
        article_id, payer, analyst_share, analyst_wallet
    )

    # ── Response — return full content immediately ─────────────────────────────
    return JSONResponse(content={
        "id":             article_dict["id"],
        "title":          article_dict["title"],
        "author_wallet":  article_dict["author_wallet"],
        "pair":           article_dict["pair"],
        "content":        article_dict["content"],
        "created_at":     article_dict["created_at"],
        "payment": {
            "payment_id":     payment_id,
            "amount_usdc":    ARTICLE_PRICE,
            "analyst_share":  analyst_share,
            "protocol_share": protocol_share,
            "payout_status":  "pending",   # background task fires after this response
        },
        "x402_version": 1,
    })

