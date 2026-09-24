// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PredictionMarket
 * @notice AgoraFX — African FX Prediction Markets on Arc
 * @dev AI agent creates and resolves markets. Users bet in USDC.
 */
contract PredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public agent;

    uint256 public marketCount;
    uint256 public protocolFee = 100;           // 1% in basis points
    uint256 public accumulatedFees;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MIN_BET = 1e6;      // 1 USDC (6 decimals)
    uint256 public constant MIN_EXPIRY_BUFFER = 5 minutes;

    // ─── Types ───────────────────────────────────────────────────────────────

    enum Outcome { UNRESOLVED, YES, NO, VOID }

    struct Market {
        bytes32 id;
        string  pair;        // e.g. "USDC/EURC", "USDC/NGN"
        string  question;    // e.g. "Will EURC/USDC exceed 1.08 by expiry?"
        uint256 threshold;   // rate threshold scaled by 1e6
        bool    isAbove;     // YES wins if final rate >= threshold
        uint256 expiry;      // unix timestamp
        uint256 yesPool;     // total USDC on YES side
        uint256 noPool;      // total USDC on NO side
        Outcome outcome;
        bool    resolved;
        uint256 createdAt;
    }

    struct Position {
        uint256 yesAmount;
        uint256 noAmount;
        bool    claimed;
    }

    mapping(bytes32 => Market)                        public markets;
    mapping(bytes32 => mapping(address => Position))  public positions;
    bytes32[]                                         public marketIds;

    // ─── Events ──────────────────────────────────────────────────────────────

    event MarketCreated(
        bytes32 indexed marketId,
        string  pair,
        string  question,
        uint256 threshold,
        bool    isAbove,
        uint256 expiry
    );
    event BetPlaced(
        bytes32 indexed marketId,
        address indexed user,
        bool    isYes,
        uint256 amount
    );
    event MarketResolved(
        bytes32 indexed marketId,
        Outcome outcome,
        uint256 finalRate
    );
    event Claimed(
        bytes32 indexed marketId,
        address indexed user,
        uint256 amount
    );
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyAgent() {
        require(msg.sender == agent || msg.sender == owner(), "Not authorized");
        _;
    }

    modifier exists(bytes32 marketId) {
        require(markets[marketId].createdAt != 0, "Market not found");
        _;
    }

    modifier open(bytes32 marketId) {
        require(!markets[marketId].resolved, "Market already resolved");
        require(block.timestamp < markets[marketId].expiry, "Market expired");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _agent) Ownable(msg.sender) {
        require(_usdc  != address(0), "Invalid USDC address");
        require(_agent != address(0), "Invalid agent address");
        usdc  = IERC20(_usdc);
        agent = _agent;
    }

    // ─── Agent: Create Market ─────────────────────────────────────────────────

    /**
     * @notice AI agent calls this to open a new prediction market.
     * @param pair      Currency pair label e.g. "USDC/EURC"
     * @param question  Human-readable market question
     * @param threshold Rate threshold scaled by 1e6
     * @param isAbove   true  → YES wins if finalRate >= threshold
     *                  false → YES wins if finalRate <  threshold
     * @param expiry    Unix timestamp when the market closes
     */
    function createMarket(
        string  calldata pair,
        string  calldata question,
        uint256 threshold,
        bool    isAbove,
        uint256 expiry
    ) external onlyAgent returns (bytes32 marketId) {
        require(expiry > block.timestamp + MIN_EXPIRY_BUFFER, "Expiry too soon");
        require(threshold > 0, "Invalid threshold");

        marketId = keccak256(
            abi.encodePacked(pair, threshold, isAbove, expiry, block.timestamp)
        );
        require(markets[marketId].createdAt == 0, "Market already exists");

        markets[marketId] = Market({
            id:        marketId,
            pair:      pair,
            question:  question,
            threshold: threshold,
            isAbove:   isAbove,
            expiry:    expiry,
            yesPool:   0,
            noPool:    0,
            outcome:   Outcome.UNRESOLVED,
            resolved:  false,
            createdAt: block.timestamp
        });

        marketIds.push(marketId);
        marketCount++;

        emit MarketCreated(marketId, pair, question, threshold, isAbove, expiry);
    }

    // ─── Agent: Resolve Market ────────────────────────────────────────────────

    /**
     * @notice AI agent calls this after expiry with the final observed rate.
     * @param marketId  The market to resolve
     * @param finalRate Actual rate at expiry, scaled by 1e6
     */
    function resolveMarket(
        bytes32 marketId,
        uint256 finalRate
    ) external onlyAgent exists(marketId) {
        Market storage m = markets[marketId];
        require(!m.resolved, "Already resolved");
        require(block.timestamp >= m.expiry, "Not expired yet");

        Outcome outcome;

        if (m.yesPool == 0 || m.noPool == 0) {
            // One side empty — void market, full refunds
            outcome = Outcome.VOID;
        } else if (m.isAbove) {
            outcome = finalRate >= m.threshold ? Outcome.YES : Outcome.NO;
        } else {
            outcome = finalRate < m.threshold ? Outcome.YES : Outcome.NO;
        }

        m.outcome  = outcome;
        m.resolved = true;

        emit MarketResolved(marketId, outcome, finalRate);
    }

    // ─── User: Place Bet ──────────────────────────────────────────────────────

    /**
     * @notice Place a bet on YES or NO for an open market.
     * @param marketId  Target market
     * @param isYes     true = bet YES, false = bet NO
     * @param amount    USDC amount (min 1 USDC = 1e6)
     */
    function placeBet(
        bytes32 marketId,
        bool    isYes,
        uint256 amount
    ) external nonReentrant exists(marketId) open(marketId) {
        require(amount >= MIN_BET, "Below minimum bet of 1 USDC");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        Position storage pos = positions[marketId][msg.sender];
        Market    storage m   = markets[marketId];

        if (isYes) {
            pos.yesAmount += amount;
            m.yesPool     += amount;
        } else {
            pos.noAmount  += amount;
            m.noPool      += amount;
        }

        emit BetPlaced(marketId, msg.sender, isYes, amount);
    }

    // ─── User: Claim Winnings ─────────────────────────────────────────────────

    /**
     * @notice Claim winnings after a market is resolved.
     *         VOID markets return full stake. Winning side shares the
     *         losing pool proportionally minus the 1% protocol fee.
     */
    function claimWinnings(bytes32 marketId)
        external
        nonReentrant
        exists(marketId)
    {
        Market   storage m   = markets[marketId];
        Position storage pos = positions[marketId][msg.sender];

        require(m.resolved,     "Market not resolved yet");
        require(!pos.claimed,   "Already claimed");

        pos.claimed = true;

        uint256 payout = 0;
        uint256 totalPool = m.yesPool + m.noPool;

        if (m.outcome == Outcome.VOID) {
            // Full refund — no fee on voids
            payout = pos.yesAmount + pos.noAmount;

        } else if (m.outcome == Outcome.YES && pos.yesAmount > 0) {
            uint256 gross = (pos.yesAmount * totalPool) / m.yesPool;
            uint256 fee   = (gross * protocolFee) / FEE_DENOMINATOR;
            accumulatedFees += fee;
            payout = gross - fee;

        } else if (m.outcome == Outcome.NO && pos.noAmount > 0) {
            uint256 gross = (pos.noAmount * totalPool) / m.noPool;
            uint256 fee   = (gross * protocolFee) / FEE_DENOMINATOR;
            accumulatedFees += fee;
            payout = gross - fee;
        }

        require(payout > 0, "Nothing to claim");
        usdc.safeTransfer(msg.sender, payout);

        emit Claimed(marketId, msg.sender, payout);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getMarket(bytes32 marketId)
        external view returns (Market memory)
    {
        return markets[marketId];
    }

    function getPosition(bytes32 marketId, address user)
        external view returns (Position memory)
    {
        return positions[marketId][user];
    }

    /// @notice Returns IDs of all currently open (unresolved, unexpired) markets
    function getActiveMarkets() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < marketIds.length; i++) {
            Market storage m = markets[marketIds[i]];
            if (!m.resolved && block.timestamp < m.expiry) count++;
        }

        bytes32[] memory active = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < marketIds.length; i++) {
            Market storage m = markets[marketIds[i]];
            if (!m.resolved && block.timestamp < m.expiry) {
                active[j++] = marketIds[i];
            }
        }
        return active;
    }

    /// @notice Returns all market IDs ever created
    function getAllMarkets() external view returns (bytes32[] memory) {
        return marketIds;
    }

    // ─── Admin Functions ──────────────────────────────────────────────────────

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "Invalid address");
        emit AgentUpdated(agent, _agent);
        agent = _agent;
    }

    function setProtocolFee(uint256 _fee) external onlyOwner {
        require(_fee <= 500, "Max fee is 5%");
        protocolFee = _fee;
    }

    /// @notice Withdraw only accumulated protocol fees, never user funds
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "No fees to withdraw");
        accumulatedFees = 0;
        usdc.safeTransfer(owner(), amount);
    }
}
