"""
AgoraFX Agent — x402 payment client.

The agent pays $0.001 USDC per signal fetch via the x402 protocol.
x402 signs an EIP-712 typed data payload; the x402 Python SDK's
EthAccountSigner.sign_typed_data() handles this correctly.

Signing key: DEPLOYER_PRIVATE_KEY (the agent's operational EOA).
Circle Agent Wallet (0xf06774...) is the identity and balance layer.

Budget cap: DAILY_BUDGET_USDC — enforced before every fetch.
Every decision (PAID / CACHED / HOLD / ERROR) is written to x402_spend.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import date, datetime
from typing import Any

import httpx
from eth_account import Account
from x402 import x402Client
from x402.http.clients.httpx import x402AsyncTransport
from x402.mechanisms.evm.exact import ExactEvmScheme
from x402.mechanisms.evm.signers import EthAccountSigner

from .config import (
    AGENT_WALLET_ADDRESS,
    BACKEND_URL,
    DAILY_BUDGET_USDC,
    PRIVATE_KEY,
    X402_SIGNAL_PRICE_USDC,
)
from .db import get_conn

log = logging.getLogger("x402_client")

ARC_TESTNET_NETWORK = "eip155:5042002"
SIGNAL_URL = f"{BACKEND_URL.rstrip('/')}/rates/signal"


# ── x402 HTTP client (singleton) ────────────────────────────────────────────

def _build_client() -> httpx.AsyncClient:
    """
    httpx.AsyncClient backed by x402AsyncTransport.

    On a 402 response the transport:
      1. Parses payment requirements from PAYMENT-REQUIRED header
      2. Calls ExactEvmScheme.create_payment_payload()
         → EthAccountSigner.sign_typed_data() — EIP-712 signed authorization
      3. Adds PAYMENT-SIGNATURE header and retries
      4. Returns the settled response
    """
    account = Account.from_key(PRIVATE_KEY)
    signer  = EthAccountSigner(account)

    x402 = x402Client()
    x402.register_v1("eip155:5042002", ExactEvmScheme(signer=signer))

    log.info(
        "x402 client: signer=%s network=%s",
        account.address, ARC_TESTNET_NETWORK,
    )
    return httpx.AsyncClient(
        transport=x402AsyncTransport(x402),
        timeout=30.0,
        headers={"User-Agent": f"AgoraFX-Agent/2.0 ({AGENT_WALLET_ADDRESS})"},
    )


_http: httpx.AsyncClient | None = None
_http_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        async with _http_lock:
            if _http is None:
                _http = _build_client()
    return _http


# ── Budget tracking (SQLite) ────────────────────────────────────────────────

def _today() -> str:
    return date.today().isoformat()


def daily_spend() -> float:
    row = get_conn().execute(
        "SELECT COALESCE(SUM(cost_usdc), 0) FROM x402_spend WHERE spend_date = ?",
        (_today(),),
    ).fetchone()
    return float(row[0]) if row else 0.0


def _record(
    action: str,
    url: str,
    cost_usdc: float,
    pair: str | None = None,
    confidence: float | None = None,
    rate: float | None = None,
) -> str:
    """Insert one decision row, return reasoning_hash."""
    h = hashlib.sha256(
        f"{action}|{url}|{cost_usdc}|{pair}|{confidence}|{rate}|{time.time()}".encode()
    ).hexdigest()
    conn = get_conn()
    conn.execute(
        """
        INSERT OR IGNORE INTO x402_spend
            (reasoning_hash, action, url, pair, confidence,
             cost_usdc, rate, spend_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (h, action, url, pair, confidence, cost_usdc, rate,
         _today(), datetime.utcnow().isoformat()),
    )
    conn.commit()
    return h


# ── Public API ───────────────────────────────────────────────────────────────

async def pay_and_fetch(
    url: str = SIGNAL_URL,
    amount_usdc: float = X402_SIGNAL_PRICE_USDC,
    pair: str | None = None,
    confidence: float | None = None,
) -> dict[str, Any]:
    """
    Fetch a paywalled URL, paying via x402 (EIP-712 signed authorization).

    Decision gates:
      HOLD   — daily budget would be exceeded
      CACHED — confidence < 0.20 (not worth paying)
      PAID   — fetch, pay, log

    Returns:
      { action, data, reasoning_hash, cost_usdc, daily_spend }
    """
    spent = daily_spend()

    # ── Budget guard ─────────────────────────────────────────────────────────
    if spent + amount_usdc > DAILY_BUDGET_USDC:
        log.warning("Budget exhausted (%.4f / %.4f) — HOLD", spent, DAILY_BUDGET_USDC)
        h = _record("HOLD", url, 0.0, pair, confidence)
        return {"action": "HOLD", "data": None, "reasoning_hash": h,
                "cost_usdc": 0.0, "daily_spend": spent}

    # ── Low-confidence guard ──────────────────────────────────────────────────
    if confidence is not None and confidence < 0.20:
        log.info("Confidence %.2f < 0.20 — CACHED", confidence)
        h = _record("CACHED", url, 0.0, pair, confidence)
        return {"action": "CACHED", "data": None, "reasoning_hash": h,
                "cost_usdc": 0.0, "daily_spend": spent}

    # ── Pay ───────────────────────────────────────────────────────────────────
    try:
        client = await _get_client()
        resp   = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

        # Only record as PAID if server confirmed settlement via PAYMENT-RESPONSE header.
        # If the middleware is disabled, the endpoint returns 200 freely — we don't
        # count that as a payment (no USDC moved).
        payment_confirmed = bool(
            resp.headers.get("payment-response")
            or resp.headers.get("x-payment-response")
        )

        if payment_confirmed:
            actual_cost  = amount_usdc
            action       = "PAID"
            log.info(
                "x402 PAID: $%.4f | pair=%s | conf=%s | hash=%.12s",
                actual_cost, pair or data.get("pair", "?"),
                f"{confidence:.2f}" if confidence is not None else "n/a",
                "pending",
            )
        else:
            actual_cost = 0.0
            action      = "CACHED"
            log.warning(
                "x402: signal fetched FREE — middleware not active or no payment required. "
                "Pair=%s rate=%s", data.get("pair"), data.get("rate")
            )

        h = _record(action, url, actual_cost, pair, confidence, data.get("rate"))
        if action == "PAID":
            log.info("hash=%.12s", h)

        return {
            "action": action, "data": data, "reasoning_hash": h,
            "cost_usdc": actual_cost, "daily_spend": spent + actual_cost,
        }

    except httpx.HTTPStatusError as exc:
        log.error("x402 HTTP %d: %s", exc.response.status_code, exc)
        h = _record("ERROR", url, 0.0, pair, confidence)
        return {"action": "ERROR", "data": None, "reasoning_hash": h,
                "cost_usdc": 0.0, "error": str(exc), "daily_spend": spent}

    except Exception as exc:
        log.error("pay_and_fetch error: %s", exc, exc_info=True)
        h = _record("ERROR", url, 0.0, pair, confidence)
        return {"action": "ERROR", "data": None, "reasoning_hash": h,
                "cost_usdc": 0.0, "error": str(exc), "daily_spend": spent}


async def get_decisions(limit: int = 50, offset: int = 0) -> list[dict]:
    cols = [
        "reasoning_hash", "action", "url", "pair", "confidence",
        "cost_usdc", "rate", "spend_date", "created_at",
    ]
    rows = get_conn().execute(
        f"SELECT {', '.join(cols)} FROM x402_spend "
        f"ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    return [dict(zip(cols, r)) for r in rows]
