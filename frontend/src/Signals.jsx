/**
 * AgoraFX — Signals Tab (Phase 4 / RFB-06)
 *
 * African analysts publish FX articles.
 * Readers pay $0.05 USDC via x402 (EIP-712, Arc Testnet).
 * Analyst earns $0.04 (80%) — immediate on-chain USDC transfer.
 *
 * UX model:
 *   Feed view  → scrollable list of article cards (title, author, preview, price)
 *   Reader view → full-screen article after payment (tap card to open)
 *
 * Re-read fix:
 *   On open, calls GET /intelligence/{id}/read?reader={wallet}
 *   If wallet already paid → content returned from server, no second charge.
 *   Works across devices, refreshes, tab switches, and wallet switches.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";

const API              = "https://api.kudiarc.xyz";
const ARTICLE_PRICE    = 0.05;
const ANALYST_SHARE    = 0.04;
const USDC_ADDRESS     = "0x3600000000000000000000000000000000000000";
const RECEIVER_ADDRESS = "0xca3B6Cc345e82F063EF61d534cAaA36c20c2b061";
const CHAIN_ID         = 5042002;
const PAIRS            = ["USDC/NGN","USDC/GHS","USDC/KES","USDC/ZAR","USDC/EGP","USDC/EURC"];

const short = (a) => a ? `${a.slice(0,6)}…${a.slice(-4)}` : "—";
const ago   = (ts) => {
  const s = Math.floor((Date.now() - new Date(ts+"Z").getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(ts+"Z").toLocaleDateString("en-US",{month:"short",day:"numeric"});
};

const PAIR_COLOR = {
  "USDC/NGN":"#4aa8f0","USDC/GHS":"#00c878","USDC/KES":"#00c878",
  "USDC/ZAR":"#f0a030","USDC/EGP":"#f0a030","USDC/EURC":"#a78bfa",
};

// ── EIP-712 payment signing ───────────────────────────────────────────────────
async function signAndPay(wallet_account, article_id) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer   = await provider.getSigner();
  const payer    = await signer.getAddress();

  const validAfter  = Math.floor(Date.now() / 1000).toString();
  const validBefore = (Math.floor(Date.now() / 1000) + 608400).toString();
  const nonce       = ethers.hexlify(ethers.randomBytes(32));
  const value       = Math.round(ARTICLE_PRICE * 1_000_000).toString();

  const domain = {
    name: "USD Coin", version: "2",
    chainId: CHAIN_ID, verifyingContract: USDC_ADDRESS,
  };
  const types = {
    TransferWithAuthorization: [
      { name:"from",        type:"address" },
      { name:"to",          type:"address" },
      { name:"value",       type:"uint256" },
      { name:"validAfter",  type:"uint256" },
      { name:"validBefore", type:"uint256" },
      { name:"nonce",       type:"bytes32" },
    ],
  };
  const message = {
    from: payer, to: RECEIVER_ADDRESS,
    value, validAfter, validBefore, nonce,
  };

  const signature = await signer.signTypedData(domain, types, message);
  const resource  = `${API}/intelligence/${article_id}`;

  const paymentPayload = {
    x402Version: 1, scheme: "exact", network: "eip155:5042002",
    payload: {
      signature,
      authorization: { from:message.from, to:message.to, value, validAfter, validBefore, nonce },
    },
    resource,
  };

  const resp = await fetch(resource, {
    headers: { "X-PAYMENT": btoa(JSON.stringify(paymentPayload)) },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Payment failed (${resp.status}): ${body.slice(0,200)}`);
  }

  return await resp.json();
}

// ── ArticleReader (full-screen overlay) ──────────────────────────────────────
function ArticleReader({ article, wallet, onClose }) {
  const [state,   setState]   = useState("checking"); // checking|unpaid|signing|loading|done|error
  const [data,    setData]    = useState(null);
  const [errMsg,  setErrMsg]  = useState("");
  const checked = useRef(false);

  // On mount: check if this wallet already paid (server-side, wallet-aware)
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    if (!wallet.account) {
      setState("unpaid");
      return;
    }

    fetch(`${API}/intelligence/${article.id}/read?reader=${wallet.account}`)
      .then(r => r.json())
      .then(res => {
        if (res.paid) {
          setData(res);
          setState("done");
        } else {
          setState("unpaid");
        }
      })
      .catch(() => setState("unpaid"));
  }, [article.id, wallet.account]);

  const pay = async () => {
    if (!wallet.account) { wallet.connect(); return; }
    if (!wallet.chainOk) { await wallet.switchToArc(); return; }

    setState("signing");
    setErrMsg("");
    try {
      setState("loading");
      const res = await signAndPay(wallet.account, article.id);
      setData(res);
      setState("done");
    } catch (err) {
      console.error(err);
      setErrMsg(err?.message || "Transaction failed");
      setState("error");
    }
  };

  const color = article.pair ? (PAIR_COLOR[article.pair] || "var(--text-muted)") : "var(--amber)";

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9999,
      background:"var(--bg)", overflowY:"auto",
      display:"flex", flexDirection:"column",
    }}>
      {/* Top bar */}
      <div style={{
        position:"sticky", top:0, zIndex:10,
        background:"rgba(13,13,15,0.95)", backdropFilter:"blur(12px)",
        borderBottom:"1px solid var(--border)",
        padding:"12px 16px", display:"flex", alignItems:"center", gap:12,
      }}>
        <button onClick={onClose} style={{
          background:"none", border:"1px solid var(--border)",
          color:"var(--text-muted)", borderRadius:8,
          width:34, height:34, cursor:"pointer", fontSize:16,
          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
        }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{
            fontSize:13, fontWeight:700, color:"var(--text)",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>
            {article.title}
          </div>
          <div style={{ fontSize:10, color:"var(--text-dim)", marginTop:2 }}>
            {short(article.author_wallet)} · {ago(article.created_at)}
          </div>
        </div>
        {article.pair && (
          <span style={{
            fontSize:9, fontWeight:700, letterSpacing:"1.2px",
            textTransform:"uppercase", padding:"3px 8px", borderRadius:5,
            background:`${color}18`, color, border:`1px solid ${color}44`,
            flexShrink:0,
          }}>{article.pair}</span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex:1, maxWidth:680, margin:"0 auto", width:"100%", padding:"24px 18px 48px" }}>

        {/* CHECKING */}
        {state === "checking" && (
          <div style={{ textAlign:"center", padding:"60px 0", color:"var(--text-dim)", fontSize:13 }}>
            Checking access…
          </div>
        )}

        {/* UNPAID — paywall */}
        {(state === "unpaid" || state === "signing" || state === "loading" || state === "error") && (
          <>
            {/* Preview blurred */}
            <div style={{ position:"relative", marginBottom:28 }}>
              <div style={{
                fontSize:14, lineHeight:1.8, color:"var(--text-secondary)",
                filter: state === "unpaid" ? "blur(3px)" : "none",
                userSelect:"none", pointerEvents:"none",
                maxHeight:160, overflow:"hidden",
              }}>
                {article.preview}
              </div>
              <div style={{
                position:"absolute", bottom:0, left:0, right:0, height:80,
                background:"linear-gradient(to bottom, transparent, var(--bg))",
              }}/>
            </div>

            {/* Paywall card */}
            <div style={{
              background:"var(--bg-card)",
              border:"1px solid rgba(240,160,48,0.25)",
              borderRadius:16, padding:24, textAlign:"center",
            }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🔒</div>
              <div style={{ fontSize:15, fontWeight:700, color:"var(--text)", marginBottom:6 }}>
                Premium Signal
              </div>
              <div style={{ fontSize:13, color:"var(--text-dim)", lineHeight:1.6, marginBottom:20 }}>
                Pay once with your connected wallet.<br/>
                Re-read anytime, from any device — no repeat charges.
              </div>

              {/* Price breakdown */}
              <div style={{
                display:"flex", gap:0,
                background:"var(--bg)", border:"1px solid var(--border)",
                borderRadius:10, overflow:"hidden", marginBottom:20,
              }}>
                <div style={{ flex:1, padding:"12px 0", borderRight:"1px solid var(--border)" }}>
                  <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"1.5px", textTransform:"uppercase", marginBottom:4 }}>You pay</div>
                  <div style={{ fontSize:18, fontWeight:700, color:"var(--amber)", fontFamily:"IBM Plex Mono, monospace" }}>${ARTICLE_PRICE.toFixed(2)}</div>
                </div>
                <div style={{ flex:1, padding:"12px 0" }}>
                  <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"1.5px", textTransform:"uppercase", marginBottom:4 }}>Analyst earns</div>
                  <div style={{ fontSize:18, fontWeight:700, color:"var(--green)", fontFamily:"IBM Plex Mono, monospace" }}>${ANALYST_SHARE.toFixed(2)}</div>
                </div>
              </div>

              {state === "error" && (
                <div style={{
                  fontSize:12, color:"var(--red)", marginBottom:14,
                  background:"rgba(240,64,64,0.08)", border:"1px solid rgba(240,64,64,0.2)",
                  borderRadius:8, padding:"8px 12px",
                }}>{errMsg}</div>
              )}

              <button onClick={pay} disabled={state === "signing" || state === "loading"} style={{
                width:"100%", padding:"14px 0",
                background: (state === "signing" || state === "loading")
                  ? "rgba(255,255,255,0.04)"
                  : "var(--amber)",
                border:"none", borderRadius:10,
                color: (state === "signing" || state === "loading") ? "var(--text-dim)" : "#0a0a0a",
                fontFamily:"Outfit, sans-serif", fontWeight:700, fontSize:14,
                cursor: (state === "signing" || state === "loading") ? "not-allowed" : "pointer",
                opacity: (state === "signing" || state === "loading") ? 0.6 : 1,
                transition:"opacity 0.15s",
              }}>
                {!wallet.account    ? "Connect Wallet to Read"   :
                 !wallet.chainOk    ? "Switch to Arc Testnet"    :
                 state === "signing" ? "Sign in wallet…"         :
                 state === "loading" ? "Unlocking…"              :
                 `Unlock for $${ARTICLE_PRICE.toFixed(2)} USDC →`}
              </button>

              <div style={{ fontSize:10, color:"var(--text-dim)", marginTop:10 }}>
                USDC · Arc Testnet · Settled on-chain
              </div>
            </div>
          </>
        )}

        {/* DONE — full article */}
        {state === "done" && data && (
          <>
            <div style={{
              fontSize:15, lineHeight:1.85, color:"var(--text-secondary)",
              whiteSpace:"pre-wrap", wordBreak:"break-word",
            }}>
              {data.content}
            </div>

            {/* Payment receipt */}
            <div style={{
              marginTop:32, padding:"16px",
              background:"rgba(0,200,120,0.05)",
              border:"1px solid rgba(0,200,120,0.15)",
              borderRadius:12,
            }}>
              <div style={{ fontSize:11, color:"var(--green)", fontWeight:700, marginBottom:10 }}>
                ✓ Unlocked · Analyst paid
              </div>
              <div style={{
                display:"flex", gap:16, fontSize:11,
                color:"var(--text-dim)", flexWrap:"wrap", marginBottom:8,
              }}>
                <span>Reader paid: <span style={{ color:"var(--amber)", fontFamily:"monospace" }}>${data.payment?.amount_usdc || ARTICLE_PRICE}</span></span>
                <span>Analyst earned: <span style={{ color:"var(--green)", fontFamily:"monospace" }}>${data.payment?.analyst_share || ANALYST_SHARE}</span></span>
                <span style={{ color: data.payment?.payout_status === "confirmed" ? "var(--green)" : "var(--text-dim)" }}>
                  Payout: {data.payment?.payout_status || "pending"}
                </span>
              </div>
              {data.payment?.arcscan_url && (
                <a href={data.payment.arcscan_url} target="_blank" rel="noreferrer"
                  style={{ fontSize:11, color:"var(--text-muted)", textDecoration:"none" }}>
                  Analyst payout tx on Arcscan ↗
                </a>
              )}
              {data.payment?.payout_tx && !data.payment?.arcscan_url && (
                <a href={`https://testnet.arcscan.app/tx/${data.payment.payout_tx}`}
                  target="_blank" rel="noreferrer"
                  style={{ fontSize:11, color:"var(--text-muted)", textDecoration:"none" }}>
                  Analyst payout tx on Arcscan ↗
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── ArticleCard (feed item) ───────────────────────────────────────────────────
function ArticleCard({ article, onClick }) {
  const color = article.pair ? (PAIR_COLOR[article.pair] || "var(--text-muted)") : null;

  return (
    <div
      onClick={onClick}
      style={{
        background:"var(--bg-card)", border:"1px solid var(--border)",
        borderRadius:14, padding:"18px 16px", marginBottom:10, cursor:"pointer",
        transition:"border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor="#2a2a38"}
      onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
    >
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:10 }}>
        <div style={{ flex:1 }}>
          {color && (
            <span style={{
              display:"inline-block", fontSize:9, fontWeight:700,
              letterSpacing:"1.2px", textTransform:"uppercase",
              padding:"2px 8px", borderRadius:4, marginBottom:7,
              background:`${color}18`, color, border:`1px solid ${color}33`,
            }}>{article.pair}</span>
          )}
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text)", lineHeight:1.4 }}>
            {article.title}
          </div>
        </div>
        <div style={{
          fontSize:13, fontWeight:700, color:"var(--amber)",
          fontFamily:"IBM Plex Mono, monospace", flexShrink:0, paddingTop:2,
        }}>
          ${ARTICLE_PRICE.toFixed(2)}
        </div>
      </div>

      <div style={{
        fontSize:12, color:"var(--text-dim)", lineHeight:1.6,
        marginBottom:12, display:"-webkit-box",
        WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden",
      }}>
        {article.preview}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ width:5, height:5, borderRadius:"50%", background:"var(--amber)", flexShrink:0 }}/>
        <span style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"IBM Plex Mono, monospace" }}>
          {short(article.author_wallet)}
        </span>
        <span style={{ fontSize:10, color:"var(--text-dim)", marginLeft:"auto" }}>
          {ago(article.created_at)}
        </span>
        <span style={{
          fontSize:9, color:"var(--text-dim)",
          background:"var(--bg)", border:"1px solid var(--border)",
          borderRadius:4, padding:"2px 7px",
        }}>
          {article.read_count} read{article.read_count !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ── PublishForm ───────────────────────────────────────────────────────────────
function PublishForm({ wallet, onPublished, onClose }) {
  const [title,   setTitle]   = useState("");
  const [pair,    setPair]    = useState("");
  const [content, setContent] = useState("");
  const [step,    setStep]    = useState("idle");
  const [err,     setErr]     = useState("");

  const submit = async () => {
    if (!wallet.account) { wallet.connect(); return; }
    if (!title.trim() || !content.trim()) { setErr("Title and content are required."); return; }
    setStep("submitting"); setErr("");
    try {
      const resp = await fetch(`${API}/intelligence`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          title: title.trim(),
          author_wallet: wallet.account,
          pair: pair || null,
          content: content.trim(),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setStep("done");
      setTimeout(() => { onPublished?.(); onClose?.(); }, 1800);
    } catch(e) {
      setErr(e?.message || "Failed to publish");
      setStep("idle");
    }
  };

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9999,
      background:"var(--bg)", overflowY:"auto",
    }}>
      {/* Top bar */}
      <div style={{
        position:"sticky", top:0, zIndex:10,
        background:"rgba(13,13,15,0.95)", backdropFilter:"blur(12px)",
        borderBottom:"1px solid var(--border)",
        padding:"12px 16px", display:"flex", alignItems:"center", gap:12,
      }}>
        <button onClick={onClose} style={{
          background:"none", border:"1px solid var(--border)",
          color:"var(--text-muted)", borderRadius:8,
          width:34, height:34, cursor:"pointer", fontSize:16,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>←</button>
        <span style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>Publish Signal</span>
      </div>

      <div style={{ maxWidth:640, margin:"0 auto", padding:"24px 18px 60px" }}>

        <div style={{
          background:"rgba(0,200,120,0.05)",
          border:"1px solid rgba(0,200,120,0.15)",
          borderRadius:10, padding:"12px 14px", marginBottom:24,
          fontSize:12, color:"var(--text-dim)", lineHeight:1.6,
        }}>
          Each reader pays <span style={{ color:"var(--amber)" }}>${ARTICLE_PRICE.toFixed(2)} USDC</span>.
          You earn <span style={{ color:"var(--green)" }}>${ANALYST_SHARE.toFixed(2)} USDC (80%)</span> per read —
          on-chain, immediate, visible on arcscan.app.
          Earnings go to: <span style={{ fontFamily:"monospace", color:"var(--text-secondary)" }}>
            {wallet.account ? short(wallet.account) : "connect wallet"}
          </span>
        </div>

        <div style={fieldWrap}>
          <div style={labelS}>Title</div>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="NGN at ₦1,400 — what the parallel market is signalling"
            style={inputS} maxLength={200}/>
        </div>

        <div style={fieldWrap}>
          <div style={labelS}>Currency Pair</div>
          <select value={pair} onChange={e => setPair(e.target.value)} style={inputS}>
            <option value="">— none —</option>
            {PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={fieldWrap}>
          <div style={labelS}>Content</div>
          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder="Write your analysis. Readers will see a preview — the full article unlocks after payment."
            rows={12} style={{ ...inputS, resize:"vertical", minHeight:200, lineHeight:1.75 }}/>
        </div>

        {err && (
          <div style={{
            fontSize:12, color:"var(--red)", marginBottom:14,
            background:"rgba(240,64,64,0.08)",
            border:"1px solid rgba(240,64,64,0.2)",
            borderRadius:8, padding:"8px 12px",
          }}>{err}</div>
        )}

        {step === "done" ? (
          <div style={{ textAlign:"center", color:"var(--green)", fontWeight:700, fontSize:14, padding:"16px 0" }}>
            ✓ Published — readers can now unlock your signal for ${ARTICLE_PRICE.toFixed(2)}
          </div>
        ) : (
          <button onClick={submit} disabled={step === "submitting"} style={{
            width:"100%", padding:"14px 0",
            background: step === "submitting" ? "rgba(255,255,255,0.04)" : "var(--amber)",
            border:"none", borderRadius:10, color: step === "submitting" ? "var(--text-dim)" : "#0a0a0a",
            fontFamily:"Outfit, sans-serif", fontWeight:700, fontSize:14,
            cursor: step === "submitting" ? "not-allowed" : "pointer",
            opacity: step === "submitting" ? 0.6 : 1,
          }}>
            {!wallet.account ? "Connect Wallet First" : step === "submitting" ? "Publishing…" : "Publish Signal →"}
          </button>
        )}
      </div>
    </div>
  );
}

const fieldWrap = { marginBottom:18 };
const labelS    = { fontSize:9, color:"var(--text-dim)", letterSpacing:"1.5px", textTransform:"uppercase", marginBottom:6 };
const inputS    = {
  width:"100%", background:"var(--bg-card)",
  border:"1px solid var(--border)", borderRadius:8,
  padding:"11px 13px", color:"var(--text)",
  fontSize:13, fontFamily:"Outfit, sans-serif", outline:"none",
};

// ── StatsBar ──────────────────────────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div style={{ display:"flex", gap:8, marginBottom:20 }}>
      {[
        { label:"Signals",        value: stats.article_count,                           color:"var(--text)" },
        { label:"Total Earned",   value:`$${Number(stats.total_earned).toFixed(4)}`,    color:"var(--green)" },
        { label:"Total Reads",    value: stats.payment_count,                           color:"var(--amber)" },
      ].map(({ label, value, color }) => (
        <div key={label} style={{
          flex:1, background:"var(--bg-card)",
          border:"1px solid var(--border)", borderRadius:10,
          padding:"12px 8px", textAlign:"center",
        }}>
          <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"1.8px", textTransform:"uppercase", marginBottom:5 }}>
            {label}
          </div>
          <div style={{ fontSize:20, fontWeight:700, color, fontFamily:"IBM Plex Mono, monospace" }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── TopAnalysts ───────────────────────────────────────────────────────────────
function TopAnalysts({ authors }) {
  if (!authors?.length) return null;
  return (
    <div style={{
      background:"var(--bg-card)", border:"1px solid var(--border)",
      borderRadius:12, padding:"14px 16px", marginBottom:20,
    }}>
      <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"1.8px", textTransform:"uppercase", marginBottom:12 }}>
        Top Analysts
      </div>
      {authors.map((a, i) => (
        <div key={a.wallet} style={{
          display:"flex", alignItems:"center", gap:10,
          padding:"8px 0",
          borderBottom: i < authors.length-1 ? "1px solid var(--border-subtle)" : "none",
        }}>
          <span style={{ fontSize:10, color:"var(--text-dim)", width:18, flexShrink:0 }}>#{i+1}</span>
          <span style={{ flex:1, fontSize:11, fontFamily:"IBM Plex Mono, monospace", color:"var(--text-secondary)" }}>
            {short(a.wallet)}
          </span>
          <span style={{ fontSize:10, color:"var(--text-dim)" }}>{a.articles_sold} reads</span>
          <span style={{ fontSize:12, color:"var(--green)", fontFamily:"IBM Plex Mono, monospace", fontWeight:700 }}>
            ${Number(a.total_earned).toFixed(4)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Signals (main export) ─────────────────────────────────────────────────────
export default function Signals({ wallet }) {
  const [articles,   setArticles]   = useState([]);
  const [stats,      setStats]      = useState(null);
  const [filter,     setFilter]     = useState("");
  const [loading,    setLoading]    = useState(true);
  const [openArticle,setOpenArticle]= useState(null);   // article object | null
  const [showPublish,setShowPublish] = useState(false);
  const polling = useRef(null);

  const load = useCallback(async () => {
    try {
      const url = `${API}/intelligence${filter ? `?pair=${encodeURIComponent(filter)}` : ""}`;
      const [arts, st] = await Promise.all([
        fetch(url).then(r => r.json()),
        fetch(`${API}/intelligence/stats`).then(r => r.json()),
      ]);
      setArticles(Array.isArray(arts) ? arts : []);
      setStats(st);
    } catch(e) {
      console.error("signals load:", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    polling.current = setInterval(load, 20000);
    return () => clearInterval(polling.current);
  }, [load]);

  return (
    <div>
      {/* Full-screen overlays */}
      {showPublish && (
        <PublishForm
          wallet={wallet}
          onPublished={load}
          onClose={() => setShowPublish(false)}
        />
      )}
      {openArticle && (
        <ArticleReader
          article={openArticle}
          wallet={wallet}
          onClose={() => setOpenArticle(null)}
        />
      )}

      {/* ── Feed ── */}
      <StatsBar stats={stats} />

      {stats?.top_authors?.length > 0 && (
        <TopAnalysts authors={stats.top_authors} />
      )}

      {/* Publish CTA */}
      <button
        onClick={() => setShowPublish(true)}
        style={{
          width:"100%", padding:"13px 0", marginBottom:20,
          background:"rgba(240,160,48,0.06)",
          border:"1px dashed rgba(240,160,48,0.3)",
          color:"var(--amber)", borderRadius:12,
          fontFamily:"Outfit, sans-serif", fontWeight:700, fontSize:13,
          cursor:"pointer", transition:"background 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background="rgba(240,160,48,0.1)"}
        onMouseLeave={e => e.currentTarget.style.background="rgba(240,160,48,0.06)"}
      >
        + Publish FX Signal
      </button>

      {/* Pair filter */}
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
        {["", ...PAIRS].map(p => (
          <button key={p} onClick={() => setFilter(p)} style={{
            background: filter===p ? "rgba(240,160,48,0.12)" : "transparent",
            border:`1px solid ${filter===p ? "var(--amber)" : "var(--border)"}`,
            color: filter===p ? "var(--amber)" : "var(--text-muted)",
            borderRadius:7, padding:"5px 11px",
            fontSize:11, fontFamily:"Outfit, sans-serif",
            fontWeight: filter===p ? 700 : 500,
            cursor:"pointer", transition:"all 0.15s",
          }}>
            {p || "All"}
          </button>
        ))}
      </div>

      {/* Article list */}
      {loading ? (
        <div style={{ textAlign:"center", color:"var(--text-dim)", padding:"48px 0", fontSize:13 }}>
          Loading signals…
        </div>
      ) : articles.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 0" }}>
          <div style={{ fontSize:32, marginBottom:12 }}>📡</div>
          <div style={{ fontSize:15, fontWeight:600, color:"var(--text-muted)", marginBottom:6 }}>
            No signals yet
          </div>
          <div style={{ fontSize:12, color:"var(--text-dim)" }}>
            Be the first analyst to publish — earn $0.04 per read, on-chain.
          </div>
        </div>
      ) : (
        articles.map(a => (
          <ArticleCard
            key={a.id}
            article={a}
            onClick={() => setOpenArticle(a)}
          />
        ))
      )}

      <div style={{ textAlign:"center", marginTop:20, fontSize:10, color:"var(--text-dim)" }}>
        Payments settled on Arc Testnet · USDC ·{" "}
        <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer"
          style={{ color:"var(--text-dim)", textDecoration:"none" }}>
          arcscan.app ↗
        </a>
      </div>
    </div>
  );
}
