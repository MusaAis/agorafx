/**
 * Social sharing utilities for AgoraFX bets.
 */

export function shareOnX(market, side, amount) {
  const pair    = market.pair;
  const mult    = market.yesMult || market.noMult || "?";
  const question= market.question;
  const url     = "https://agorafx.vercel.app";

  const text = [
    `Just Predict ${side} ${amount ? `$${amount} USDC` : ""} on AgoraFX 🌍`,
    `"${question}"`,
    `${side === "YES" ? "🟢" : "🔴"} ${pair} prediction market on @Arc`,
    ``,
    `🔗 ${url}`,
    `#AgoraFX @BuildOnArc @thecanteenapp @Musa_Ais`,
  ].join("\n");

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(tweetUrl, "_blank", "width=550,height=450");
}

export function shareMarket(market) {
  const text = [
    `🌍 African FX Prediction Market is live on AgoraFX`,
    ``,
    `"${market.question}"`,
    ``,
    `predict YES or NO in USDC — settles on @Arc with $0.01 gas`,
    `try it: https://agorafx.vercel.app`,
    ``,
    `#AgoraFX #Africa @thecanteenapp @Musa_Ais`,
  ].join("\n");

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(tweetUrl, "_blank", "width=550,height=450");
}
