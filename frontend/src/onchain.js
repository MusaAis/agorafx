/**
 * On-chain data helpers — dual contract support (V1 + V2).
 * V1: 0x5Ddf...  V2: 0x833C...
 * Each market carries contract_version ("v1" | "v2") from the backend.
 * All on-chain calls route to the correct contract automatically.
 */
import { ethers } from "ethers";

export const PUBLIC_RPC          = "https://rpc.testnet.arc.network";
export const CONTRACT_ADDRESS_V1 = "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5";
export const CONTRACT_ADDRESS_V2 = "0x833C71c1c261857538CEB8877aaFc80A47E66130";
export const CONTRACT_ADDRESS    = CONTRACT_ADDRESS_V1; // backwards compat
export const USDC_ADDRESS        = "0x3600000000000000000000000000000000000000";

// ── ABIs ─────────────────────────────────────────────────────────────────────

// V1 getMarket returns 11-field tuple
const POSITION_ABI_V1 = [
  "function getPosition(bytes32 marketId, address user) view returns (tuple(uint256 yesAmount, uint256 noAmount, bool claimed))",
  "function getMarket(bytes32 marketId) view returns (tuple(bytes32 id, string pair, string question, uint256 threshold, bool isAbove, uint256 expiry, uint256 yesPool, uint256 noPool, uint8 outcome, bool resolved, uint256 createdAt))",
];

// V2 getMarket returns 16-field tuple (extra: agentAddress, agentStake, agentCollateral, confidence, stakeSettled)
const POSITION_ABI_V2 = [
  "function getPosition(bytes32 marketId, address user) view returns (tuple(uint256 yesAmount, uint256 noAmount, bool claimed))",
  "function getMarket(bytes32 marketId) view returns (tuple(bytes32 id, string pair, string question, uint256 threshold, bool isAbove, uint256 expiry, uint256 yesPool, uint256 noPool, uint8 outcome, bool resolved, uint256 createdAt, address agentAddress, uint256 agentStake, uint256 agentCollateral, uint256 confidence, bool stakeSettled))",
];

const USDC_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
];

const STATS_ABI = [
  "function accumulatedFees() view returns (uint256)",
  "function marketCount() view returns (uint256)",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getProvider() {
  return new ethers.JsonRpcProvider(PUBLIC_RPC);
}

/** Returns the correct contract address for a market object. */
export function contractAddressFor(market) {
  return market?.contract_version === "v2" ? CONTRACT_ADDRESS_V2 : CONTRACT_ADDRESS_V1;
}

/** Returns the correct ABI for a market object. */
function abiFor(market) {
  return market?.contract_version === "v2" ? POSITION_ABI_V2 : POSITION_ABI_V1;
}

/** Returns an ethers Contract instance for the right version. */
function contractFor(market, provider) {
  return new ethers.Contract(contractAddressFor(market), abiFor(market), provider);
}

// ── Position loaders ─────────────────────────────────────────────────────────

/**
 * Load user positions — routes each market to the correct contract.
 */
export async function loadUserPositions(userAddress, markets) {
  const provider = getProvider();
  const BATCH = 10;
  const results = [];

  for (let i = 0; i < markets.length; i += BATCH) {
    const batch = markets.slice(i, i + BATCH);
    const calls = batch.map(async (m) => {
      try {
        const c   = contractFor(m, provider);
        const mid = ethers.zeroPadValue(m.market_id_hex, 32);

        const pos = await c.getPosition(mid, userAddress);
        const yes = Number(pos.yesAmount);
        const no  = Number(pos.noAmount);
        if (yes === 0 && no === 0) return null;

        const side    = yes > 0 ? "YES" : "NO";
        const amt     = yes > 0 ? yes : no;
        const claimed = pos.claimed;

        const onChain = await c.getMarket(mid);
        const yPool   = Number(onChain.yesPool);
        const nPool   = Number(onChain.noPool);
        const total   = yPool + nPool;
        const sPool   = side === "YES" ? yPool : nPool;
        const payout  = sPool > 0 ? (amt / sPool) * total * 0.99 / 1e6 : amt / 1e6;

        return { market: m, side, amt, potentialPayout: payout, claimed, yPool, nPool };
      } catch {
        return null;
      }
    });

    const batchResults = await Promise.all(calls);
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

/**
 * Fast positions loader — backend tells us which markets the user bet on,
 * frontend fetches pool + claimed status on-chain only for those markets.
 */
export async function loadPositionsFromAPI(userAddress, apiBase) {
  const raw = await fetch(`${apiBase}/positions/${userAddress}`).then(r => r.json());
  if (!raw.length) return [];

  const provider = getProvider();
  const BATCH = 15;
  const results = [];

  for (let i = 0; i < raw.length; i += BATCH) {
    const batch = raw.slice(i, i + BATCH);
    const calls = batch.map(async (item) => {
      try {
        const market = item.market;
        const c      = contractFor(market, provider);
        const mid32  = ethers.zeroPadValue(item.market_id, 32);

        const pos     = await c.getPosition(mid32, userAddress);
        const claimed = pos.claimed;

        const onChain = await c.getMarket(mid32);
        const yPool   = Number(onChain.yesPool);
        const nPool   = Number(onChain.noPool);
        const total   = yPool + nPool;

        const side  = item.yes_amt > 0 ? "YES" : "NO";
        const amt   = item.yes_amt > 0 ? item.yes_amt : item.no_amt;
        const sPool = side === "YES" ? yPool : nPool;
        const payout = sPool > 0 ? (amt / sPool) * total * 0.99 / 1e6 : amt / 1e6;

        return { market, side, amt, potentialPayout: payout, claimed, yPool, nPool };
      } catch {
        return null;
      }
    });

    const batchResults = await Promise.all(calls);
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

/**
 * Load ALL user positions across every market — both V1 and V2.
 */
export async function loadAllUserPositions(userAddress, apiBase) {
  const provider = getProvider();

  // Get all market IDs with their metadata (includes contract_version)
  const allMarkets = await fetch(`${apiBase}/markets?limit=5000`).then(r => r.json());

  const BATCH = 20;
  const withPositions = [];

  for (let i = 0; i < allMarkets.length; i += BATCH) {
    const batch = allMarkets.slice(i, i + BATCH);
    const calls = batch.map(async (m) => {
      try {
        const c   = contractFor(m, provider);
        const mid = m.market_id_hex;
        const pos = await c.getPosition(ethers.zeroPadValue(mid, 32), userAddress);
        const yes = Number(pos.yesAmount);
        const no  = Number(pos.noAmount);
        if (yes === 0 && no === 0) return null;
        return { market: m, yes, no, claimed: pos.claimed };
      } catch {
        return null;
      }
    });
    const results = await Promise.all(calls);
    withPositions.push(...results.filter(Boolean));
  }

  if (withPositions.length === 0) return [];

  const results = [];
  for (const { market: m, yes, no, claimed } of withPositions) {
    try {
      const c       = contractFor(m, provider);
      const onChain = await c.getMarket(ethers.zeroPadValue(m.market_id_hex, 32));
      const yPool   = Number(onChain.yesPool);
      const nPool   = Number(onChain.noPool);
      const total   = yPool + nPool;
      const side    = yes > 0 ? "YES" : "NO";
      const amt     = yes > 0 ? yes : no;
      const sPool   = side === "YES" ? yPool : nPool;
      const payout  = sPool > 0 ? (amt / sPool) * total * 0.99 / 1e6 : amt / 1e6;
      results.push({ market: m, side, amt, potentialPayout: payout, claimed, yPool, nPool });
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * Admin stats — sums accumulated fees and market count from both contracts.
 */
export async function loadAdminStats() {
  const provider = getProvider();
  const usdc     = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const cv1      = new ethers.Contract(CONTRACT_ADDRESS_V1, STATS_ABI, provider);
  const cv2      = new ethers.Contract(CONTRACT_ADDRESS_V2, STATS_ABI, provider);

  const [
    v1Bal, v2Bal,
    v1Fees, v2Fees,
    v1Count, v2Count,
  ] = await Promise.all([
    usdc.balanceOf(CONTRACT_ADDRESS_V1),
    usdc.balanceOf(CONTRACT_ADDRESS_V2),
    cv1.accumulatedFees(),
    cv2.accumulatedFees(),
    cv1.marketCount(),
    cv2.marketCount(),
  ]);

  return {
    contractBalance: ((Number(v1Bal) + Number(v2Bal)) / 1e6).toFixed(2),
    accumulatedFees: ((Number(v1Fees) + Number(v2Fees)) / 1e6).toFixed(2),
    marketCount:     Number(v1Count) + Number(v2Count),
  };
}

/**
 * Pool data for a single market — uses the correct contract.
 */
export async function loadMarketPool(marketIdHex, contractVersion = "v1") {
  try {
    const provider = getProvider();
    const addr     = contractVersion === "v2" ? CONTRACT_ADDRESS_V2 : CONTRACT_ADDRESS_V1;
    const abi      = contractVersion === "v2" ? POSITION_ABI_V2 : POSITION_ABI_V1;
    const c        = new ethers.Contract(addr, abi, provider);
    const m        = await c.getMarket(ethers.zeroPadValue(marketIdHex, 32));
    return { yes: Number(m.yesPool), no: Number(m.noPool) };
  } catch {
    return { yes: 0, no: 0 };
  }
}