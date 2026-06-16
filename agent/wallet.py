"""
agent/wallet.py
───────────────
Circle Agent Wallet runtime for AgoraFX.

Entity secret is registered once via scripts/setup_wallet.js.
At runtime (balance checks, sending USDC), we use the Circle REST API
with the entitySecretCiphertext for signing transactions.

Public surface:
    get_wallet_address()          → str
    get_balance()                 → float   (USDC, human units)
    send_usdc(to, amount)         → str | None  (Circle transaction id)
    wallet_info()                 → dict | None
    get_transaction_status(tx_id) → dict | None
"""

import base64
import logging
import os
import uuid
from typing import Optional

import httpx

from .config import (
    CIRCLE_API_KEY,
    CIRCLE_ENTITY_SECRET,
    CIRCLE_AGENT_WALLET_ID,
    CIRCLE_AGENT_WALLET_ADDRESS,
    USDC_ADDRESS,
)

log = logging.getLogger("wallet")

BASE_URL   = "https://api.circle.com/v1/w3s"
BLOCKCHAIN = "ARC-TESTNET"
USDC_TOKEN = USDC_ADDRESS   # 0x3600000000000000000000000000000000000000


# ── Helpers ───────────────────────────────────────────────────────

def _headers() -> dict:
    if not CIRCLE_API_KEY:
        raise EnvironmentError("CIRCLE_API_KEY not set")
    return {
        "Authorization": f"Bearer {CIRCLE_API_KEY}",
        "Content-Type":  "application/json",
    }


async def _get_circle_public_key(client: httpx.AsyncClient) -> str:
    r = await client.get(
        f"{BASE_URL}/config/entity/publicKey",
        headers=_headers(),
    )
    r.raise_for_status()
    return r.json()["data"]["publicKey"]


def _encrypt_entity_secret(entity_secret_hex: str, public_key_pem: str) -> str:
    """RSA-OAEP encrypt entity secret with Circle's public key."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    pub_key = serialization.load_pem_public_key(public_key_pem.encode())
    ct = pub_key.encrypt(
        bytes.fromhex(entity_secret_hex),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ct).decode()


async def _entity_secret_ciphertext(client: httpx.AsyncClient) -> str:
    if not CIRCLE_ENTITY_SECRET:
        raise EnvironmentError(
            "CIRCLE_ENTITY_SECRET not set — run: node scripts/setup_wallet.js"
        )
    pk = await _get_circle_public_key(client)
    return _encrypt_entity_secret(CIRCLE_ENTITY_SECRET, pk)


# ── Public API ────────────────────────────────────────────────────

def get_wallet_address() -> str:
    if not CIRCLE_AGENT_WALLET_ADDRESS:
        raise EnvironmentError(
            "CIRCLE_AGENT_WALLET_ADDRESS not set — run: node scripts/setup_wallet.js"
        )
    return CIRCLE_AGENT_WALLET_ADDRESS


async def wallet_info() -> Optional[dict]:
    if not CIRCLE_AGENT_WALLET_ID:
        log.error("CIRCLE_AGENT_WALLET_ID not configured")
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE_URL}/wallets/{CIRCLE_AGENT_WALLET_ID}",
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json().get("data", {}).get("wallet")
    except Exception as e:
        log.error(f"wallet_info: {e}")
    return None


async def get_balance() -> float:
    """USDC balance in human units. Returns 0.0 on any error."""
    if not CIRCLE_AGENT_WALLET_ID:
        log.error("CIRCLE_AGENT_WALLET_ID not configured")
        return 0.0
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE_URL}/wallets/{CIRCLE_AGENT_WALLET_ID}/balances",
                headers=_headers(),
            )
            r.raise_for_status()
            for entry in r.json().get("data", {}).get("tokenBalances", []):
                token  = entry.get("token", {})
                addr   = (token.get("address") or "").lower()
                symbol = (token.get("symbol") or "").upper()
                if addr == USDC_TOKEN.lower() or symbol == "USDC":
                    bal = float(entry.get("amount", "0"))
                    log.debug(f"Agent USDC balance: ${bal:.6f}")
                    return bal
        log.warning("USDC not found in balances — wallet may be unfunded")
    except Exception as e:
        log.error(f"get_balance: {e}")
    return 0.0


async def send_usdc(to_address: str, amount: float) -> Optional[str]:
    """
    Transfer USDC from agent wallet. Returns Circle transaction ID or None.
    Uses developer-controlled wallet transaction endpoint with entity secret.
    """
    if not CIRCLE_AGENT_WALLET_ID:
        log.error("CIRCLE_AGENT_WALLET_ID not configured")
        return None
    if amount <= 0:
        log.error(f"send_usdc: invalid amount {amount}")
        return None

    try:
        async with httpx.AsyncClient(timeout=25) as client:
            esc = await _entity_secret_ciphertext(client)
            payload = {
                "idempotencyKey":          str(uuid.uuid4()),
                "walletId":                CIRCLE_AGENT_WALLET_ID,
                "blockchain":              BLOCKCHAIN,
                "tokenAddress":            USDC_TOKEN,
                "destinationAddress":      to_address,
                "amounts":                 [f"{amount:.6f}".rstrip("0").rstrip(".")],
                "fee":                     {"type": "level", "config": {"feeLevel": "MEDIUM"}},
                "entitySecretCiphertext":  esc,
            }
            r = await client.post(
                f"{BASE_URL}/developer/transactions/transfer",
                headers=_headers(),
                json=payload,
            )
            r.raise_for_status()
            tx_id = r.json().get("data", {}).get("id")
            log.info(f"send_usdc → {to_address[:10]}… ${amount:.6f} USDC | tx={tx_id}")
            return tx_id
    except httpx.HTTPStatusError as e:
        log.error(f"send_usdc HTTP {e.response.status_code}: {e.response.text}")
    except Exception as e:
        log.error(f"send_usdc: {e}")
    return None


async def get_transaction_status(tx_id: str) -> Optional[dict]:
    """Poll settlement status of a submitted transfer."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE_URL}/transactions/{tx_id}",
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json().get("data", {}).get("transaction")
    except Exception as e:
        log.error(f"get_transaction_status: {e}")
    return None
