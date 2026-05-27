/**
 * On-chain data helpers — parallel calls to avoid slow sequential reads.
 */
import { ethers } from "ethers";

export const PUBLIC_RPC       = "https://rpc.testnet.arc.network";
export const CONTRACT_ADDRESS = "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5";
export const USDC_ADDRESS     = "0x3600000000000000000000000000000000000000";

const POSITION_ABI = [
  "function getPosition(bytes32 marketId, address user) view returns (tuple(uint256 yesAmount, uint256 noAmount, bool claimed))",
  "function getMarket(bytes32 marketId) view returns (tuple(bytes32 id, string pair, string question, uint256 threshold, bool isAbove, uint256 expiry, uint256 yesPool, uint256 noPool, uint8 outcome, bool resolved, uint256 createdAt))",
];

const USDC_ABI = ["function balanceOf(address account) external view returns (uint256)"];
const STATS_ABI = [
  "function accumulatedFees() view returns (uint256)",
  "function marketCount() view returns (uint256)",
];

export function getProvider() {
  return new ethers.JsonRpcProvider(PUBLIC_RPC);
}

/**
 * Load all user positions in parallel batches of 10.
 * Much faster than sequential calls.
 */
export async function loadUserPositions(userAddress, markets) {
  const provider = getProvider();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, POSITION_ABI, provider);

  const BATCH = 10;
  const results = [];

  for (let i = 0; i < markets.length; i += BATCH) {
    const batch = markets.slice(i, i + BATCH);
    const calls = batch.map(async (m) => {
      try {
        const pos = await contract.getPosition(
          ethers.zeroPadValue(m.market_id_hex, 32),
          userAddress
        );
        const yes = Number(pos.yesAmount);
        const no  = Number(pos.noAmount);
        if (yes === 0 && no === 0) return null;

        const side    = yes > 0 ? "YES" : "NO";
        const amt     = yes > 0 ? yes : no;
        const claimed = pos.claimed;

        // Get on-chain pool data
        const onChain = await contract.getMarket(
          ethers.zeroPadValue(m.market_id_hex, 32)
        );
        const yPool  = Number(onChain.yesPool);
        const nPool  = Number(onChain.noPool);
        const total  = yPool + nPool;
        const sPool  = side === "YES" ? yPool : nPool;
        const payout = sPool > 0 ? (amt / sPool) * total * 0.99 / 1e6 : amt / 1e6;

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
 * Load admin on-chain stats — simple balance reads, no event queries.
 * Event queries (queryFilter) often fail on Arc testnet with large block ranges.
 */
export async function loadAdminStats() {
  const provider = getProvider();
  const usdc     = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, STATS_ABI, provider);

  const [contractBal, fees, marketCount] = await Promise.all([
    usdc.balanceOf(CONTRACT_ADDRESS),
    contract.accumulatedFees(),
    contract.marketCount(),
  ]);

  return {
    contractBalance: (Number(contractBal) / 1e6).toFixed(2),
    accumulatedFees: (Number(fees) / 1e6).toFixed(2),
    marketCount:     Number(marketCount),
  };
}

/**
 * Load pool data for a single market.
 */
export async function loadMarketPool(marketIdHex) {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, POSITION_ABI, provider);
    const m = await contract.getMarket(ethers.zeroPadValue(marketIdHex, 32));
    return { yes: Number(m.yesPool), no: Number(m.noPool) };
  } catch {
    return { yes: 0, no: 0 };
  }
}