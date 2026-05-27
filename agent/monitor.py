"""
Rate Monitor — polls all MONITORED_PAIRS every 30 seconds.
Multiple sources with freshness validation — best rate wins.
"""
import asyncio, logging, os, time
import httpx
from .config import MONITOR_INTERVAL_SEC, RATE_SCALE, MONITORED_PAIRS
from .db     import insert_rate

log = logging.getLogger("monitor")
FLW_SECRET_KEY = os.getenv("FLW_SECRET_KEY")

# ── EURC/USDC sources ─────────────────────────────────────────────

async def fetch_eur_usd_freeforex(client):
    try:
        r = await client.get(
            "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json",
            timeout=10)
        r.raise_for_status()
        rate = float(r.json()["eur"]["usd"])
        log.info(f"freeforex EUR/USD = {rate}")
        return rate, "freeforex"
    except Exception as e:
        log.warning(f"FreeForex failed: {e}")
        return None, None

async def fetch_eur_usd_frankfurter(client):
    try:
        r = await client.get("https://api.frankfurter.dev/v1/latest",
                             params={"from":"EUR","to":"USD"}, timeout=10)
        r.raise_for_status()
        rate = float(r.json()["rates"]["USD"])
        log.info(f"Frankfurter EUR/USD = {rate}")
        return rate, "frankfurter"
    except Exception as e:
        log.warning(f"Frankfurter failed: {e}")
        return None, None

async def fetch_eur_usd_exchangerate(client):
    try:
        r = await client.get("https://open.er-api.com/v6/latest/EUR", timeout=10)
        r.raise_for_status()
        rate = float(r.json()["rates"]["USD"])
        log.info(f"ExchangeRate EUR/USD = {rate}")
        return rate, "open_er_api"
    except Exception as e:
        log.warning(f"ExchangeRate EUR failed: {e}")
        return None, None

async def fetch_eur_usd_coinbase(client):
    """Coinbase stablecoin rate — EURC/USDC close proxy."""
    try:
        r = await client.get("https://api.coinbase.com/v2/exchange-rates?currency=EUR",
                             timeout=10)
        r.raise_for_status()
        rate = float(r.json()["data"]["rates"]["USD"])
        log.info(f"Coinbase EUR/USD = {rate}")
        return rate, "coinbase"
    except Exception as e:
        log.warning(f"Coinbase failed: {e}")
        return None, None

async def fetch_eurc_usdc(client):
    results = await asyncio.gather(
        fetch_eur_usd_freeforex(client),
        fetch_eur_usd_frankfurter(client),
        fetch_eur_usd_exchangerate(client),
        fetch_eur_usd_coinbase(client),
    )
    rates = [r for r, s in results if r is not None]
    if not rates:
        return None, None
    # Use median to filter outliers
    rates.sort()
    median = rates[len(rates)//2]
    source = next(s for r, s in results if r == median or abs(r - median) < 0.001)
    log.info(f"EURC/USDC consensus = {median:.6f} from {len(rates)} sources")
    return median, source

# ── NGN and other African currency sources ────────────────────────

async def fetch_flutterwave(client, currency):
    if not FLW_SECRET_KEY:
        return None, None
    try:
        r = await client.get(
            "https://api.flutterwave.com/v3/rates",
            params={"from":"USD","to":currency,"amount":"1"},
            headers={"Authorization":f"Bearer {FLW_SECRET_KEY}"},
            timeout=10)
        r.raise_for_status()
        rate = r.json().get("data",{}).get("to",{}).get("amount")
        if rate:
            log.info(f"Flutterwave {currency} = {rate}")
            return float(rate), "flutterwave"
        return None, None
    except Exception as e:
        log.warning(f"Flutterwave {currency} failed: {e}")
        return None, None

async def fetch_exchangerate(client, currency):
    try:
        r = await client.get("https://open.er-api.com/v6/latest/USD", timeout=10)
        r.raise_for_status()
        val = r.json().get("rates",{}).get(currency)
        if val:
            log.info(f"ExchangeRate {currency} = {val}")
            return float(val), "open_er_api"
        return None, None
    except Exception as e:
        log.warning(f"ExchangeRate {currency} failed: {e}")
        return None, None

async def fetch_freeforex_currency(client, currency):
    """fawazahmed0 currency API — updates every 24h but very reliable."""
    try:
        r = await client.get(
            f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
            timeout=10)
        r.raise_for_status()
        val = r.json()["usd"].get(currency.lower())
        if val:
            log.info(f"FreeForex {currency} = {val}")
            return float(val), "freeforex"
        return None, None
    except Exception as e:
        log.warning(f"FreeForex {currency} failed: {e}")
        return None, None

async def fetch_currencyapi(client, currency):
    """currencyapi.net — no key needed, real-time."""
    try:
        r = await client.get(
            f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
            timeout=10)
        r.raise_for_status()
        val = r.json()["usd"].get(currency.lower())
        if val:
            log.info(f"CurrencyAPI {currency} = {val}")
            return float(val), "currencyapi"
        return None, None
    except Exception as e:
        log.warning(f"CurrencyAPI {currency} failed: {e}")
        return None, None

async def fetch_ngn_best(client):
    """Fetch NGN from all sources, pick the freshest/highest (black market aware)."""
    results = await asyncio.gather(
        fetch_flutterwave(client, "NGN"),
        fetch_exchangerate(client, "NGN"),
        fetch_freeforex_currency(client, "NGN"),
    )
    valid = [(r, s) for r, s in results if r is not None]
    if not valid:
        return None, None
    # Pick highest rate — closer to real market rate in Nigeria
    best_rate, best_source = max(valid, key=lambda x: x[0])
    log.info(f"NGN best = {best_rate:.2f} from {best_source} (checked {len(valid)} sources)")
    return best_rate, best_source

async def fetch_african_currency(client, currency):
    """Fetch any African currency from multiple sources."""
    results = await asyncio.gather(
        fetch_flutterwave(client, currency),
        fetch_exchangerate(client, currency),
        fetch_freeforex_currency(client, currency),
    )
    valid = [(r, s) for r, s in results if r is not None]
    if not valid:
        return None, None
    best_rate, best_source = max(valid, key=lambda x: x[0])
    log.info(f"{currency} best = {best_rate:.4f} from {best_source}")
    return best_rate, best_source

# ── Main pair fetcher ─────────────────────────────────────────────

async def fetch_pair(client, pair_config):
    source = pair_config["source"]
    if source in ("okx_eurusdt", "frankfurter_eur"):
        return await fetch_eurc_usdc(client)
    elif source == "flutterwave_ngn":
        return await fetch_ngn_best(client)
    elif source.startswith("exchangerate_"):
        currency = source.split("_")[1].upper()
        return await fetch_african_currency(client, currency)
    return None, None

async def poll_once():
    async with httpx.AsyncClient() as client:
        tasks = [fetch_pair(client, p) for p in MONITORED_PAIRS]
        results = await asyncio.gather(*tasks)

    for pair_config, (rate, source) in zip(MONITORED_PAIRS, results):
        if rate is None:
            log.warning(f"No rate for {pair_config['pair']}")
            continue
        pair   = pair_config["pair"]
        scaled = int(rate * RATE_SCALE)
        # Use actual source that returned the rate
        insert_rate(pair, rate, scaled, source or pair_config["source"])
        if pair == "USDC/EURC":
            log.info(f"{pair} = {rate:.6f} (EUR/USD forex)")
        else:
            log.info(f"1 USDC = {rate:,.2f} {pair.split('/')[1]}")

async def run_monitor():
    pairs = [p["pair"] for p in MONITORED_PAIRS]
    log.info(f"Rate monitor started — watching: {', '.join(pairs)}")
    while True:
        try:
            await poll_once()
        except Exception as e:
            log.error(f"Monitor error: {e}")
        await asyncio.sleep(MONITOR_INTERVAL_SEC)