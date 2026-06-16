"""
AgoraFX — x402 payment gate with Circle Gateway batched settlement.

Flow:
  1. No payment header → return 402 with PAYMENT-REQUIRED
  2. Payment header present → call Gateway settle endpoint
  3. Settlement success → serve resource, return PAYMENT-RESPONSE
  4. Settlement failure → return 402

Gateway Testnet: https://gateway-api-testnet.circle.com
Settle endpoint: POST /v1/x402/settle
Arc Testnet GatewayWallet: 0x0077777d7EBA4688BDeF3E311b846F25870A19B9
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

import requests as _sync_requests
from fastapi import HTTPException, Request

log = logging.getLogger("x402")

ARC_CHAIN_ID      = 5042002
ARC_NETWORK       = "eip155:5042002"
GATEWAY_API       = "https://gateway-api-testnet.circle.com"
GATEWAY_WALLET    = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
USDC_ARC_TESTNET  = "0x3600000000000000000000000000000000000000"
MIN_TIMEOUT_SEC   = 608400


def _cfg() -> dict:
    recv    = os.getenv("X402_RECEIVER_ADDRESS", "")
    price_f = float(os.getenv("X402_SIGNAL_PRICE_USDC", "0.001"))
    units   = int(price_f * 1_000_000)
    backend = os.getenv("BACKEND_URL", "https://api.kudiarc.xyz").rstrip("/")
    return {
        "usdc":     USDC_ARC_TESTNET,
        "receiver": recv,
        "units":    units,
        "price_f":  price_f,
        "resource": backend + "/rates/signal",
    }


def _b64(d: dict) -> str:
    return base64.b64encode(json.dumps(d, separators=(",", ":")).encode()).decode()


def _requirements(cfg: dict) -> dict:
    return {
        "x402Version": 1,
        "accepts": [{
            "scheme":            "exact",
            "network":           ARC_NETWORK,
            "maxAmountRequired": str(cfg["units"]),
            "amount":            str(cfg["units"]),
            "resource":          cfg["resource"],
            "description":       "AgoraFX African FX rate signal",
            "mimeType":          "application/json",
            "payTo":             cfg["receiver"],
            "maxTimeoutSeconds": MIN_TIMEOUT_SEC,
            "asset":             cfg["usdc"],
            "extra": {
                "name":    "USD Coin",
                "version": "2",
            },
        }],
        "error": "Payment required",
    }


async def _settle(payment_payload: dict, cfg: dict) -> tuple[bool, str]:
    requirements = _requirements(cfg)["accepts"][0]

    wrapped_payload = {
        **payment_payload,
        "resource": {
            "url":         cfg["resource"],
            "description": "AgoraFX African FX rate signal",
            "mimeType":    "application/json",
        },
        "accepted": requirements,
    }

    body = {
        "paymentPayload":      wrapped_payload,
        "paymentRequirements": requirements,
    }

    # Use blocking requests via thread — httpx.AsyncClient cannot resolve
    # gateway-api-testnet.circle.com inside uvicorn's asyncio loop on Oracle Cloud.
    def _sync_settle() -> tuple[int, str]:
        r = _sync_requests.post(
            f"{GATEWAY_API}/v1/x402/settle",
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        return r.status_code, r.text

    try:
        status, text = await asyncio.to_thread(_sync_settle)
        log.info("Gateway settle %s: %s", status, text[:300])

        if status == 200:
            data  = json.loads(text)
            payer = (
                data.get("payer")
                or payment_payload.get("payload", {})
                           .get("authorization", {})
                           .get("from", "")
            )
            log.info("Gateway settled: payer=%s tx=%s", payer, data.get("transaction"))
            return True, payer
        else:
            log.warning("Gateway settle failed %s: %s", status, text[:300])
            return False, ""

    except Exception as e:
        log.error("x402 facilitator call failed: %s", e)
        return False, ""


async def require_x402(request: Request) -> str:
    cfg = _cfg()

    if not cfg["receiver"]:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: X402_RECEIVER_ADDRESS not set",
        )

    payment_hdr = (
        request.headers.get("x-payment")
        or request.headers.get("payment-signature")
        or request.headers.get("PAYMENT-SIGNATURE")
    )

    reqs    = _requirements(cfg)
    req_hdr = _b64(reqs)
    expose  = "PAYMENT-REQUIRED,PAYMENT-RESPONSE"

    if not payment_hdr:
        raise HTTPException(
            status_code=402,
            detail=reqs,
            headers={
                "PAYMENT-REQUIRED":              req_hdr,
                "Access-Control-Expose-Headers": expose,
            },
        )

    try:
        payment_payload = json.loads(
            base64.b64decode(payment_hdr + "==").decode()
        )
    except Exception as e:
        log.warning("x402: failed to parse payment header: %s", e)
        raise HTTPException(
            status_code=402,
            detail={"error": "Malformed payment header"},
            headers={"Access-Control-Expose-Headers": expose},
        )

    settled, payer = await _settle(payment_payload, cfg)

    if not settled:
        raise HTTPException(
            status_code=402,
            detail={"error": "Payment settlement failed"},
            headers={
                "PAYMENT-REQUIRED":              req_hdr,
                "Access-Control-Expose-Headers": expose,
            },
        )

    return payer


def build_x402_middleware():
    raise NotImplementedError("Use require_x402 Depends() instead")
