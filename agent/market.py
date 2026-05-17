"""
Market — interacts with PredictionMarket.sol on Arc Testnet.
Handles createMarket(), resolveMarket(), and USDC approval.
"""
import json
import logging
import time
from pathlib import Path
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from .config  import RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, USDC_ADDRESS, RATE_SCALE
from .db      import insert_market, get_unresolved_markets, mark_market_resolved, get_recent_rates

log = logging.getLogger("market")

# ── Load ABI ─────────────────────────────────────────────────────


def _load_abi():
    return [
        {"type":"function","name":"createMarket","inputs":[{"name":"pair","type":"string"},{"name":"question","type":"string"},{"name":"threshold","type":"uint256"},{"name":"isAbove","type":"bool"},{"name":"expiry","type":"uint256"}],"outputs":[{"name":"marketId","type":"bytes32"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"resolveMarket","inputs":[{"name":"marketId","type":"bytes32"},{"name":"finalRate","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"function","name":"placeBet","inputs":[{"name":"marketId","type":"bytes32"},{"name":"isYes","type":"bool"},{"name":"amount","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"function","name":"claimWinnings","inputs":[{"name":"marketId","type":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"event","name":"MarketCreated","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"pair","type":"string","indexed":False},{"name":"question","type":"string","indexed":False},{"name":"threshold","type":"uint256","indexed":False},{"name":"isAbove","type":"bool","indexed":False},{"name":"expiry","type":"uint256","indexed":False}],"anonymous":False},
        {"type":"event","name":"MarketResolved","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"outcome","type":"uint8","indexed":False},{"name":"finalRate","type":"uint256","indexed":False}],"anonymous":False},
    ]

USDC_ABI = [
    {"type":"function","name":"approve","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable"},
    {"type":"function","name":"allowance","inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
]

# ── Web3 Setup ────────────────────────────────────────────────────

def get_w3() -> Web3:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return w3


def get_contracts(w3: Web3):
    abi      = _load_abi()
    market   = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=abi)
    usdc     = w3.eth.contract(address=Web3.to_checksum_address(USDC_ADDRESS), abi=USDC_ABI)
    return market, usdc


def _send_tx(w3: Web3, fn, account):
    """Build, sign, and send a transaction. Returns receipt."""
    tx = fn.build_transaction({
        "from":  account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas":   500_000,
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    return receipt, tx_hash.hex()


# ── Create Market ─────────────────────────────────────────────────

async def create_market_onchain(decision: dict) -> str | None:
    """
    Creates a prediction market on Arc from an AI decision.
    Returns the market_id hex string or None on failure.
    """
    w3       = get_w3()
    account  = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, _ = get_contracts(w3)

    pair       = decision["pair"]
    question   = decision["question"]
    threshold  = int(decision["threshold"])
    is_above   = bool(decision.get("is_above", True))
    expiry     = int(time.time()) + int(decision.get("expiry_offset_sec", 3600))

    log.info(f"Creating market: {question} | threshold={threshold} | expiry={expiry}")

    try:
        fn      = market_c.functions.createMarket(pair, question, threshold, is_above, expiry)
        receipt, tx_hash = _send_tx(w3, fn, account)

        if receipt["status"] != 1:
            log.error("createMarket tx reverted")
            return None

        # Parse MarketCreated event to get the market ID
        events = market_c.events.MarketCreated().process_receipt(receipt)
        if not events:
            log.error("No MarketCreated event found in receipt")
            return None

        market_id_hex = events[0]["args"]["marketId"].hex()
        log.info(f"Market created: 0x{market_id_hex} | tx: {tx_hash}")

        insert_market(
            market_id_hex = f"0x{market_id_hex}",
            pair          = pair,
            question      = question,
            threshold     = threshold,
            is_above      = int(is_above),
            expiry_ts     = expiry,
            tx_hash       = tx_hash,
        )
        return f"0x{market_id_hex}"

    except Exception as e:
        log.error(f"createMarket failed: {e}")
        return None


# ── Resolve Expired Markets ───────────────────────────────────────

async def resolve_expired_markets():
    """
    Finds expired unresolved markets, fetches the final rate,
    and calls resolveMarket() on each.
    """
    expired = get_unresolved_markets()
    if not expired:
        return

    w3      = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, _ = get_contracts(w3)

    for m in expired:
        market_id_hex = m["market_id_hex"]
        pair          = m["pair"]

        # Get the most recent rate for this pair as the final rate
        recent = get_recent_rates(pair, limit=1)
        if not recent:
            log.warning(f"No rate data to resolve market {market_id_hex}")
            continue

        final_rate_scaled = int(recent[0]["rate_scaled"])
        market_id_bytes   = bytes.fromhex(market_id_hex.replace("0x", ""))

        log.info(f"Resolving market {market_id_hex} with rate {final_rate_scaled}")

        try:
            fn = market_c.functions.resolveMarket(market_id_bytes, final_rate_scaled)
            receipt, tx_hash = _send_tx(w3, fn, account)

            if receipt["status"] != 1:
                log.error(f"resolveMarket reverted for {market_id_hex}")
                continue

            # Parse outcome from event
            events  = market_c.events.MarketResolved().process_receipt(receipt)
            outcome_map = {0: "UNRESOLVED", 1: "YES", 2: "NO", 3: "VOID"}
            outcome = outcome_map.get(events[0]["args"]["outcome"], "UNKNOWN") if events else "UNKNOWN"

            mark_market_resolved(market_id_hex, outcome)
            log.info(f"Market {market_id_hex} resolved: {outcome} | tx: {tx_hash}")

        except Exception as e:
            log.error(f"resolveMarket failed for {market_id_hex}: {e}")
