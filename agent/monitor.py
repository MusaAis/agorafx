"""
Rate Monitor — polls EURC/USDC and USDC/NGN every 30s.
EURC/USDC : OKX public API (no geo-block, real-time)
USDC/NGN  : Flutterwave (primary) → ExchangeRate API (fallback)
"""
import asyncio
import logging
import os
import httpx
from .config import MONITOR_INTERVAL_SEC, RATE_SCALE
from .db     import insert_rate

log = logging.getLogger("monitor")
EXCHANGERATE_URL = "https://open.er-api.com/v6/latest/USD"
FLW_SECRET_KEY   = os.getenv("FLW_SECRET_KEY")


async def fetch_eurc_usdc(client: httpx.AsyncClient) -> float | None:
    """EUR/USDT from OKX — real-time, globally accessible, no key needed."""
    try:
        r = await client.get(
            "https://www.okx.com/api/v5/market/ticker",
            params={"instId": "EUR-USDT"},
            timeout=10
        )
        r.raise_for_status()
        data = r.json()
        price = data["data"][0]["last"]
        return float(price)
    except Exception as e:
        log.warning(f"OKX fetch failed: {e}")
        # Fallback: ExchangeRate API
        try:
            r2 = await client.get(
                "https://open.er-api.com/v6/latest/EUR",
                timeout=10
            )
            r2.raise_for_status()
            usd = r2.json().get("rates", {}).get("USD")
            return float(usd) if usd else None
        except Exception as e2:
            log.warning(f"ExchangeRate fallback failed: {e2}")
            return None


async def fetch_ngn_rate(client: httpx.AsyncClient) -> float | None:
    """NGN per 1 USDC — Flutterwave primary, ExchangeRate fallback."""
    if FLW_SECRET_KEY:
        try:
            r = await client.get(
                "https://api.flutterwave.com/v3/rates",
                params={"from": "USD", "to": "NGN", "amount": "1"},
                headers={"Authorization": f"Bearer {FLW_SECRET_KEY}"},
                timeout=10
            )
            r.raise_for_status()
            rate = r.json().get("data", {}).get("to", {}).get("amount")
            if rate:
                return float(rate)
        except Exception as e:
            log.warning(f"Flutterwave failed: {e}")

    try:
        r = await client.get(EXCHANGERATE_URL, timeout=10)
        r.raise_for_status()
        ngn = r.json().get("rates", {}).get("NGN")
        return float(ngn) if ngn else None
    except Exception as e:
        log.warning(f"ExchangeRate fallback failed: {e}")
        return None


async def poll_once():
    async with httpx.AsyncClient() as client:
        eurc_rate = await fetch_eurc_usdc(client)
        ngn_rate  = await fetch_ngn_rate(client)

    if eurc_rate:
        scaled = int(eurc_rate * RATE_SCALE)
        insert_rate("USDC/EURC", eurc_rate, scaled, "okx")
        log.info(f"EURC/USDC  = {eurc_rate:.6f}")

    if ngn_rate:
        scaled = int(ngn_rate * RATE_SCALE)
        insert_rate("USDC/NGN", ngn_rate, scaled,
                    "flutterwave" if FLW_SECRET_KEY else "exchangerate-api")
        log.info(f"1 USDC     = ₦{ngn_rate:,.2f}")


async def run_monitor():
    log.info(f"Rate monitor started (interval: {MONITOR_INTERVAL_SEC}s)")
    while True:
        try:
            await poll_once()
        except Exception as e:
            log.error(f"Monitor error: {e}")
        await asyncio.sleep(MONITOR_INTERVAL_SEC)

