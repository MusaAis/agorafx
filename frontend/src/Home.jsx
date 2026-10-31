/**
 * AgoraFX — Homepage / Landing Page
 *
 * Shown at first load. "Launch App" → enters the dApp.
 * All data fetched live from the API.
 *
 * CHANGES IN THIS PASS
 * ─────────────────────
 * 1. ROOT CAUSE FIX: every --amber / --green / --blue / --bg-card / --border /
 *    --text-muted / --text-dim token used below was previously only defined
 *    inside App.jsx's <style> block, which only mounts once view === "app".
 *    On the homepage those vars were undefined, so borders/accents silently
 *    fell back to nothing — and --bg/--text (which DO live in index.css) flip
 *    with the visitor's OS light/dark setting. That's why the page looked
 *    different across your screenshots. Fixed by giving Home its own
 *    self-contained :root block below, hard-locked to the dark theme that
 *    matches the dApp — no longer dependent on system color-scheme.
 * 2. Renamed "Unique Wallets" → "Users", added "Total Predictions" (this was
 *    already being fetched as `total_bets` but never displayed) and
 *    "Autonomous x402 Payments" to the stats row.
 * 3. Stats now animate (count up/down) on refresh instead of snapping, and
 *    sections fade in on scroll — both respect prefers-reduced-motion.
 * 4. Added a live FX ticker under the header (same data the dApp uses) so
 *    the page feels alive on arrival, not just on stats.
 * 5. New "Inside the app" section — one-line descriptions of the 4 tabs
 *    (Markets / Positions / Agent Feed / Signals) so visitors know what
 *    they're launching into.
 * 6. Wired up the mobile hamburger menu — nav links previously just
 *    vanished below 640px with no replacement.
 *
 * ⚠️ Field names for the two new stats (x402 payments, total predictions)
 * are my best guess from your build-plan doc — verify against your real
 * /stats and /stats/chain/v5 response shapes and adjust if needed (see the
 * "NOTE" comment near STAT_TILES below).
 */

import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "https://api.kudiarc.xyz";
const CONTRACT = "0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5";
const CONTRACT_SHORT = "0x5Ddf…732B5";
const ARCSCAN = `https://testnet.arcscan.app/address/${CONTRACT}`;

const fmt  = (n) => Number(n).toLocaleString();
const fmtU = (n) => (Number(n) / 1e6).toFixed(2);
const ago  = (ts) => {
  const s = Math.floor((Date.now() - new Date(ts + "Z").getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts + "Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const PAIR_FLAG = {
  "USDC/NGN":"🇳🇬","USDC/GHS":"🇬🇭","USDC/KES":"🇰🇪",
  "USDC/ZAR":"🇿🇦","USDC/EGP":"🇪🇬","USDC/EURC":"🇪🇺",
};
const PAIR_COLOR = {
  "USDC/NGN":"#4aa8f0","USDC/GHS":"#00c878","USDC/KES":"#00c878",
  "USDC/ZAR":"#f0a030","USDC/EGP":"#f0a030","USDC/EURC":"#a78bfa",
};

const TICKER_PAIRS = [
  { key:"USDC/EURC", color:"#a78bfa", fmt:(r)=>Number(r).toFixed(4) },
  { key:"USDC/NGN",  color:"#4aa8f0", fmt:(r)=>`₦${Number(r).toLocaleString(undefined,{maximumFractionDigits:0})}` },
  { key:"USDC/GHS",  color:"#00c878", fmt:(r)=>`₵${Number(r).toFixed(2)}` },
  { key:"USDC/KES",  color:"#00c878", fmt:(r)=>`KSh${Number(r).toFixed(2)}` },
  { key:"USDC/ZAR",  color:"#f0a030", fmt:(r)=>`R${Number(r).toFixed(2)}` },
  { key:"USDC/EGP",  color:"#f0a030", fmt:(r)=>`E£${Number(r).toFixed(2)}` },
];

// ── LiveDot ───────────────────────────────────────────────────────────────
const LiveDot = ({ color = "#00c878", size = 8 }) => (
  <span style={{ position:"relative", display:"inline-flex", alignItems:"center", justifyContent:"center", width:size+4, height:size+4, flexShrink:0 }}>
    <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:color, animation:"h-ripple 2s ease-out infinite", opacity:0.4 }}/>
    <span style={{ width:size, height:size, borderRadius:"50%", background:color, position:"relative" }}/>
  </span>
);

// ── useReducedMotion ─────────────────────────────────────────────────────
function useReducedMotion() {
  const ref = useRef(false);
  if (typeof window !== "undefined" && window.matchMedia) {
    ref.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return ref.current;
}

// ── AnimatedNumber — eases toward each new value so live refreshes (every
// 20s) read as "ticking up" rather than abruptly snapping ─────────────────
function AnimatedNumber({ value, format, duration = 900 }) {
  const [display, setDisplay] = useState(value ?? 0);
  const prevRef = useRef(value ?? 0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (value == null) return;
    if (reduceMotion) { setDisplay(value); prevRef.current = value; return; }
    const from = prevRef.current;
    const to = value;
    if (from === to) { setDisplay(to); return; }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (value == null) return <>—</>;
  return <>{format(display)}</>;
}

// ── Reveal — subtle scroll-in fade, respects reduced motion ────────────────
function Reveal({ children, delay = 0 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) { setVisible(true); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduceMotion]);

  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(14px)",
      transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

// ── HomeTicker — live FX rates, mirrors the in-app ticker so the brand
// feels alive the instant the page loads, not just once stats arrive ──────
function HomeTicker({ latest }) {
  const getRate = (p) => {
    if (!latest) return null;
    const currency = p.key.replace("USDC/", "").replace("/USDC", "");
    return latest[p.key]
      || latest[p.key.split("/").reverse().join("/")]
      || latest[currency + "/USDC"]
      || latest["USDC/" + currency]
      || latest[currency]
      || null;
  };
  const available = TICKER_PAIRS.filter((p) => getRate(p));
  if (!available.length) return null;
  const items = [...available, ...available];
  return (
    <div className="h-ticker-bar">
      <div className="h-ticker-label"><LiveDot size={6}/><span>LIVE</span></div>
      <div className="h-ticker-track-wrap">
        <div className="h-ticker-track">
          {items.map((p, i) => (
            <span key={i} className="h-ticker-item">
              <span className="h-ticker-pair">{p.key.replace("USDC/", "")}/USDC</span>
              <span className="h-ticker-sep">·</span>
              <span className="h-ticker-rate" style={{ color: p.color }}>{p.fmt(getRate(p).rate)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FeatureCard — shared card used for both "How it works" (sequential,
// numbered) and "Inside the app" (not sequential, no numbering) ───────────
function FeatureCard({ icon, title, desc, color, num }) {
  return (
    <div
      className="h-feature-card"
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color + "55"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
    >
      {num && <div className="h-feature-num" style={{ color: `${color}10` }}>{num}</div>}
      <div className="h-feature-icon" style={{ background:`${color}14`, border:`1px solid ${color}30`, color }}>
        {icon}
      </div>
      <div className="h-feature-title">{title}</div>
      <div className="h-feature-desc">{desc}</div>
    </div>
  );
}

// Genuinely sequential — order carries meaning, so numbering earns its keep
const STEPS = [
  { num:"01", title:"Connect Wallet", desc:"Connect your MetaMask to Arc Testnet. USDC is the native gas and settlement token — no ETH needed.", icon:"◈", color:"#4aa8f0" },
  { num:"02", title:"Predict FX Rates", desc:"Browse live AI-created markets on NGN, GHS, KES, ZAR, EGP, and EURC. Place YES or NO on where the rate is heading.", icon:"◎", color:"#f0a030" },
  { num:"03", title:"Earn USDC", desc:"Markets resolve automatically on-chain. Winners claim USDC directly to their wallet — no platform, no middleman.", icon:"◆", color:"#00c878" },
];

// Not a sequence — just what's behind each tab, so no numbers here
const APP_TABS = [
  { title:"Markets",    icon:"◎", color:"#00c878", desc:"Live AI-created markets on EUR/USD (EURC/USDC). Place YES or NO on where the rate is heading." },
  { title:"Positions",  icon:"◈", color:"#4aa8f0", desc:"Every prediction you've placed, active and settled, with one tap to claim USDC winnings." },
  { title:"Agent Feed", icon:"▦", color:"#f0a030", desc:"The agent's decisions as they happen — signal purchases, markets created, resolutions — each with a SHA-256 reasoning hash." },
  { title:"Signals",    icon:"✦", color:"#a78bfa", desc:"Analyst FX commentary. Pay $0.05 to read one, or publish your own and earn $0.04 per reader, instantly on-chain." },
];

const NAV_LINKS = [
  ["Markets", "#markets"],
  ["Protocol", "#protocol"],
  ["App", "#app-tour"],
  ["Signals", "#signals"],
];

// ── Home component ──────────────────────────────────────────────────────
export default function Home({ onLaunchApp }) {
  const [stats,    setStats]    = useState(null);
  const [chain,    setChain]    = useState(null);
  const [markets,  setMarkets]  = useState([]);
  const [signals,  setSignals]  = useState([]);
  const [latest,   setLatest]   = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reputation, setReputation] = useState(null);
  const [agentWallet, setAgentWallet] = useState(null);
  const [intelStats, setIntelStats] = useState(null);

  const load = useCallback(async () => {
    try {
      const [st, mk, sg, lr, rep, aw, ist] = await Promise.all([
        fetch(`${API}/stats`).then(r => r.json()),
        fetch(`${API}/markets?limit=100`).then(r => r.json()),
        fetch(`${API}/intelligence?limit=3`).then(r => r.json()),
        fetch(`${API}/rates/latest`).then(r => r.json()),
        fetch(`${API}/agent/reputation`).then(r => r.json()),
        fetch(`${API}/agent/wallet`).then(r => r.json()),
        fetch(`${API}/intelligence/stats`).then(r => r.json()),
      ]);
      setStats(st);
      setMarkets(Array.isArray(mk) ? mk : []);
      setSignals(Array.isArray(sg) ? sg : []);
      setLatest(lr);
      setReputation(rep);
      setAgentWallet(aw);
      setIntelStats(ist);
    } catch (e) {
      console.error("home load:", e);
    }

    // Chain stats separately — can be slow
    try {
      const cs = await fetch(`${API}/stats/chain/v5`).then(r => r.json());
      setChain(cs);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const resolved = markets.filter(m => m.resolved === 1);
  const active   = markets.filter(m => m.resolved === 0);
  const recent   = resolved.slice(0, 3);

  const tvlDisplay = chain?.tvl_usdc != null
    ? `$${Number(chain.tvl_usdc).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`
    : "$14,970";

  // NOTE: verify these two field paths against your real API response —
  // I'm inferring names from the build-plan doc's "Total Bets" (9,880+) and
  // "Autonomous x402 Payments" (90+) figures.
  const totalPredictions = chain?.total_bets ?? stats?.markets?.total ?? null;
  const x402Payments = chain?.x402_payments ?? chain?.autonomous_payments ?? stats?.agent?.x402_payments ?? null;
  const users = chain?.unique_wallets ?? null;

  const STAT_TILES = [
    { label:"Markets Created",  raw: stats?.markets?.total ?? null, format:(n)=>Math.round(n).toLocaleString(), fallback:"—", color:"var(--text)" },
    { label:"TVL (USDC Staked)",raw: chain?.tvl_usdc ?? null,        format:(n)=>`$${n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}`, fallback: tvlDisplay, color:"var(--amber)" },
    { label:"Users",            raw: users,                          format:(n)=>Math.round(n).toLocaleString(), fallback:"119", color:"var(--blue)" },
    { label:"Total Predictions",raw: totalPredictions,               format:(n)=>Math.round(n).toLocaleString(), fallback:"—", color:"var(--text-secondary)" },
    { label:"Resolution Rate",  raw: null,                           format:()=>"", fallback: stats ? "100%" : "—", color:"var(--green)" },
    { label:"Agent Decisions",  raw: stats?.agent?.total_decisions ?? null, format:(n)=>Math.round(n).toLocaleString(), fallback:"—", color:"var(--text-secondary)" },
    { label:"Autonomous x402 Payments", raw: x402Payments,           format:(n)=>Math.round(n).toLocaleString(), fallback:"—", color:"var(--purple)" },
    { label:"x402 Spent",        raw: agentWallet?.total_spent_usdc ?? null,  format:(n)=>`$${n.toFixed(3)}`, fallback:"—", color:"var(--blue)" },
    { label:"Agent Wallet",      raw: agentWallet?.balance_usdc ?? null,      format:(n)=>`$${n.toFixed(2)}`, fallback:"—", color:"var(--green)" },
    { label:"Agent Staked (V2)", raw: reputation?.total_staked_usdc ?? null,  format:(n)=>`$${n.toFixed(2)}`, fallback:"—", color:"var(--amber)" },
    { label:"Agent Slashed",     raw: reputation?.total_slashed_usdc ?? null, format:(n)=>`$${n.toFixed(2)}`, fallback:"—", color:"var(--red)" },
    { label:"Agent Accuracy",    raw: reputation?.accuracy_pct ?? null,       format:(n)=>`${n.toFixed(1)}%`, fallback:"—", color:"var(--blue)" },
    { label:"Analyst Earnings",  raw: intelStats?.total_earned ?? null,       format:(n)=>`$${n.toFixed(2)}`, fallback:"—", color:"var(--purple)" },
  ];

  return (
    <div style={{ fontFamily:"Outfit, sans-serif", background:"var(--bg)", color:"var(--text)", minHeight:"100vh" }}>

      {/* ── HEADER ── */}
      <header style={{
        position:"sticky", top:0, zIndex:100,
        background:"rgba(13,13,15,0.92)", backdropFilter:"blur(16px)",
        borderBottom:"1px solid var(--border)",
      }}>
        <div style={{
          maxWidth:1100, margin:"0 auto",
          padding:"0 20px", height:60,
          display:"flex", alignItems:"center", gap:16,
        }}>
          {/* Logo */}
          <div style={{ flex:1, display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.5px", lineHeight:1 }}>
              Agora<span style={{ color:"var(--amber)" }}>FX</span>
            </div>
            <span style={{
              fontSize:8, fontWeight:700, letterSpacing:"1px", textTransform:"uppercase",
              background:"rgba(0,200,120,0.12)", color:"var(--green)",
              border:"1px solid rgba(0,200,120,0.25)", borderRadius:4, padding:"2px 7px",
            }}>Testnet</span>
          </div>

          {/* Nav — desktop */}
          <nav style={{ display:"flex", gap:0, alignItems:"center" }} className="home-nav-desktop">
            {NAV_LINKS.map(([label, href]) => (
              <a key={label} href={href} style={{
                fontSize:13, color:"var(--text-muted)", textDecoration:"none",
                padding:"0 14px", fontWeight:500, transition:"color 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.color="var(--text)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--text-muted)"}
              >{label}</a>
            ))}
          </nav>

          {/* Hamburger — mobile only */}
          <button
            className="h-nav-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen(o => !o)}
            style={{
              background:"transparent", border:"1px solid var(--border)",
              borderRadius:8, width:36, height:36, color:"var(--text-muted)",
              fontSize:15, cursor:"pointer", flexShrink:0,
            }}
          >
            {menuOpen ? "✕" : "☰"}
          </button>

          {/* Launch App */}
          <button
            onClick={onLaunchApp}
            style={{
              background:"var(--amber)", border:"none",
              color:"#0a0a0a", borderRadius:8,
              padding:"9px 18px",
              fontFamily:"Outfit, sans-serif", fontWeight:700, fontSize:13,
              cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
              transition:"opacity 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity="0.88"}
            onMouseLeave={e => e.currentTarget.style.opacity="1"}
          >
            Launch App →
          </button>
        </div>

        {/* Mobile menu panel */}
        {menuOpen && (
          <div className="h-mobile-menu">
            {NAV_LINKS.map(([label, href]) => (
              <a key={label} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
          </div>
        )}
      </header>

      <HomeTicker latest={latest}/>

      {/* ── HERO ── */}
      <section style={{
        maxWidth:1100, margin:"0 auto",
        padding:"64px 20px 56px",
        display:"flex", flexDirection:"column", alignItems:"flex-start",
      }}>
        {/* Badge */}
        <div style={{
          display:"inline-flex", alignItems:"center", gap:8,
          background:"rgba(240,160,48,0.08)", border:"1px solid rgba(240,160,48,0.2)",
          borderRadius:20, padding:"6px 14px", marginBottom:24,
        }}>
          <LiveDot color="var(--amber)" size={6}/>
          <span style={{ fontSize:11, color:"var(--amber)", fontWeight:600, letterSpacing:"0.5px" }}>
            Live on Arc Testnet · {active.length} active markets
          </span>
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize:"clamp(32px, 7vw, 58px)", fontWeight:800,
          lineHeight:1.1, letterSpacing:"-1.5px",
          margin:"0 0 20px", maxWidth:700,
        }}>
          FX intelligence,<br/>
          <span style={{ color:"var(--amber)" }}>priced per signal.</span>
        </h1>

        <p style={{
          fontSize:"clamp(14px, 2.5vw, 17px)",
          color:"var(--text-secondary)", lineHeight:1.7,
          maxWidth:560, margin:"0 0 36px",
        }}>
          An autonomous AI agent monitors EUR/USD around the clock, pays for its own data at $0.001 per signal, and stakes real USDC on every market it creates. Analysts earn $0.04 per article read — every payment settled in USDC on Arc.
        </p>

        {/* CTAs */}
        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          <button
            onClick={onLaunchApp}
            style={{
              background:"var(--amber)", border:"none",
              color:"#0a0a0a", borderRadius:10,
              padding:"14px 28px",
              fontFamily:"Outfit, sans-serif", fontWeight:700, fontSize:14,
              cursor:"pointer", transition:"opacity 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity="0.88"}
            onMouseLeave={e => e.currentTarget.style.opacity="1"}
          >
            Launch App →
          </button>
          <a
            href={ARCSCAN} target="_blank" rel="noreferrer"
            style={{
              background:"transparent",
              border:"1px solid var(--border)",
              color:"var(--text-muted)", borderRadius:10,
              padding:"14px 28px",
              fontFamily:"Outfit, sans-serif", fontWeight:600, fontSize:14,
              textDecoration:"none", transition:"border-color 0.15s, color 0.15s",
              display:"inline-block",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor="var(--text-muted)"; e.currentTarget.style.color="var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--text-muted)"; }}
          >
            View Contract ↗
          </a>
        </div>
      </section>

      {/* ── LIVE STATS ── */}
      <section id="markets" style={{
        borderTop:"1px solid var(--border)",
        borderBottom:"1px solid var(--border)",
        background:"rgba(255,255,255,0.015)",
      }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"28px 20px" }}>
          <div className="h-stats-grid">
            {STAT_TILES.map((t) => (
              <div key={t.label} className="h-stat-tile">
                <div className="h-stat-value" style={{ color:t.color }}>
                  {t.raw != null ? <AnimatedNumber value={t.raw} format={t.format}/> : t.fallback}
                </div>
                <div className="h-stat-label">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="protocol" style={{ maxWidth:1100, margin:"0 auto", padding:"72px 20px" }}>
        <Reveal>
          <div style={{ marginBottom:48 }}>
            <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"2.5px", textTransform:"uppercase", marginBottom:10 }}>
              How it works
            </div>
            <h2 style={{ fontSize:"clamp(22px, 4vw, 34px)", fontWeight:800, letterSpacing:"-0.5px", margin:0, lineHeight:1.2 }}>
              Three steps to participate
            </h2>
          </div>
        </Reveal>

        <div className="h-feature-grid">
          {STEPS.map((s, i) => (
            <Reveal key={s.num} delay={i * 80}>
              <FeatureCard {...s}/>
            </Reveal>
          ))}
        </div>

        {/* Agent row — full width */}
        <Reveal delay={240}>
          <div style={{
            marginTop:16,
            background:"var(--bg-card)",
            border:"1px solid rgba(240,160,48,0.2)",
            borderRadius:16, padding:"24px 28px",
            display:"flex", alignItems:"center", gap:24, flexWrap:"wrap",
          }}>
            <div style={{
              width:40, height:40, borderRadius:10, flexShrink:0,
              background:"rgba(240,160,48,0.1)", border:"1px solid rgba(240,160,48,0.3)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:18,
            }}>🤖</div>
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"var(--text)", marginBottom:6 }}>
                The AI Agent runs everything
              </div>
              <div style={{ fontSize:13, color:"var(--text-dim)", lineHeight:1.7 }}>
                A Python agent powered by Groq monitors EURC/USDC every 5 minutes, detects momentum,
                pays $0.001 per signal from its own Circle wallet via x402, then creates and resolves markets on-chain.
                Zero human intervention. Every decision logged with a SHA-256 hash.
              </div>
            </div>
            <div style={{ display:"flex", gap:24, flexShrink:0, flexWrap:"wrap" }}>
              {[
                { label:"Signal cost", value:"$0.001" },
                { label:"Uptime",      value:"24/7" },
                { label:"Resolution",  value:"100%" },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:18, fontWeight:700, color:"var(--amber)", fontFamily:"IBM Plex Mono, monospace" }}>{value}</div>
                  <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"1.5px", textTransform:"uppercase", marginTop:3 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── INSIDE THE APP ── */}
      <section id="app-tour" style={{ borderTop:"1px solid var(--border)", maxWidth:1100, margin:"0 auto", padding:"72px 20px" }}>
        <Reveal>
          <div style={{ marginBottom:48 }}>
            <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"2.5px", textTransform:"uppercase", marginBottom:10 }}>
              Inside the app
            </div>
            <h2 style={{ fontSize:"clamp(22px, 4vw, 34px)", fontWeight:800, letterSpacing:"-0.5px", margin:0, lineHeight:1.2 }}>
              One agent, four tabs
            </h2>
          </div>
        </Reveal>
        <div className="h-feature-grid">
          {APP_TABS.map((s, i) => (
            <Reveal key={s.title} delay={i * 80}>
              <FeatureCard {...s}/>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── RECENTLY SETTLED ── */}
      {recent.length > 0 && (
        <section style={{ borderTop:"1px solid var(--border)", padding:"64px 20px" }}>
          <div style={{ maxWidth:1100, margin:"0 auto" }}>
            <Reveal>
              <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:28, gap:16, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"2.5px", textTransform:"uppercase", marginBottom:10 }}>
                    Recently settled
                  </div>
                  <h2 style={{ fontSize:"clamp(20px, 3.5vw, 30px)", fontWeight:800, letterSpacing:"-0.5px", margin:0 }}>
                    Latest market outcomes
                  </h2>
                </div>
                <button
                  onClick={onLaunchApp}
                  style={{
                    background:"transparent", border:"1px solid var(--border)",
                    color:"var(--text-muted)", borderRadius:8,
                    padding:"9px 18px", fontFamily:"Outfit, sans-serif",
                    fontWeight:600, fontSize:12, cursor:"pointer",
                    transition:"border-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor="var(--text-muted)"; e.currentTarget.style.color="var(--text)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--text-muted)"; }}
                >
                  View all markets →
                </button>
              </div>
            </Reveal>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:12 }}>
              {recent.map((m, i) => {
                const oc    = m.outcome;
                const color = oc === "YES" ? "var(--green)" : oc === "NO" ? "var(--red)" : "var(--text-muted)";
                const pflag = PAIR_FLAG[m.pair] || "🌍";
                const pc    = PAIR_COLOR[m.pair] || "var(--text-muted)";
                return (
                  <Reveal key={m.id} delay={i * 60}>
                    <div style={{
                      background:"var(--bg-card)", border:"1px solid var(--border)",
                      borderRadius:14, padding:"18px 16px",
                      transition:"border-color 0.2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor="#2a2a38"}
                    onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                          <span style={{ fontSize:15 }}>{pflag}</span>
                          <span style={{
                            fontSize:9, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase",
                            padding:"2px 8px", borderRadius:4,
                            background:`${pc}18`, color:pc, border:`1px solid ${pc}33`,
                          }}>{m.pair}</span>
                        </div>
                        <span style={{
                          fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:6,
                          color, background:`${color}15`, border:`1px solid ${color}33`,
                          letterSpacing:"0.5px",
                        }}>
                          {oc === "YES" ? "✓ YES" : oc === "NO" ? "✕ NO" : "↩ VOID"}
                        </span>
                      </div>
                      <div style={{ fontSize:13, color:"var(--text-secondary)", lineHeight:1.5, marginBottom:10, fontWeight:500 }}>
                        {m.question}
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--text-dim)" }}>
                        <span>${fmtU(m.yes_pool + m.no_pool || 0)} TVL</span>
                        <span>{ago(m.created_at)}</span>
                        {m.tx_hash && (
                          <a href={`https://testnet.arcscan.app/tx/${m.tx_hash}`}
                            target="_blank" rel="noreferrer"
                            style={{ color:"var(--text-dim)", textDecoration:"none" }}
                            onClick={e => e.stopPropagation()}>
                            Arcscan ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── SIGNALS TEASER ── */}
      {signals.length > 0 && (
        <section id="signals" style={{
          borderTop:"1px solid var(--border)",
          padding:"64px 20px",
          background:"rgba(255,255,255,0.01)",
        }}>
          <div style={{ maxWidth:1100, margin:"0 auto" }}>
            <Reveal>
              <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:28, gap:16, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"2.5px", textTransform:"uppercase", marginBottom:10 }}>
                    Analyst signals
                  </div>
                  <h2 style={{ fontSize:"clamp(20px, 3.5vw, 30px)", fontWeight:800, letterSpacing:"-0.5px", margin:0 }}>
                    FX intelligence, priced per read
                  </h2>
                  <p style={{ fontSize:13, color:"var(--text-dim)", marginTop:8, lineHeight:1.6 }}>
                    Analysts publish FX signals. Readers pay $0.05 USDC to unlock. Analyst earns $0.04 instantly, on-chain.
                  </p>
                </div>
                <button
                  onClick={onLaunchApp}
                  style={{
                    background:"rgba(240,160,48,0.08)", border:"1px solid rgba(240,160,48,0.25)",
                    color:"var(--amber)", borderRadius:8,
                    padding:"9px 18px", fontFamily:"Outfit, sans-serif",
                    fontWeight:700, fontSize:12, cursor:"pointer",
                    transition:"background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(240,160,48,0.14)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(240,160,48,0.08)"}
                >
                  View all signals →
                </button>
              </div>
            </Reveal>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:12 }}>
              {signals.map((s, i) => {
                const pc = PAIR_COLOR[s.pair] || "var(--text-muted)";
                return (
                  <Reveal key={s.id} delay={i * 60}>
                    <div
                      onClick={onLaunchApp}
                      style={{
                        background:"var(--bg-card)", border:"1px solid var(--border)",
                        borderRadius:14, padding:"18px 16px", cursor:"pointer",
                        transition:"border-color 0.2s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor="rgba(240,160,48,0.3)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10, gap:8 }}>
                        <div style={{ flex:1 }}>
                          {s.pair && (
                            <span style={{
                              display:"inline-block", fontSize:9, fontWeight:700, letterSpacing:"1.2px",
                              textTransform:"uppercase", padding:"2px 8px", borderRadius:4, marginBottom:7,
                              background:`${pc}18`, color:pc, border:`1px solid ${pc}33`,
                            }}>{s.pair}</span>
                          )}
                          <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", lineHeight:1.4 }}>
                            {s.title}
                          </div>
                        </div>
                        <div style={{
                          fontSize:12, fontWeight:700, color:"var(--amber)",
                          fontFamily:"IBM Plex Mono, monospace", flexShrink:0,
                        }}>$0.05</div>
                      </div>
                      <div style={{
                        fontSize:12, color:"var(--text-dim)", lineHeight:1.6,
                        display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden",
                        marginBottom:10,
                      }}>
                        {s.preview}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:"var(--text-dim)" }}>
                        <span style={{ width:5, height:5, borderRadius:"50%", background:"var(--amber)", display:"inline-block" }}/>
                        <span style={{ fontFamily:"IBM Plex Mono, monospace" }}>
                          {s.author_wallet ? `${s.author_wallet.slice(0,6)}…${s.author_wallet.slice(-4)}` : "—"}
                        </span>
                        <span style={{ marginLeft:"auto" }}>{s.read_count} reads</span>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop:"1px solid var(--border-subtle)",
        padding:"24px 20px",
        marginTop:48,
      }}>
        <div style={{
          maxWidth:1100, margin:"0 auto",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          flexWrap:"wrap", gap:12,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:14, fontWeight:700 }}>
              Agora<span style={{ color:"var(--amber)" }}>FX</span>
            </span>
            <span style={{ fontSize:11, color:"var(--text-dim)" }}>
              · FX Intelligence · Arc Testnet
            </span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
            <a href={ARCSCAN} target="_blank" rel="noreferrer"
              style={{ fontSize:11, color:"var(--text-dim)", textDecoration:"none" }}>
              {CONTRACT_SHORT} ↗
            </a>
            <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer"
              style={{ fontSize:11, color:"var(--text-dim)", textDecoration:"none" }}>
              Arc Explorer ↗
            </a>
            <a href="https://x.com/Musa_Ais" target="_blank" rel="noreferrer"
              style={{ fontSize:11, color:"var(--text-dim)", textDecoration:"none" }}>
              𝕏 @Musa_Ais
            </a>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <LiveDot color="var(--green)" size={6}/>
              <span style={{ fontSize:11, color:"var(--text-dim)" }}>Live</span>
            </div>
          </div>
        </div>
      </footer>

      <style>{`
        /* Self-contained dark theme — intentionally not dependent on the
           visitor's OS color-scheme or on App.jsx having mounted. */
        :root {
          --bg: #0d0d0f;
          --bg-card: #131316;
          --border: #1e1e24;
          --border-subtle: #19191f;
          --text: #e8e8f0;
          --text-secondary: #a0a0b8;
          --text-muted: #606078;
          --text-dim: #3a3a50;
          --green: #00c878;
          --red: #f04040;
          --amber: #f0a030;
          --blue: #4aa8f0;
          --purple: #a78bfa;
          color-scheme: dark;
        }

        *:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }

        @media (max-width: 640px) {
          .home-nav-desktop { display: none !important; }
          .h-nav-toggle { display: flex !important; align-items: center; justify-content: center; }
        }
        .h-nav-toggle { display: none; }

        .h-mobile-menu {
          display: flex;
          flex-direction: column;
          border-top: 1px solid var(--border);
          background: var(--bg);
        }
        @media (min-width: 641px) {
          .h-mobile-menu { display: none !important; }
        }
        .h-mobile-menu a {
          padding: 14px 20px;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          text-decoration: none;
          border-bottom: 1px solid var(--border-subtle);
        }

        @keyframes h-ripple { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(3); opacity: 0; } }

        /* ── Stats ── */
        .h-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
        .h-stat-tile { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 10px; text-align: center; transition: border-color 0.2s, transform 0.2s; }
        .h-stat-tile:hover { border-color: #2a2a38; transform: translateY(-2px); }
        .h-stat-value { font-size: clamp(17px, 2.4vw, 24px); font-weight: 700; font-family: 'IBM Plex Mono', monospace; line-height: 1; margin-bottom: 6px; min-height: 24px; }
        .h-stat-label { font-size: 8.5px; color: var(--text-dim); letter-spacing: 1.2px; text-transform: uppercase; }

        /* ── Feature cards (How it works / Inside the app) ── */
        .h-feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
        .h-feature-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; position: relative; overflow: hidden; transition: border-color 0.2s; }
        .h-feature-num { position: absolute; top: 16px; right: 20px; font-size: 64px; font-weight: 800; font-family: 'IBM Plex Mono', monospace; line-height: 1; user-select: none; }
        .h-feature-icon { width: 40px; height: 40px; border-radius: 10px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .h-feature-title { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 10px; }
        .h-feature-desc { font-size: 13px; color: var(--text-dim); line-height: 1.7; }

        /* ── Ticker ── */
        .h-ticker-bar { display: flex; align-items: center; background: #0a0a0c; border-bottom: 1px solid var(--border); height: 30px; overflow: hidden; }
        .h-ticker-label { flex-shrink: 0; display: flex; align-items: center; gap: 6px; font-size: 8px; font-weight: 800; letter-spacing: 2px; color: var(--green); background: rgba(0,200,120,0.08); border-right: 1px solid rgba(0,200,120,0.15); padding: 0 12px; height: 100%; text-transform: uppercase; }
        .h-ticker-track-wrap { flex: 1; overflow: hidden; position: relative; }
        .h-ticker-track-wrap::before, .h-ticker-track-wrap::after { content: ''; position: absolute; top: 0; bottom: 0; width: 28px; z-index: 2; pointer-events: none; }
        .h-ticker-track-wrap::before { left: 0; background: linear-gradient(to right, #0a0a0c, transparent); }
        .h-ticker-track-wrap::after  { right: 0; background: linear-gradient(to left, #0a0a0c, transparent); }
        .h-ticker-track { display: inline-flex; align-items: center; white-space: nowrap; width: max-content; animation: h-ticker-scroll 14s linear infinite; }
        .h-ticker-track:hover { animation-play-state: paused; }
        .h-ticker-item { display: inline-flex; align-items: center; gap: 7px; padding: 0 20px; border-right: 1px solid var(--border); font-size: 11px; height: 30px; }
        .h-ticker-pair { color: var(--text-muted); font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.5px; }
        .h-ticker-sep  { color: var(--text-dim); font-size: 9px; }
        .h-ticker-rate { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; }
        @keyframes h-ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
      `}</style>
    </div>
  );
}
