"""
Market — interacts with PredictionMarket.sol on Arc Testnet.
Creates markets, resolves them, and auto-seeds liquidity on both sides.
"""
import json, logging, time
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from .config  import RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, USDC_ADDRESS
from .db      import insert_market, get_unresolved_markets, mark_market_resolved, get_recent_rates

log = logging.getLogger("market")

SEED_AMOUNT = 1_000_000   # 1 USDC per side (6 decimals) — seeds both YES and NO

def _load_abi():
    return [
        {"type":"function","name":"createMarket","inputs":[{"name":"pair","type":"string"},{"name":"question","type":"string"},{"name":"threshold","type":"uint256"},{"name":"isAbove","type":"bool"},{"name":"expiry","type":"uint256"}],"outputs":[{"name":"marketId","type":"bytes32"}],"stateMutability":"nonpayable"},
        {"type":"function","name":"resolveMarket","inputs":[{"name":"marketId","type":"bytes32"},{"name":"finalRate","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"function","name":"placeBet","inputs":[{"name":"marketId","type":"bytes32"},{"name":"isYes","type":"bool"},{"name":"amount","type":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
        {"type":"event","name":"MarketCreated","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"pair","type":"string","indexed":False},{"name":"question","type":"string","indexed":False},{"name":"threshold","type":"uint256","indexed":False},{"name":"isAbove","type":"bool","indexed":False},{"name":"expiry","type":"uint256","indexed":False}],"anonymous":False},
        {"type":"event","name":"BetPlaced","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"user","type":"address","indexed":True},{"name":"isYes","type":"bool","indexed":False},{"name":"amount","type":"uint256","indexed":False}],"anonymous":False},
        {"type":"event","name":"MarketResolved","inputs":[{"name":"marketId","type":"bytes32","indexed":True},{"name":"outcome","type":"uint8","indexed":False},{"name":"finalRate","type":"uint256","indexed":False}],"anonymous":False},
    ]

USDC_ABI = [
    {"type":"function","name":"approve","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable"},
    {"type":"function","name":"allowance","inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
    {"type":"function","name":"balanceOf","inputs":[{"name":"account","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
]

def get_w3():
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return w3

def get_contracts(w3):
    market = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=_load_abi())
    usdc   = w3.eth.contract(address=Web3.to_checksum_address(USDC_ADDRESS),     abi=USDC_ABI)
    return market, usdc

def _send_tx(w3, fn, account, extra_gas=0):
    tx = fn.build_transaction({
        "from":  account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas":   500_000 + extra_gas,
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    return receipt, tx_hash.hex()

def _ensure_usdc_approval(w3, usdc, account, amount):
    """Approve USDC spending if allowance is insufficient."""
    allowance = usdc.functions.allowance(account.address, CONTRACT_ADDRESS).call()
    if allowance < amount:
        log.info(f"Approving USDC: {amount/1e6:.2f} USDC")
        fn = usdc.functions.approve(Web3.to_checksum_address(CONTRACT_ADDRESS), amount * 10)
        _send_tx(w3, fn, account)

async def create_market_onchain(decision: dict) -> str | None:
    """Creates a market then seeds both YES and NO pools with 1 USDC each."""
    w3      = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, usdc_c = get_contracts(w3)

    pair      = decision["pair"]
    question  = decision["question"]
    threshold = int(decision["threshold"])
    is_above  = bool(decision.get("is_above", True))
    expiry    = int(time.time()) + int(decision.get("expiry_offset_sec", 3600))

    log.info(f"Creating market: {question}")

    try:
        fn      = market_c.functions.createMarket(pair, question, threshold, is_above, expiry)
        receipt, tx_hash = _send_tx(w3, fn, account)

        if receipt["status"] != 1:
            log.error("createMarket tx reverted"); return None

        events = market_c.events.MarketCreated().process_receipt(receipt)
        if not events:
            log.error("No MarketCreated event"); return None

        market_id_hex = "0x" + events[0]["args"]["marketId"].hex()
        log.info(f"Market created: {market_id_hex} | tx: {tx_hash}")

        insert_market(
            market_id_hex=market_id_hex, pair=pair, question=question,
            threshold=threshold, is_above=int(is_above),
            expiry_ts=expiry, tx_hash=tx_hash,
        )

        # ── Auto-seed both sides ─────────────────────────────────
        total_seed = SEED_AMOUNT * 2
        _ensure_usdc_approval(w3, usdc_c, account, total_seed)

        market_id_bytes = bytes.fromhex(market_id_hex.replace("0x",""))

        # Seed YES
        try:
            fn_yes = market_c.functions.placeBet(market_id_bytes, True, SEED_AMOUNT)
            _send_tx(w3, fn_yes, account)
            log.info(f"Seeded YES: {SEED_AMOUNT/1e6:.2f} USDC")
        except Exception as e:
            log.error(f"Seed YES failed: {e}")

        # Seed NO
        try:
            fn_no = market_c.functions.placeBet(market_id_bytes, False, SEED_AMOUNT)
            _send_tx(w3, fn_no, account)
            log.info(f"Seeded NO: {SEED_AMOUNT/1e6:.2f} USDC")
        except Exception as e:
            log.error(f"Seed NO failed: {e}")

        return market_id_hex

    except Exception as e:
        log.error(f"createMarket failed: {e}"); return None


async def resolve_expired_markets():
    """Resolve expired markets with the final observed rate."""
    expired = get_unresolved_markets()
    if not expired: return

    w3      = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, _ = get_contracts(w3)

    for m in expired:
        market_id_hex = m["market_id_hex"]
        pair          = m["pair"]
        recent        = get_recent_rates(pair, limit=1)
        if not recent:
            log.warning(f"No rate to resolve {market_id_hex}"); continue

        final_rate    = int(recent[0]["rate_scaled"])
        market_id_b   = bytes.fromhex(market_id_hex.replace("0x",""))

        log.info(f"Resolving {market_id_hex} at rate {final_rate}")
        try:
            fn = market_c.functions.resolveMarket(market_id_b, final_rate)
            receipt, tx_hash = _send_tx(w3, fn, account)
            if receipt["status"] != 1:
                log.error(f"resolveMarket reverted for {market_id_hex}"); continue

            events      = market_c.events.MarketResolved().process_receipt(receipt)
            outcome_map = {0:"UNRESOLVED",1:"YES",2:"NO",3:"VOID"}
            outcome     = outcome_map.get(events[0]["args"]["outcome"],"UNKNOWN") if events else "UNKNOWN"
            mark_market_resolved(market_id_hex, outcome)
            log.info(f"Resolved {market_id_hex}: {outcome} | tx: {tx_hash}")
        except Exception as e:
            log.error(f"resolveMarket failed: {e}")
