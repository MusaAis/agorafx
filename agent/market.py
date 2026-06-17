"""
Market — interacts with PredictionMarketV2.sol on Arc Testnet.
Creates markets with agent USDC stake (confidence-scaled).
Resolves markets. No more deployer seeding — agent stakes its own USDC.
"""
import json, logging, time
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from .config import RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, USDC_ADDRESS
from .db     import insert_market, get_unresolved_markets, mark_market_resolved, get_recent_rates

log = logging.getLogger("market")

# Stake constants — mirrors contract
BASE_STAKE_UNITS = 500_000   # $0.50 USDC
MAX_STAKE_UNITS  = 1_000_000 # $1.00 USDC


def _compute_stake(confidence: float) -> int:
    """
    confidence: float 0.0–1.0 (from Groq decision)
    Returns USDC units (6 decimals).
    Formula mirrors PredictionMarketV2.computeStake():
      stake = BASE + (confidence_0_to_1000 * BASE / 1000)
    Range: $0.50 → $1.00
    """
    confidence_scaled = int(min(max(confidence, 0.0), 1.0) * 1000)
    stake = BASE_STAKE_UNITS + (confidence_scaled * BASE_STAKE_UNITS // 1000)
    return min(stake, MAX_STAKE_UNITS)


def _load_abi():
    return [
        # createMarket — now includes confidence param
        {
            "type": "function", "name": "createMarket",
            "inputs": [
                {"name": "pair",       "type": "string"},
                {"name": "question",   "type": "string"},
                {"name": "threshold",  "type": "uint256"},
                {"name": "isAbove",    "type": "bool"},
                {"name": "expiry",     "type": "uint256"},
                {"name": "confidence", "type": "uint256"},
            ],
            "outputs": [{"name": "marketId", "type": "bytes32"}],
            "stateMutability": "nonpayable",
        },
        {
            "type": "function", "name": "resolveMarket",
            "inputs": [
                {"name": "marketId",  "type": "bytes32"},
                {"name": "finalRate", "type": "uint256"},
            ],
            "outputs": [], "stateMutability": "nonpayable",
        },
        {
            "type": "function", "name": "placeBet",
            "inputs": [
                {"name": "marketId", "type": "bytes32"},
                {"name": "isYes",    "type": "bool"},
                {"name": "amount",   "type": "uint256"},
            ],
            "outputs": [], "stateMutability": "nonpayable",
        },
        {
            "type": "function", "name": "getAgentStats",
            "inputs": [{"name": "_agent", "type": "address"}],
            "outputs": [{
                "name": "", "type": "tuple",
                "components": [
                    {"name": "totalPredictions",    "type": "uint256"},
                    {"name": "correctPredictions",  "type": "uint256"},
                    {"name": "totalStakedUsdc",     "type": "uint256"},
                    {"name": "totalSlashedUsdc",    "type": "uint256"},
                    {"name": "totalReturnedUsdc",   "type": "uint256"},
                ],
            }],
            "stateMutability": "view",
        },
        {
            "type": "function", "name": "getMarket",
            "inputs": [{"name": "marketId", "type": "bytes32"}],
            "outputs": [{
                "name": "", "type": "tuple",
                "components": [
                    {"name": "id",            "type": "bytes32"},
                    {"name": "pair",          "type": "string"},
                    {"name": "question",      "type": "string"},
                    {"name": "threshold",     "type": "uint256"},
                    {"name": "isAbove",       "type": "bool"},
                    {"name": "expiry",        "type": "uint256"},
                    {"name": "yesPool",       "type": "uint256"},
                    {"name": "noPool",        "type": "uint256"},
                    {"name": "outcome",       "type": "uint8"},
                    {"name": "resolved",      "type": "bool"},
                    {"name": "createdAt",     "type": "uint256"},
                    {"name": "agentAddress",  "type": "address"},
                    {"name": "agentStake",    "type": "uint256"},
                    {"name": "confidence",    "type": "uint256"},
                    {"name": "stakeReturned", "type": "bool"},
                ],
            }],
            "stateMutability": "view",
        },
        {
            "type": "event", "name": "MarketCreated",
            "inputs": [
                {"name": "marketId",   "type": "bytes32",  "indexed": True},
                {"name": "pair",       "type": "string",   "indexed": False},
                {"name": "question",   "type": "string",   "indexed": False},
                {"name": "threshold",  "type": "uint256",  "indexed": False},
                {"name": "isAbove",    "type": "bool",     "indexed": False},
                {"name": "expiry",     "type": "uint256",  "indexed": False},
                {"name": "agentStake", "type": "uint256",  "indexed": False},
                {"name": "confidence", "type": "uint256",  "indexed": False},
            ],
            "anonymous": False,
        },
        {
            "type": "event", "name": "MarketResolved",
            "inputs": [
                {"name": "marketId",      "type": "bytes32", "indexed": True},
                {"name": "outcome",       "type": "uint8",   "indexed": False},
                {"name": "finalRate",     "type": "uint256", "indexed": False},
                {"name": "agentSlashed",  "type": "uint256", "indexed": False},
                {"name": "agentReturned", "type": "uint256", "indexed": False},
            ],
            "anonymous": False,
        },
        {
            "type": "event", "name": "AgentStakeSlashed",
            "inputs": [
                {"name": "marketId",   "type": "bytes32", "indexed": True},
                {"name": "agent",      "type": "address", "indexed": True},
                {"name": "toWinners",  "type": "uint256", "indexed": False},
                {"name": "toTreasury", "type": "uint256", "indexed": False},
            ],
            "anonymous": False,
        },
    ]


USDC_ABI = [
    {"type":"function","name":"approve","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable"},
    {"type":"function","name":"allowance","inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
    {"type":"function","name":"balanceOf","inputs":[{"name":"account","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
    {"type":"function","name":"transfer","inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable"},
]


def get_w3():
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return w3


def get_contracts(w3):
    market = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=_load_abi()
    )
    usdc = w3.eth.contract(
        address=Web3.to_checksum_address(USDC_ADDRESS), abi=USDC_ABI
    )
    return market, usdc


def _send_tx(w3, fn, account, extra_gas=0):
    tx = fn.build_transaction({
        "from":  account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas":   600_000 + extra_gas,
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    return receipt, tx_hash.hex()


def _ensure_usdc_approval(w3, usdc, account, amount):
    allowance = usdc.functions.allowance(
        account.address,
        Web3.to_checksum_address(CONTRACT_ADDRESS)
    ).call()
    if allowance < amount:
        log.info(f"Approving USDC for stake: {amount/1e6:.4f} USDC")
        fn = usdc.functions.approve(
            Web3.to_checksum_address(CONTRACT_ADDRESS),
            MAX_STAKE_UNITS * 100   # approve plenty upfront
        )
        _send_tx(w3, fn, account)


async def create_market_onchain(decision: dict) -> str | None:
    """
    Creates a market with an agent USDC stake scaled by confidence.
    No deployer seeding — the stake IS the agent's skin in the game.

    decision keys:
      pair, question, threshold, is_above, expiry_offset_sec, confidence (0.0–1.0)
    """
    w3      = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, usdc_c = get_contracts(w3)

    pair       = decision["pair"]
    question   = decision["question"]
    threshold  = int(decision["threshold"])
    is_above   = bool(decision.get("is_above", True))
    expiry     = int(time.time()) + int(decision.get("expiry_offset_sec", 3600))
    confidence = float(decision.get("confidence", 0.5))

    # Scale confidence for contract (0–1000)
    confidence_scaled = int(min(max(confidence, 0.0), 1.0) * 1000)
    stake_units       = _compute_stake(confidence)

    log.info(
        f"Creating market: {question} | "
        f"confidence={confidence:.2f} → stake=${stake_units/1e6:.4f} USDC"
    )

    # Check agent wallet balance
    balance = usdc_c.functions.balanceOf(account.address).call()
    if balance < stake_units:
        log.error(
            f"Insufficient agent wallet balance: "
            f"have ${balance/1e6:.4f}, need ${stake_units/1e6:.4f}"
        )
        return None

    try:
        # Approve contract to pull stake
        _ensure_usdc_approval(w3, usdc_c, account, stake_units)

        fn = market_c.functions.createMarket(
            pair, question, threshold, is_above, expiry, confidence_scaled
        )
        receipt, tx_hash = _send_tx(w3, fn, account)

        if receipt["status"] != 1:
            log.error("createMarket tx reverted")
            return None

        events = market_c.events.MarketCreated().process_receipt(receipt)
        if not events:
            log.error("No MarketCreated event in receipt")
            return None

        market_id_hex = "0x" + events[0]["args"]["marketId"].hex()
        actual_stake  = events[0]["args"]["agentStake"]

        log.info(
            f"Market created: {market_id_hex} | "
            f"stake=${actual_stake/1e6:.4f} USDC | tx: {tx_hash}"
        )

        insert_market(
            market_id_hex=market_id_hex,
            pair=pair,
            question=question,
            threshold=threshold,
            is_above=int(is_above),
            expiry_ts=expiry,
            tx_hash=tx_hash,
        )

        return market_id_hex

    except Exception as e:
        log.error(f"create_market_onchain failed: {e}")
        return None


async def resolve_expired_markets():
    """Resolve expired markets with the final observed rate."""
    expired = get_unresolved_markets()
    if not expired:
        return

    w3      = get_w3()
    account = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, _ = get_contracts(w3)

    outcome_map = {0: "UNRESOLVED", 1: "YES", 2: "NO", 3: "VOID"}

    for m in expired:
        market_id_hex = m["market_id_hex"]
        pair          = m["pair"]

        if not market_id_hex:
            log.warning("Skipping market with None market_id_hex")
            continue

        recent = get_recent_rates(pair, limit=1)
        if not recent:
            log.warning(f"No rate to resolve {market_id_hex}")
            continue

        final_rate   = int(recent[0]["rate_scaled"])
        market_id_b  = bytes.fromhex(market_id_hex.replace("0x", ""))

        # Check on-chain state first — sync if already resolved
        try:
            onchain = market_c.functions.getMarket(market_id_b).call()
            if onchain[9]:  # resolved field
                onchain_outcome = outcome_map.get(onchain[8], "UNKNOWN")
                mark_market_resolved(market_id_hex, onchain_outcome)
                log.info(f"Synced already-resolved {market_id_hex}: {onchain_outcome}")
                continue
        except Exception as e:
            log.warning(f"getMarket check failed for {market_id_hex}: {e}")

        log.info(f"Resolving {market_id_hex} at rate {final_rate}")
        try:
            fn = market_c.functions.resolveMarket(market_id_b, final_rate)
            receipt, tx_hash = _send_tx(w3, fn, account)

            if receipt["status"] != 1:
                log.error(f"resolveMarket reverted for {market_id_hex}")
                continue

            events  = market_c.events.MarketResolved().process_receipt(receipt)
            outcome = outcome_map.get(
                events[0]["args"]["outcome"], "UNKNOWN"
            ) if events else "UNKNOWN"

            slashed  = events[0]["args"]["agentSlashed"]  if events else 0
            returned = events[0]["args"]["agentReturned"] if events else 0

            mark_market_resolved(market_id_hex, outcome)
            log.info(
                f"Resolved {market_id_hex}: {outcome} | "
                f"stake slashed=${slashed/1e6:.4f} returned=${returned/1e6:.4f} | "
                f"tx: {tx_hash}"
            )

        except Exception as e:
            log.error(f"resolveMarket failed for {market_id_hex}: {e}")


async def get_agent_reputation(agent_address: str | None = None) -> dict:
    """Fetch on-chain agent reputation stats."""
    w3         = get_w3()
    account    = w3.eth.account.from_key(PRIVATE_KEY)
    market_c, _ = get_contracts(w3)

    address = Web3.to_checksum_address(agent_address or account.address)
    try:
        stats = market_c.functions.getAgentStats(address).call()
        total = stats[0]
        return {
            "agent":               address,
            "total_predictions":   total,
            "correct_predictions": stats[1],
            "accuracy_pct":        round(stats[1] * 100 / total, 1) if total else 0,
            "total_staked_usdc":   stats[2] / 1e6,
            "total_slashed_usdc":  stats[3] / 1e6,
            "total_returned_usdc": stats[4] / 1e6,
        }
    except Exception as e:
        log.error(f"getAgentStats failed: {e}")
        return {}