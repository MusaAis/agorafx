// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PredictionMarketV2
 * @notice AgoraFX v2 — African FX Prediction Markets on Arc
 *
 * Agent flow per market:
 *   1. Agent stakes USDC (confidence-scaled $0.50–$1.00) as prediction signal
 *   2. Contract auto-seeds $0.10 YES + $0.10 NO from the stake to prevent VOID
 *   3. Remaining stake held as slash-able collateral until resolution
 *   4. Correct prediction  → full remaining stake returned to agent
 *   5. Wrong prediction    → 50% to winning bettors pool, 50% to treasury
 *   6. VOID market         → impossible if seed succeeded (both pools > 0)
 *
 * Agent reputation tracked on-chain: accuracy, total staked, slashed, returned.
 */
contract PredictionMarketV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public agent;
    address public treasury;

    uint256 public marketCount;
    uint256 public protocolFee            = 100;        // 1% basis points
    uint256 public accumulatedFees;
    uint256 public constant FEE_DENOMINATOR   = 10_000;
    uint256 public constant MIN_BET           = 100_000; // $0.10 USDC
    uint256 public constant MIN_EXPIRY_BUFFER = 5 minutes;

    // Staking (6 decimals)
    uint256 public constant BASE_STAKE       = 500_000;  // $0.50 USDC
    uint256 public constant MAX_STAKE        = 1_000_000; // $1.00 USDC
    uint256 public constant SEED_PER_SIDE    = 100_000;  // $0.10 per YES + NO
    uint256 public constant SLASH_TO_TREASURY = 50;      // 50% of slash → treasury
    uint256 public constant SLASH_DENOMINATOR = 100;

    // ─── Agent Reputation ────────────────────────────────────────────────────

    struct AgentStats {
        uint256 totalPredictions;
        uint256 correctPredictions;
        uint256 totalStakedUsdc;
        uint256 totalSlashedUsdc;
        uint256 totalReturnedUsdc;
    }

    mapping(address => AgentStats) public agentStats;

    // ─── Types ───────────────────────────────────────────────────────────────

    enum Outcome { UNRESOLVED, YES, NO, VOID }

    struct Market {
        bytes32 id;
        string  pair;
        string  question;
        uint256 threshold;
        bool    isAbove;
        uint256 expiry;
        uint256 yesPool;
        uint256 noPool;
        Outcome outcome;
        bool    resolved;
        uint256 createdAt;
        // v2
        address agentAddress;
        uint256 agentStake;      // total pulled from agent at creation
        uint256 agentCollateral; // stake minus seed ($0.20) — this is slash-able
        uint256 confidence;      // 0–1000
        bool    stakeSettled;
    }

    struct Position {
        uint256 yesAmount;
        uint256 noAmount;
        bool    claimed;
    }

    mapping(bytes32 => Market)                       public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    bytes32[]                                        public marketIds;

    // ─── Events ──────────────────────────────────────────────────────────────

    event MarketCreated(
        bytes32 indexed marketId,
        string  pair,
        string  question,
        uint256 threshold,
        bool    isAbove,
        uint256 expiry,
        uint256 agentStake,
        uint256 confidence
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
        uint256 finalRate,
        uint256 agentSlashed,
        uint256 agentReturned
    );
    event AgentStakeSlashed(
        bytes32 indexed marketId,
        address indexed agentAddr,
        uint256 toWinners,
        uint256 toTreasury
    );
    event AgentStakeReturned(
        bytes32 indexed marketId,
        address indexed agentAddr,
        uint256 amount
    );
    event Claimed(
        bytes32 indexed marketId,
        address indexed user,
        uint256 amount
    );
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event TreasuryUpdated(address indexed old, address indexed next);

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
        require(!markets[marketId].resolved, "Already resolved");
        require(block.timestamp < markets[marketId].expiry, "Expired");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _agent,
        address _treasury
    ) Ownable(msg.sender) {
        require(_usdc     != address(0), "Invalid USDC");
        require(_agent    != address(0), "Invalid agent");
        require(_treasury != address(0), "Invalid treasury");
        usdc     = IERC20(_usdc);
        agent    = _agent;
        treasury = _treasury;
    }

    // ─── Agent: Create Market ─────────────────────────────────────────────────

    /**
     * @notice Creates a market, stakes USDC (confidence-scaled), and
     *         auto-seeds $0.10 YES + $0.10 NO from the stake to prevent VOID.
     *
     * Total pulled from agent = stake (e.g. $0.75)
     *   $0.10 → yesPool seed
     *   $0.10 → noPool seed
     *   $0.55 → held as slash-able collateral
     *
     * @param confidence  0–1000  (e.g. 720 = 72.0% confidence)
     */
    function createMarket(
        string  calldata pair,
        string  calldata question,
        uint256 threshold,
        bool    isAbove,
        uint256 expiry,
        uint256 confidence
    ) external onlyAgent returns (bytes32 marketId) {
        require(expiry > block.timestamp + MIN_EXPIRY_BUFFER, "Expiry too soon");
        require(threshold > 0, "Invalid threshold");
        require(confidence <= 1000, "Confidence max 1000");

        // Stake = BASE + (confidence/1000 * BASE), capped at MAX
        uint256 stake = BASE_STAKE + (confidence * BASE_STAKE / 1000);
        if (stake > MAX_STAKE) stake = MAX_STAKE;

        // Must be large enough to cover both seeds
        uint256 totalSeed   = SEED_PER_SIDE * 2; // $0.20
        require(stake >= totalSeed + MIN_BET, "Stake too small to seed");
        uint256 collateral  = stake - totalSeed;

        // Pull full stake from agent in one transfer
        usdc.safeTransferFrom(msg.sender, address(this), stake);

        marketId = keccak256(
            abi.encodePacked(pair, threshold, isAbove, expiry, block.timestamp)
        );
        require(markets[marketId].createdAt == 0, "Market exists");

        markets[marketId] = Market({
            id:             marketId,
            pair:           pair,
            question:       question,
            threshold:      threshold,
            isAbove:        isAbove,
            expiry:         expiry,
            yesPool:        SEED_PER_SIDE,  // $0.10 seeded immediately
            noPool:         SEED_PER_SIDE,  // $0.10 seeded immediately
            outcome:        Outcome.UNRESOLVED,
            resolved:       false,
            createdAt:      block.timestamp,
            agentAddress:   msg.sender,
            agentStake:     stake,
            agentCollateral: collateral,
            confidence:     confidence,
            stakeSettled:   false
        });

        // Agent's seed positions — needed so agent can claim if it wins
        positions[marketId][msg.sender].yesAmount += SEED_PER_SIDE;
        positions[marketId][msg.sender].noAmount  += SEED_PER_SIDE;

        marketIds.push(marketId);
        marketCount++;

        agentStats[msg.sender].totalPredictions++;
        agentStats[msg.sender].totalStakedUsdc += stake;

        emit MarketCreated(
            marketId, pair, question, threshold,
            isAbove, expiry, stake, confidence
        );
    }

    // ─── Agent: Resolve Market ────────────────────────────────────────────────

    /**
     * @notice Resolves market and settles agent collateral.
     *
     * Correct prediction OR VOID → collateral returned to agent.
     * Wrong prediction:
     *   toWinners  = 50% of collateral → added to winning pool
     *   toTreasury = 50% of collateral → sent to treasury address
     *
     * Note: seed positions ($0.10 YES + $0.10 NO) are claimable by agent
     * via claimWinnings() like any bettor — they are NOT part of slash logic.
     */
    function resolveMarket(
        bytes32 marketId,
        uint256 finalRate
    ) external onlyAgent exists(marketId) {
        Market storage m = markets[marketId];
        require(!m.resolved,                 "Already resolved");
        require(block.timestamp >= m.expiry, "Not expired yet");
        require(!m.stakeSettled,             "Stake already settled");

        Outcome outcome;
        bool agentCorrect;

        // VOID impossible now (both pools seeded), but kept as safety
        if (m.yesPool == 0 || m.noPool == 0) {
            outcome      = Outcome.VOID;
            agentCorrect = true;
        } else if (m.isAbove) {
            outcome      = finalRate >= m.threshold ? Outcome.YES : Outcome.NO;
            agentCorrect = (outcome == Outcome.YES);
        } else {
            outcome      = finalRate < m.threshold ? Outcome.YES : Outcome.NO;
            agentCorrect = (outcome == Outcome.YES);
        }

        m.outcome      = outcome;
        m.resolved     = true;
        m.stakeSettled = true;

        uint256 slashed  = 0;
        uint256 returned = 0;
        uint256 col      = m.agentCollateral;

        if (agentCorrect || outcome == Outcome.VOID) {
            returned = col;
            usdc.safeTransfer(m.agentAddress, returned);
            agentStats[m.agentAddress].correctPredictions++;
            agentStats[m.agentAddress].totalReturnedUsdc += returned;
            emit AgentStakeReturned(marketId, m.agentAddress, returned);
        } else {
            slashed = col;
            uint256 toTreasury = (slashed * SLASH_TO_TREASURY) / SLASH_DENOMINATOR;
            uint256 toWinners  = slashed - toTreasury;

            if (outcome == Outcome.YES) {
                m.yesPool += toWinners;
            } else {
                m.noPool  += toWinners;
            }

            usdc.safeTransfer(treasury, toTreasury);
            agentStats[m.agentAddress].totalSlashedUsdc += slashed;
            emit AgentStakeSlashed(marketId, m.agentAddress, toWinners, toTreasury);
        }

        emit MarketResolved(marketId, outcome, finalRate, slashed, returned);
    }

    // ─── User: Place Bet ──────────────────────────────────────────────────────

    function placeBet(
        bytes32 marketId,
        bool    isYes,
        uint256 amount
    ) external nonReentrant exists(marketId) open(marketId) {
        require(amount >= MIN_BET, "Min bet is $0.10 USDC");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        Position storage pos = positions[marketId][msg.sender];
        Market   storage m   = markets[marketId];

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

    function claimWinnings(bytes32 marketId)
        external nonReentrant exists(marketId)
    {
        Market   storage m   = markets[marketId];
        Position storage pos = positions[marketId][msg.sender];

        require(m.resolved,   "Not resolved");
        require(!pos.claimed, "Already claimed");

        pos.claimed = true;

        uint256 payout    = 0;
        uint256 totalPool = m.yesPool + m.noPool;

        if (m.outcome == Outcome.VOID) {
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

    // ─── View ─────────────────────────────────────────────────────────────────

    function getMarket(bytes32 marketId)
        external view returns (Market memory)
    { return markets[marketId]; }

    function getPosition(bytes32 marketId, address user)
        external view returns (Position memory)
    { return positions[marketId][user]; }

    function getAgentStats(address _agent)
        external view returns (AgentStats memory)
    { return agentStats[_agent]; }

    function computeStake(uint256 confidence)
        external pure returns (uint256 stake, uint256 collateral)
    {
        stake = BASE_STAKE + (confidence * BASE_STAKE / 1000);
        if (stake > MAX_STAKE) stake = MAX_STAKE;
        collateral = stake - (SEED_PER_SIDE * 2);
    }

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
            if (!m.resolved && block.timestamp < m.expiry) active[j++] = marketIds[i];
        }
        return active;
    }

    function getAllMarkets() external view returns (bytes32[] memory) {
        return marketIds;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "Invalid");
        emit AgentUpdated(agent, _agent);
        agent = _agent;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setProtocolFee(uint256 _fee) external onlyOwner {
        require(_fee <= 500, "Max 5%");
        protocolFee = _fee;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "No fees");
        accumulatedFees = 0;
        usdc.safeTransfer(owner(), amount);
    }
}