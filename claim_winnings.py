"""
Autonomous claimer — claims all won positions for the agent wallet.
Run: python3 claim_winnings.py
Skips already-claimed markets, saves progress to avoid re-claiming.
"""
import sqlite3, time, logging, sys
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from dotenv import load_dotenv
import os

load_dotenv("/home/ubuntu/agorafx/.env")

# ── Config ────────────────────────────────────────────────────────
RPC_FALLBACK   = "https://arc-testnet.rpc.thirdweb.com"
RPC_PRIMARY  = os.getenv("ARC_TESTNET_RPC_URL")
PRIVATE_KEY   = os.getenv("DEPLOYER_PRIVATE_KEY")
CONTRACT_ADDR = os.getenv("PREDICTION_MARKET_ADDRESS", "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5")
DB_PATH       = "/home/ubuntu/agorafx/agorafx.db"
DELAY_SEC     = 4   # between claims to avoid nonce issues

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("claimer")

MARKET_ABI = [
    {"type":"function","name":"claimWinnings","inputs":[{"name":"marketId","type":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},
    {"type":"function","name":"getPosition","inputs":[{"name":"marketId","type":"bytes32"},{"name":"user","type":"address"}],"outputs":[{"name":"","type":"tuple","components":[{"name":"yesAmount","type":"uint256"},{"name":"noAmount","type":"uint256"},{"name":"claimed","type":"bool"}]}],"stateMutability":"view"},
]

def get_w3():
    for rpc in [RPC_PRIMARY, RPC_FALLBACK]:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
            w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
            if w3.is_connected():
                log.info(f"Connected to {rpc}")
                return w3
        except Exception as e:
            log.warning(f"RPC {rpc} failed: {e}")
    raise Exception("All RPCs failed")

def send_tx(w3, fn, account):
    nonce = w3.eth.get_transaction_count(account.address, "latest")
    tx = fn.build_transaction({
        "from":  account.address,
        "nonce": nonce,
        "gas":   300_000,
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    return receipt, tx_hash.hex()

def get_claimable(db, agent_address):
    """Get all resolved markets where agent won and hasn't claimed yet."""
    rows = db.execute("""
        SELECT DISTINCT ub.market_id, m.outcome,
               SUM(CASE WHEN ub.is_yes=1 THEN ub.amount ELSE 0 END) as yes_amt,
               SUM(CASE WHEN ub.is_yes=0 THEN ub.amount ELSE 0 END) as no_amt
        FROM user_bets ub
        JOIN markets m ON m.market_id_hex = ub.market_id
        WHERE ub.wallet = ?
          AND m.resolved = 1
          AND m.outcome IN ('YES', 'NO')
        GROUP BY ub.market_id
    """, (agent_address.lower(),)).fetchall()
    return rows

def main():
    w3      = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDR),
        abi=MARKET_ABI
    )
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    log.info(f"Agent wallet: {account.address}")
    bal = w3.eth.get_balance(account.address)
    log.info(f"Native balance: {w3.from_wei(bal, 'ether')} (for gas)")

    rows = get_claimable(db, account.address)
    log.info(f"Found {len(rows)} resolved markets to check")

    claimed   = 0
    skipped   = 0
    failed    = 0
    total_out = 0

    for i, r in enumerate(rows):
        mid     = r[0]
        outcome = r[1]
        yes_amt = r[2] or 0
        no_amt  = r[3] or 0

        # Check if agent won this market
        won = (outcome == "YES" and yes_amt > 0) or (outcome == "NO" and no_amt > 0)
        if not won:
            skipped += 1
            continue

        mid_bytes = bytes.fromhex(mid.replace("0x", "")).ljust(32, b'\x00')

        try:
            # Check on-chain if already claimed
            pos = contract.functions.getPosition(mid_bytes, account.address).call()
            if pos[2]:  # claimed == True
                skipped += 1
                log.info(f"[{i+1}/{len(rows)}] Already claimed: {mid[:20]}...")
                continue

            # Claim
            log.info(f"[{i+1}/{len(rows)}] Claiming {mid[:20]}... outcome={outcome}")
            fn = contract.functions.claimWinnings(mid_bytes)
            receipt, tx_hash = send_tx(w3, fn, account)

            if receipt["status"] == 1:
                claimed += 1
                log.info(f"  ✅ Claimed | tx: {tx_hash[:20]}...")
            else:
                failed += 1
                log.error(f"  ❌ Reverted: {tx_hash[:20]}...")

        except Exception as e:
            failed += 1
            log.error(f"  ❌ Error: {e}")

        time.sleep(DELAY_SEC)

        # Progress report every 50
        if (i + 1) % 50 == 0:
            log.info(f"── Progress: {claimed} claimed, {skipped} skipped, {failed} failed ──")

    log.info(f"\n{'='*50}")
    log.info(f"DONE — Claimed: {claimed} | Skipped: {skipped} | Failed: {failed}")
    db.close()

if __name__ == "__main__":
    main()
