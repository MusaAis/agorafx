"""Claims the agent wallet's winning positions on both contract versions.

Run from the repository root: python3 claim_winnings.py
Already-claimed positions are detected on-chain and skipped.
"""
import logging
import os
import sqlite3
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

RPC_PRIMARY  = os.getenv("ARC_TESTNET_RPC_URL")
RPC_FALLBACK = "https://arc-testnet.rpc.thirdweb.com"
PRIVATE_KEY  = os.getenv("DEPLOYER_PRIVATE_KEY")
DB_PATH      = os.getenv("DB_PATH", str(ROOT / "agorafx.db"))
DELAY_SEC    = 4

CONTRACTS = {
    "v1": os.getenv("PREDICTION_MARKET_ADDRESS", "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5"),
    "v2": os.getenv("PREDICTION_MARKET_V2_ADDRESS", "0x833C71c1c261857538CEB8877aaFc80A47E66130"),
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("claimer")

MARKET_ABI = [
    {"type": "function", "name": "claimWinnings", "inputs": [{"name": "marketId", "type": "bytes32"}],
     "outputs": [], "stateMutability": "nonpayable"},
    {"type": "function", "name": "getPosition",
     "inputs": [{"name": "marketId", "type": "bytes32"}, {"name": "user", "type": "address"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "yesAmount", "type": "uint256"},
         {"name": "noAmount", "type": "uint256"},
         {"name": "claimed", "type": "bool"}]}],
     "stateMutability": "view"},
]


def get_w3():
    for rpc in (RPC_PRIMARY, RPC_FALLBACK):
        if not rpc:
            continue
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
            w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
            if w3.is_connected():
                log.info("Connected to %s", rpc)
                return w3
        except Exception as e:
            log.warning("RPC %s failed: %s", rpc, e)
    raise RuntimeError("All RPCs failed")


def send_tx(w3, fn, account):
    nonce = w3.eth.get_transaction_count(account.address, "latest")
    tx = fn.build_transaction({"from": account.address, "nonce": nonce, "gas": 300_000})
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    return receipt, tx_hash.hex()


def get_claimable(db, agent_address, version):
    """Resolved markets of one contract version where the agent wallet placed bets."""
    return db.execute(
        """
        SELECT ub.market_id, m.outcome,
               SUM(CASE WHEN ub.is_yes=1 THEN ub.amount ELSE 0 END) AS yes_amt,
               SUM(CASE WHEN ub.is_yes=0 THEN ub.amount ELSE 0 END) AS no_amt
        FROM user_bets ub
        JOIN markets m ON m.market_id_hex = ub.market_id
        WHERE ub.wallet = ?
          AND m.resolved = 1
          AND m.outcome IN ('YES', 'NO')
          AND COALESCE(m.contract_version, 'v1') = ?
        GROUP BY ub.market_id
        """,
        (agent_address.lower(), version),
    ).fetchall()


def claim_version(w3, account, db, version, address):
    contract = w3.eth.contract(address=Web3.to_checksum_address(address), abi=MARKET_ABI)
    rows = get_claimable(db, account.address, version)
    log.info("[%s] %d resolved markets to check", version, len(rows))

    claimed = skipped = failed = 0
    for i, (mid, outcome, yes_amt, no_amt) in enumerate(rows):
        won = (outcome == "YES" and (yes_amt or 0) > 0) or (outcome == "NO" and (no_amt or 0) > 0)
        if not won:
            skipped += 1
            continue

        mid_bytes = bytes.fromhex(mid.replace("0x", "")).ljust(32, b"\x00")
        try:
            position = contract.functions.getPosition(mid_bytes, account.address).call()
            if position[2]:
                skipped += 1
                continue

            log.info("[%s %d/%d] Claiming %s outcome=%s", version, i + 1, len(rows), mid[:20], outcome)
            receipt, tx_hash = send_tx(w3, contract.functions.claimWinnings(mid_bytes), account)
            if receipt["status"] == 1:
                claimed += 1
                log.info("  claimed, tx %s", tx_hash[:20])
            else:
                failed += 1
                log.error("  reverted, tx %s", tx_hash[:20])
        except Exception as e:
            failed += 1
            log.error("  error: %s", e)

        time.sleep(DELAY_SEC)

    return claimed, skipped, failed


def main():
    if not PRIVATE_KEY:
        sys.exit("DEPLOYER_PRIVATE_KEY is not set")

    w3 = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    db = sqlite3.connect(DB_PATH)

    log.info("Agent wallet: %s", account.address)
    log.info("Native balance: %s", w3.from_wei(w3.eth.get_balance(account.address), "ether"))

    totals = [0, 0, 0]
    for version, address in CONTRACTS.items():
        for k, n in enumerate(claim_version(w3, account, db, version, address)):
            totals[k] += n

    log.info("Done. Claimed: %d | Skipped: %d | Failed: %d", *totals)
    db.close()


if __name__ == "__main__":
    main()
