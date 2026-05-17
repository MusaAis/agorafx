"""
AgoraFX Agent — main orchestrator.
Three async loops running concurrently:
  1. Rate monitor    → every 30s
  2. Decision engine → every 5min (+ scheduled market fallback)
  3. Market resolver → every 60s
"""
import asyncio
import logging
import sys

from .config   import DECISION_INTERVAL_SEC, RESOLVER_INTERVAL_SEC
from .db       import init_db
from .monitor  import run_monitor
from .decision import run_decision_cycle, build_scheduled_market
from .market   import create_market_onchain, resolve_expired_markets

# ── Logging ────────────────────────────────────────────────────────
logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("main")


async def decision_loop():
    """
    Every 5 minutes:
      1. Ask Groq/Llama if rate momentum warrants a new market
      2. If not → check fallback (create scheduled market if none active)
      3. If either returns a decision → create the market onchain
    """
    log.info(f"Decision engine started (interval: {DECISION_INTERVAL_SEC}s)")
    await asyncio.sleep(90)   # wait for monitor to collect initial data

    while True:
        try:
            # Primary: momentum-based decision
            decision = await run_decision_cycle()

            # Fallback: scheduled market if no momentum + no active markets
            if not decision:
                decision = await build_scheduled_market()

            if decision:
                log.info(f"Opening market: {decision['question']}")
                market_id = await create_market_onchain(decision)
                if market_id:
                    log.info(f"✅ Market live: {market_id}")
                else:
                    log.error("❌ Market creation failed")

        except Exception as e:
            log.error(f"Decision loop error: {e}", exc_info=True)

        await asyncio.sleep(DECISION_INTERVAL_SEC)


async def resolver_loop():
    """Every 60s: resolve any expired markets onchain."""
    log.info(f"Resolver started (interval: {RESOLVER_INTERVAL_SEC}s)")
    while True:
        try:
            await resolve_expired_markets()
        except Exception as e:
            log.error(f"Resolver loop error: {e}", exc_info=True)
        await asyncio.sleep(RESOLVER_INTERVAL_SEC)


async def main():
    log.info("🚀 AgoraFX Agent starting...")
    init_db()

    await asyncio.gather(
        run_monitor(),
        decision_loop(),
        resolver_loop(),
    )


if __name__ == "__main__":
    asyncio.run(main())
