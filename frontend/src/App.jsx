import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { ethers } from "ethers";                        import { shareOnX, shareMarket } from "./share.js";
import { loadUserPositions, loadMarketPool, getProvider, CONTRACT_ADDRESS, USDC_ADDRESS } from "./onchain.js";

const API = "https://api.kudiarc.xyz";
const PUBLIC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN = {                                       chainId:"0x4cef52",chainName:"Arc Testnet",
  nativeCurrency:{name:"USDC",symbol:"USDC",decimals:6},
  rpcUrls:[PUBLIC_RPC],blockExplorerUrls:["https://testnet.arcscan.app"],                                       };
                                                        const MARKET_ABI = [
  {type:"function",name:"placeBet",inputs:[{name:"marketId",type:"bytes32"},{name:"isYes",type:"bool"},{name:"amount",type:"uint256"}],outputs:[],stateMutability:"nonpayable"},                                                  {type:"function",name:"claimWinnings",inputs:[{name:"marketId",type:"bytes32"}],outputs:[],stateMutability:"nonpayable"},
  {type:"function",name:"getMarket",inputs:[{name:"marketId",type:"bytes32"}],outputs:[{name:"",type:"tuple",components:[{name:"id",type:"bytes32"},{name:"pair",type:"string"},{name:"question",type:"string"},{name:"threshold",type:"uint256"},{name:"isAbove",type:"bool"},{name:"expiry",type:"uint256"},{name:"yesPool",type:"uint256"},{name:"noPool",type:"uint256"},{name:"outcome",type:"uint8"},{name:"resolved",type:"bool"},{name:"createdAt",type:"uint256"}]}],stateMutability:"view"},
  {type:"function",name:"getPosition",inputs:[{name:"marketId",type:"bytes32"},{name:"user",type:"address"}],outputs:[{name:"",type:"tuple",components:[{name:"yesAmount",type:"uint256"},{name:"noAmount",type:"uint256"},{name:"claimed",type:"bool"}]}],stateMutability:"view"},
];
const USDC_ABI=["function approve(address,uint256) external returns(bool)","function allowance(address,address) external view returns(uint256)","function balanceOf(address) external view returns(uint256)"];

const fmt=(n,d=4)=>Number(n).toFixed(d);
const fmtNGN=(n)=>Number(n).toLocaleString("en-NG",{maximumFractionDigits:0});
const fmtU=(n)=>(Number(n)/1e6).toFixed(2);
const ago=(ts)=>{const s=Math.floor((Date.now()-new Date(ts+"Z").getTime())/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ago`;const d=new Date(ts+"Z");return d.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});};
const timeLeft=(e)=>{const s=e-Math.floor(Date.now()/1000);if(s<=0)return"Expired";if(s<60)return`${s}s`;if(s<3600)return`${Math.floor(s/60)}m ${s%60}s`;return`${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;};
const short=(a)=>a?`${a.slice(0,6)}…${a.slice(-4)}`:"";
const calcMult=(s,t)=>(!s||s===0)?null:((t/s)*0.99).toFixed(2);

// ── Ticker config ─────────────────────────────────────────────
const TICKER_PAIRS = [
  { key:"USDC/EURC", label:"EURC/USDC", color:"#f0a030", fmt:(r)=>fmt(r,4) },
  { key:"USDC/NGN",  label:"NGN",       color:"#4aa8f0", fmt:(r)=>`₦${fmtNGN(r)}` },
  { key:"USDC/GHS",  label:"GHS",       color:"#00c878", fmt:(r)=>`₵${fmt(r,2)}` },
  { key:"USDC/KES",  label:"KES",       color:"#00c878", fmt:(r)=>`KSh${fmt(r,2)}` },
  { key:"USDC/ZAR",  label:"ZAR",       color:"#f0a030", fmt:(r)=>`R${fmt(r,2)}` },
  { key:"USDC/EGP",  label:"EGP",       color:"#f0a030", fmt:(r)=>`E£${fmt(r,2)}` },
];


// Target display symbols for MarketCard footer
const TARGET_SYMBOLS = {
  "USDC/NGN": { sym:"₦", dec:0 },
  "USDC/GHS": { sym:"₵", dec:2 },
  "USDC/KES": { sym:"KSh", dec:2 },
  "USDC/ZAR": { sym:"R", dec:2 },
  "USDC/EGP": { sym:"E£", dec:2 },
  "USDC/EURC":{ sym:"", dec:4 },
};

function fmtTarget(market) {
  const v = market.threshold / 1_000_000;
  const cfg = TARGET_SYMBOLS[market.pair];
  if (!cfg) return v.toFixed(2);
  const num = cfg.dec === 0 ? Math.round(v).toLocaleString() : v.toFixed(cfg.dec);
  return `${cfg.sym}${num}`;
}

// ── Hooks ─────────────────────────────────────────────────────
function useWallet(){
  const [account,setAccount]=useState(null);
  const [chainOk,setChainOk]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [usdcBalance,setUsdcBalance]=useState(null);
  const checkChain=async()=>{if(!window.ethereum)return;const id=await window.ethereum.request({method:"eth_chainId"});setChainOk(id.toLowerCase()===ARC_CHAIN.chainId.toLowerCase());};
  const fetchBalance=useCallback(async(addr)=>{if(!addr)return;try{const usdc=new ethers.Contract(USDC_ADDRESS,USDC_ABI,getProvider());const b=await usdc.balanceOf(addr);setUsdcBalance((Number(b)/1e6).toFixed(2));}catch{}},[]);
  const connect=async()=>{if(!window.ethereum){setError("No wallet found.");return;}setLoading(true);setError(null);try{const a=await window.ethereum.request({method:"eth_requestAccounts"});setAccount(a[0]);await checkChain();await fetchBalance(a[0]);}catch{setError("Rejected.");}finally{setLoading(false);}};
  const switchToArc=async()=>{try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:ARC_CHAIN.chainId}]});setChainOk(true);}catch(e){if(e.code===4902){try{await window.ethereum.request({method:"wallet_addEthereumChain",params:[ARC_CHAIN]});setChainOk(true);}catch{}}}};
  useEffect(()=>{if(!window.ethereum)return;
    // Only listen for account/chain changes — don't auto-connect on load
    window.ethereum.on("accountsChanged",a=>{setAccount(a[0]||null);if(a[0])fetchBalance(a[0]);});
    window.ethereum.on("chainChanged",()=>checkChain());
  },[fetchBalance]);
  useEffect(()=>{if(!account)return;const t=setInterval(()=>fetchBalance(account),15000);return()=>clearInterval(t);},[account,fetchBalance]);
  const placeBet=async(mid,isYes,amt)=>{const p=new ethers.BrowserProvider(window.ethereum);const s=await p.getSigner();const u=new ethers.Contract(USDC_ADDRESS,USDC_ABI,s);const m=new ethers.Contract(CONTRACT_ADDRESS,MARKET_ABI,s);const a=ethers.parseUnits(amt.toString(),6);const al=await u.allowance(await s.getAddress(),CONTRACT_ADDRESS);if(al<a)await(await u.approve(CONTRACT_ADDRESS,a)).wait();const r=await(await m.placeBet(ethers.zeroPadValue(mid,32),isYes,a)).wait();setTimeout(()=>fetchBalance(account),3000);return r.hash;};
  const claimWinnings=async(mid)=>{const p=new ethers.BrowserProvider(window.ethereum);const s=await p.getSigner();const c=new ethers.Contract(CONTRACT_ADDRESS,MARKET_ABI,s);const r=await(await c.claimWinnings(ethers.zeroPadValue(mid,32))).wait();setTimeout(()=>fetchBalance(account),3000);return r.hash;};
  return{account,chainOk,loading,error,connect,switchToArc,placeBet,claimWinnings,usdcBalance,fetchBalance};
}

function usePool(mid){
  const [pool,setPool]=useState({yes:0,no:0});
  const load=useCallback(async()=>{const p=await loadMarketPool(mid);setPool(p);},[mid]);
  useEffect(()=>{load();const t=setInterval(load,10000);return()=>clearInterval(t);},[load]);
  return{pool,refresh:load};
}

// ── Components ────────────────────────────────────────────────
const LiveDot=({color="var(--green)"})=>(
  <span style={{position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",width:10,height:10,flexShrink:0}}>
    <span style={{position:"absolute",inset:0,borderRadius:"50%",background:color,animation:"ripple 2s ease-out infinite",opacity:0.5}}/>
    <span style={{width:6,height:6,borderRadius:"50%",background:color,position:"relative"}}/>
  </span>
);

function WalletButton({wallet}){
  if(!wallet.account)return(
    <button onClick={wallet.connect} className="btn-connect">
      {wallet.loading?"Connecting…":"Connect Wallet"}
    </button>
  );
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
      {!wallet.chainOk&&(
        <button onClick={wallet.switchToArc} className="btn-switch">⚠ Switch Network</button>
      )}
      <div className="wallet-pill">
        <span style={{width:6,height:6,borderRadius:"50%",background:wallet.chainOk?"var(--green)":"var(--red)",flexShrink:0}}/>
        <span className="mono" style={{fontSize:11,color:"var(--text-muted)",cursor:"pointer"}}
          onClick={()=>navigator.clipboard.writeText(wallet.account)}
          title="Click to copy address">
          {short(wallet.account)}
        </span>
        {wallet.usdcBalance!==null&&(
          <span className="mono" style={{fontSize:11,color:"var(--amber)",borderLeft:"1px solid var(--border)",paddingLeft:8}}>${wallet.usdcBalance}</span>
        )}
      </div>
    </div>
  );
}

// ── Ticker// ── Ticker ────────────────────────────────────────────────────
function Ticker({latest}){
  // Match against all possible key formats the API might return
  const getRate = (p) => {
    if (!latest) return null;
    const currency = p.key.replace('USDC/', '').replace('/USDC', '');
    return latest[p.key]
      || latest[p.key.split('/').reverse().join('/')]
      || latest[currency + '/USDC']
      || latest['USDC/' + currency]
      || latest[currency]
      || null;
  };
  const available = TICKER_PAIRS.filter(p => getRate(p));
  if(!available.length) return null;
  // Duplicate 3x for seamless infinite scroll on all screen sizes
  const items = [...available,...available];
  return(
    <div className="ticker-bar">
      <div className="ticker-label">
        <LiveDot color="var(--green)"/>
        <span>LIVE</span>
      </div>
      <div className="ticker-track-wrap">
        <div className="ticker-track">
          {items.map((p,i)=>(
            <span key={i} className="ticker-item">
              <span className="ticker-pair">{p.key.replace("USDC/","")}/USDC</span>
              <span className="ticker-sep">·</span>
              <span className="ticker-rate" style={{color:p.color}}>{p.fmt(getRate(p).rate)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────
function Header({latest,wallet}){
  return(
    <header className="site-header">
      <Ticker latest={latest}/>
      <div className="header-inner">
        <div className="logo-block">
          <div className="logo-text">Agora<span style={{color:"var(--amber)"}}>FX</span></div>
          <div className="logo-sub">African FX · Arc Testnet</div>
        </div>
        <WalletButton wallet={wallet}/>
      </div>
    </header>
  );
}

// ── BetModal ──────────────────────────────────────────────────
function BetModal({market,side,wallet,onClose,onSuccess}){
  const [amount,setAmount]=useState("1");
  const [step,setStep]=useState("idle");
  const [txHash,setTxHash]=useState(null);
  const {pool}=usePool(market.market_id_hex);
  const isYes=side==="YES";
  const color=isYes?"var(--green)":"var(--red)";
  const prediction=parseFloat(amount)||0,cur=isYes?pool.yes:pool.no,tot=pool.yes+pool.no;
  const ns=cur+prediction*1e6,nt=tot+prediction*1e6;
  const est=ns>0?((prediction*1e6/ns)*nt/1e6*0.99).toFixed(2):prediction.toFixed(2);
  const mult=ns>0?((nt/ns)*0.99).toFixed(2):"∞";
  const max=wallet.usdcBalance?parseFloat(wallet.usdcBalance):0;

  const submit=async()=>{
    if(!wallet.account){wallet.connect();return;}
    if(!wallet.chainOk){await wallet.switchToArc();return;}
    try{setStep("approving");const h=await wallet.placeBet(market.market_id_hex,isYes,parseFloat(amount));setTxHash(h);setStep("done");onSuccess?.();}
    catch(e){console.error(e);setStep("error");}
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()} style={{borderColor:isYes?"rgba(0,200,100,0.2)":"rgba(255,80,80,0.2)"}}>
        <div className="modal-header">
          <div>
            <div className="label-xs" style={{marginBottom:4}}>Place Prediction · {market.pair}</div>
            <div className="modal-side" style={{color}}>{isYes?"▲ YES":"▼ NO"}</div>
          </div>
          <button onClick={onClose} className="btn-close">✕</button>
        </div>
        <div className="modal-question">{market.question}</div>
        <div className="modal-amount-header">
          <span className="label-xs">Amount (USDC)</span>
          {wallet.usdcBalance!==null&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:"var(--text-dim)"}}>Bal: <span className="mono" style={{color:"var(--amber)"}}>${wallet.usdcBalance}</span></span>
              {max>0&&<button onClick={()=>setAmount(String(Math.floor(max)))} className="btn-max">MAX</button>}
            </div>
          )}
        </div>
        <input type="number" value={amount} min="1" step="1" onChange={e=>setAmount(e.target.value)} className="amount-input" style={{borderColor:`${color}55`}}/>
        <div className="quick-amounts">
          {["1","5","10","50"].map(v=>(
            <button key={v} onClick={()=>setAmount(v)} className="btn-quick" style={{background:amount===v?`${color}18`:"transparent",borderColor:amount===v?color:"var(--border)",color:amount===v?color:"var(--text-dim)",fontWeight:amount===v?700:400}}>{v}</button>
          ))}
        </div>
        <div className="modal-stats">
          <div className="stat-box">
            <div className="label-xs" style={{marginBottom:6}}>Multiplier</div>
            <div className="mono" style={{fontSize:26,color,fontWeight:700,lineHeight:1}}>{mult}x</div>
          </div>
          <div className="stat-box">
            <div className="label-xs" style={{marginBottom:6}}>Est. Payout</div>
            <div className="mono" style={{fontSize:26,color:"var(--amber)",fontWeight:700,lineHeight:1}}>${est}</div>
          </div>
        </div>
        {step==="done"&&txHash&&(
          <div className="tx-success">
            <div style={{color:"var(--green)",fontWeight:700,marginBottom:6}}>✓ Prediction placed on Arc Testnet</div>
            <div style={{display:"flex",gap:12,justifyContent:"center"}}>
              <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer" className="tx-link">View on Arcscan ↗</a>
              <button onClick={()=>shareOnX(market,side,amount)} className="btn-share">Share 𝕏</button>
            </div>
          </div>
        )}
        {step==="error"&&(<div className="tx-error">Transaction failed. Please try again.</div>)}
        <button onClick={submit} disabled={step==="approving"} className="btn-prediction" style={{background:step==="done"?"transparent":color,color:step==="done"?color:"#0a0a0a",border:step==="done"?`1px solid ${color}`:"none",opacity:step==="approving"?0.6:1}}>
          {!wallet.account?"Connect Wallet":!wallet.chainOk?"Switch to Arc":step==="approving"?"Confirming…":step==="done"?"✓ Done":`Prediction ${side} →`}
        </button>
        <div className="modal-footnote">USDC · Arc Testnet · ~$0.01 gas</div>
      </div>
    </div>,
    document.body
  );
}

// ── StatCard ──────────────────────────────────────────────────
function StatCard({label,value,accent}){
  return(
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono" style={{color:accent||"var(--text)"}}>{value}</div>
    </div>
  );
}

// ── MarketCard ────────────────────────────────────────────────
function MarketCard({market,wallet,onRefresh}){
  const [prediction,setBet]=useState(null);
  const {pool,refresh}=usePool(market.market_id_hex);
  const tot=pool.yes+pool.no,yp=tot>0?((pool.yes/tot)*100).toFixed(0):50,np=tot>0?((pool.no/tot)*100).toFixed(0):50;
  const tvl=(tot/1e6).toFixed(2),ym=calcMult(pool.yes,tot),nm=calcMult(pool.no,tot);
  const res=market.resolved===1,exp=!res&&market.expiry_ts-Math.floor(Date.now()/1000)<=0;
  const oc=market.outcome,occ=oc==="YES"?"var(--green)":oc==="NO"?"var(--red)":"var(--text-dim)";

  return(<>
    {prediction&&<BetModal market={market} side={prediction} wallet={wallet} onClose={()=>setBet(null)} onSuccess={()=>{setBet(null);setTimeout(()=>{refresh();onRefresh();},2000);}}/>}
    <div className={`market-card ${res?"resolved":exp?"expired":"active"}`}>
      <div className="card-meta">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {!res&&!exp&&<LiveDot/>}
          {res?(
            <span className="badge" style={{background:`${occ}18`,color:occ,borderColor:`${occ}44`}}>{oc||"Resolved"}</span>
          ):exp?(
            <span className="badge" style={{background:"rgba(180,120,0,0.12)",color:"#c8941a",borderColor:"rgba(180,120,0,0.3)"}}>Pending</span>
          ):(
            <span className="badge" style={{background:"rgba(0,180,100,0.1)",color:"var(--green)",borderColor:"rgba(0,180,100,0.25)"}}>⏱ {timeLeft(market.expiry_ts)}</span>
          )}
          <span className="mono" style={{fontSize:10,color:"var(--text-dim)"}}>{market.pair}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span className="tvl-badge">TVL <span className="mono" style={{color:"var(--amber)"}}>${tvl}</span></span>
          <button onClick={()=>shareMarket(market)} className="btn-share-inline">𝕏</button>
        </div>
      </div>
      <div className="market-question">{market.question}</div>
      <div className="pool-section">
        <div className="pool-bar">
          <div className="pool-bar-yes" style={{width:`${yp}%`}}/>
          <div className="pool-bar-no" style={{flex:1}}/>
        </div>
        <div className="pool-labels">
          <div className="pool-side-yes">
            <span className="pool-pct">YES {yp}%</span>
            {ym&&<span className="pool-mult mono">{ym}x</span>}
            <span className="pool-amt mono">${fmtU(pool.yes)}</span>
          </div>
          <div className="pool-side-no">
            <span className="pool-amt mono">${fmtU(pool.no)}</span>
            {nm&&<span className="pool-mult mono" style={{color:"var(--red-dim)"}}>{nm}x</span>}
            <span className="pool-pct" style={{color:"var(--red)"}}>NO {np}%</span>
          </div>
        </div>
      </div>
      {!res&&!exp&&(
        <div className="prediction-buttons">
          <button onClick={()=>setBet("YES")} className="btn-yes">▲ YES {ym?`${ym}x`:""}</button>
          <button onClick={()=>setBet("NO")} className="btn-no">▼ NO {nm?`${nm}x`:""}</button>
        </div>
      )}
      <div className="card-footer">
        <span>Target: <span className="mono" style={{color:"var(--text-secondary)"}}>{fmtTarget(market)}</span></span>
        <span style={{color:"var(--text-dim)"}}>{ago(market.created_at)}</span>
        {market.tx_hash&&(
          <a href={`https://testnet.arcscan.app/tx/${market.tx_hash}`} target="_blank" rel="noreferrer" className="arcscan-link">Arcscan ↗</a>
        )}
      </div>
    </div>
  </>);
}

// ── PositionCard ──────────────────────────────────────────────
function PositionCard({position,wallet,onClaimed}){
  const [claiming,setClaiming]=useState(false);
  const [claimTx,setClaimTx]=useState(null);
  const [claimErr,setClaimErr]=useState(null);
  const {market:m,side,amt,potentialPayout,claimed:ac}=position;
  const color=side==="YES"?"var(--green)":"var(--red)";
  const res=m.resolved===1,won=res&&m.outcome===side,lost=res&&m.outcome!==side&&m.outcome!=="VOID",voided=res&&m.outcome==="VOID";
  const canClaim=res&&!ac&&!claimTx&&(won||voided);
  const statusColor=won?"var(--green)":lost?"var(--red)":voided?"var(--text-muted)":"var(--amber)";
  const statusText=won?"✓ Won":lost?"✕ Lost":voided?"↩ Void":"Open";
  const handleClaim=async()=>{if(!wallet.account){wallet.connect();return;}if(!wallet.chainOk){await wallet.switchToArc();return;}setClaiming(true);setClaimErr(null);try{const h=await wallet.claimWinnings(m.market_id_hex);setClaimTx(h);onClaimed?.();}catch(e){console.error(e);setClaimErr(e?.reason||"Failed.");}finally{setClaiming(false);}};
  return(
    <div className="position-card" style={{borderColor:canClaim?(won?"rgba(0,200,100,0.25)":"rgba(150,150,150,0.25)"):lost?"rgba(255,80,80,0.15)":"var(--border)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span className="badge" style={{background:`${color}18`,color,borderColor:`${color}33`}}>{side}</span>
        <span style={{fontSize:13,fontWeight:700,color:statusColor}}>{statusText}</span>
      </div>
      <div className="position-question">{m.question}</div>
      <div className="position-amounts">
        <span>Staked: <span className="mono" style={{color:"var(--text-secondary)"}}>${(amt/1e6).toFixed(2)}</span></span>
        {!res&&<span>Potential: <span className="mono" style={{color:"var(--amber)"}}>${potentialPayout.toFixed(2)}</span></span>}
        {won&&<span>Payout: <span className="mono" style={{color:"var(--green)",fontWeight:700}}>${potentialPayout.toFixed(2)}</span></span>}
        {voided&&<span>Refund: <span className="mono" style={{color:"var(--text-muted)"}}>${(amt/1e6).toFixed(2)}</span></span>}
      </div>
      {canClaim&&(
        <button onClick={handleClaim} disabled={claiming} className="btn-claim" style={{background:won?"rgba(0,200,100,0.12)":"rgba(150,150,150,0.1)",borderColor:won?"rgba(0,200,100,0.4)":"rgba(150,150,150,0.3)",color:won?"var(--green)":"var(--text-muted)"}}>
          {claiming?"Claiming…":won?`Claim $${potentialPayout.toFixed(2)} USDC`:`Claim $${(amt/1e6).toFixed(2)} USDC`}
        </button>
      )}
      {ac&&res&&<div style={{textAlign:"center",fontSize:11,color:"var(--text-dim)",paddingTop:6}}>✓ Claimed</div>}
      {claimTx&&(
        <div className="tx-success" style={{marginTop:10}}>
          <div style={{color:"var(--green)",fontWeight:700,marginBottom:4}}>{won?"Claimed!":"Refunded!"}</div>
          <a href={`https://testnet.arcscan.app/tx/${claimTx}`} target="_blank" rel="noreferrer" className="tx-link">View on Arcscan ↗</a>
        </div>
      )}
      {claimErr&&<div style={{color:"var(--red)",fontSize:11,marginTop:8,textAlign:"center"}}>{claimErr}</div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:8,borderTop:"1px solid var(--border-subtle)"}}>
        <span style={{fontSize:10,color:"var(--text-dim)",fontFamily:"'IBM Plex Mono',monospace"}}>{m.pair}</span>
        <span style={{fontSize:10,color:"var(--text-dim)"}}>{res?"Settled":"Expires"}·{new Date(m.expiry_ts*1000).toLocaleString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
      </div>
    </div>
  );
}

// ── MyBets ────────────────────────────────────────────────────
function MyBets({wallet,markets}){
  const [positions,setPositions]=useState([]);
  const [init,setInit]=useState(true);
  const [totals,setTotals]=useState({staked:0,won:0,lost:0,open:0,unclaimed:0});
  const [posTab,setPosTab]=useState("active");
  const [claimingAll,setClaimingAll]=useState(false);
  const running=useRef(false);

  const load=useCallback(async()=>{
    if(!wallet.account||!markets.length)return;
    if(running.current)return;
    running.current=true;
    try{
      // Scan all markets — active first, then resolved
      const relevant=[
        ...markets.filter(m=>!m.resolved),           // all active
        ...markets.filter(m=>m.resolved).slice(0,100) // last 100 resolved
      ];
      const res=await loadUserPositions(wallet.account,relevant);
      let staked=0,won=0,lost=0,open=0,unclaimed=0;
      for(const p of res){const{market:m,side,amt,potentialPayout,claimed}=p;staked+=amt/1e6;if(m.resolved&&m.outcome===side){won+=potentialPayout;if(!claimed)unclaimed+=potentialPayout;}else if(m.resolved&&m.outcome==="VOID"){if(!claimed)unclaimed+=amt/1e6;}else if(m.resolved&&m.outcome!==side){lost+=amt/1e6;}else{open+=amt/1e6;}}
      setPositions(res);setTotals({staked,won,lost,open,unclaimed});
    }catch(e){console.error(e);}
    finally{setInit(false);running.current=false;}
  },[wallet.account,markets]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{const t=setInterval(load,30000);return()=>clearInterval(t);},[load]);

  const claimAll=async()=>{
    if(!wallet.account){wallet.connect();return;}
    if(!wallet.chainOk){await wallet.switchToArc();return;}
    setClaimingAll(true);
    const claimable=positions.filter(p=>p.market.resolved&&!p.claimed&&(p.market.outcome===p.side||p.market.outcome==="VOID"));
    // Process one at a time — each needs its own signature, stop on user rejection
    for(const p of claimable){
      try{
        await wallet.claimWinnings(p.market.market_id_hex);
      }catch(e){
        // If user rejected wallet signature, stop the whole loop
        if(e?.code===4001||e?.code==="ACTION_REJECTED"){break;}
        console.error(e);
      }
    }
    setClaimingAll(false);
    await load();
    wallet.fetchBalance?.(wallet.account);
  };

  const activePos=positions.filter(p=>!p.market.resolved);
  const closedPos=positions.filter(p=>p.market.resolved);
  const displayPos=posTab==="active"?activePos:closedPos;

  if(!wallet.account)return(
    <div className="empty-state">
      <div className="empty-icon">◈</div>
      <div className="empty-title">Connect your wallet</div>
      <div className="empty-sub">to view your positions</div>
      <button onClick={wallet.connect} className="btn-connect" style={{marginTop:20}}>Connect Wallet</button>
    </div>
  );
  if(init)return(
    <div className="empty-state">
      <div style={{color:"var(--text-dim)",fontSize:13,marginBottom:8}}>Loading positions…</div>
      <div style={{fontSize:11,color:"var(--text-dim)",opacity:0.6}}>Scanning on-chain data</div>
    </div>
  );

  return(<div>
    <div className="bets-summary">
      {[{l:"Staked",v:`$${totals.staked.toFixed(2)}`,c:"var(--text)"},{l:"Won",v:`$${totals.won.toFixed(2)}`,c:"var(--green)"},{l:"Lost",v:`$${totals.lost.toFixed(2)}`,c:"var(--red)"},{l:"Open",v:`$${totals.open.toFixed(2)}`,c:"var(--amber)"}].map(({l,v,c})=>(
        <div key={l} className="summary-tile">
          <div className="label-xs">{l}</div>
          <div className="mono" style={{fontSize:16,color:c,fontWeight:700,marginTop:4}}>{v}</div>
        </div>
      ))}
    </div>
    {totals.unclaimed>0&&(
      <div className="unclaimed-banner">
        <div>
          <div style={{color:"var(--green)",fontWeight:700,fontSize:13,marginBottom:2}}>Funds ready to claim</div>
          <div style={{fontSize:11,color:"var(--text-dim)"}}>Tap Claim on the positions below</div>
        </div>
        <div className="mono" style={{fontSize:22,color:"var(--green)",fontWeight:700}}>${totals.unclaimed.toFixed(2)}</div>
      </div>
    )}
    <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:14,borderBottom:"1px solid var(--border)"}}>
      {[["active",`Active (${activePos.length})`],["closed",`Closed (${closedPos.length})`]].map(([key,label])=>(
        <button key={key} onClick={()=>setPosTab(key)} style={{background:"none",border:"none",cursor:"pointer",padding:"10px 16px",fontSize:13,fontFamily:"'Outfit',sans-serif",fontWeight:posTab===key?700:500,color:posTab===key?"var(--text)":"var(--text-muted)",borderBottom:posTab===key?"2px solid var(--amber)":"2px solid transparent",marginBottom:-1,transition:"all 0.15s"}}>
          {label}
        </button>
      ))}
      {totals.unclaimed>0&&(
        <button onClick={claimAll} disabled={claimingAll} style={{marginLeft:"auto",background:"rgba(0,200,120,0.1)",border:"1px solid rgba(0,200,120,0.3)",color:"var(--green)",borderRadius:8,padding:"6px 14px",fontSize:12,fontFamily:"'Outfit',sans-serif",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",opacity:claimingAll?0.6:1,transition:"opacity 0.15s"}}>
          {claimingAll?"Claiming…":"Claim All 💰"}
        </button>
      )}
    </div>
    {displayPos.length===0
      ?<div className="empty-state"><div style={{color:"var(--text-dim)",fontSize:14}}>No {posTab} positions</div></div>
      :displayPos.map((p,i)=><PositionCard key={i} position={p} wallet={wallet} onClaimed={()=>{load();wallet.fetchBalance?.(wallet.account);}}/>)
    }
  </div>);
}

// ── AgentFeed ─────────────────────────────────────────────────
function AgentFeed(){
  const [feed,setFeed]=useState([]);
  const [loading,setLoading]=useState(true);
  const [feedFilter,setFeedFilter]=useState("all");
  const load=useCallback(async()=>{try{const d=await fetch(`${API}/agent/activity?limit=25`).then(x=>x.json());setFeed(d);}catch{}finally{setLoading(false);};},[]);
  useEffect(()=>{load();const t=setInterval(load,15000);return()=>clearInterval(t);},[load]);

  const filteredFeed=feedFilter==="all"?feed:feed.filter(item=>
    feedFilter==="resolved"?(item.action==="resolved"&&item.resolved):
    feedFilter==="market"?(item.action==="create_market"||item.action==="created"):
    item.action==="hold"
  );

  if(loading)return<div className="empty-state"><div style={{color:"var(--text-dim)",fontSize:13}}>Loading feed…</div></div>;
  return(
    <div className="feed-card">
      <div className="feed-header">
        <LiveDot color="var(--amber)"/>
        <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>Agent Activity</span>
        <span style={{fontSize:10,color:"var(--text-dim)",marginLeft:"auto"}}>Live · 15s</span>
      </div>
      <div style={{display:"flex",gap:0,padding:"0 12px",borderBottom:"1px solid var(--border)",overflowX:"auto"}}>
        {[["all","All"],["resolved","Resolved"],["market","Created"],["hold","Hold"]].map(([key,label])=>(
          <button key={key} onClick={()=>setFeedFilter(key)} style={{background:"none",border:"none",cursor:"pointer",padding:"8px 12px",fontSize:11,fontFamily:"'Outfit',sans-serif",fontWeight:feedFilter===key?700:500,whiteSpace:"nowrap",color:feedFilter===key?"var(--text)":"var(--text-muted)",borderBottom:feedFilter===key?"2px solid var(--amber)":"2px solid transparent",marginBottom:-1,transition:"all 0.15s"}}>
            {label}
          </button>
        ))}
        <span style={{marginLeft:"auto",fontSize:10,color:"var(--text-dim)",display:"flex",alignItems:"center",paddingRight:4}}>{filteredFeed.length} events</span>
      </div>
      <div className="feed-list">
        {filteredFeed.length===0
          ?<div style={{color:"var(--text-dim)",fontSize:13,padding:"24px",textAlign:"center"}}>No activity</div>
          :filteredFeed.map((item,i)=>{
            const isRes=item.action==="resolved"&&item.resolved;
            const isCreate=item.action==="create_market"||item.action==="created";
            const isHold=item.action==="hold";
            const color=isRes?(item.outcome==="YES"?"var(--green)":item.outcome==="NO"?"var(--red)":"var(--text-muted)"):isCreate?"var(--green)":isHold?"var(--text-dim)":"var(--text-muted)";
            return(
              <div key={i} className={`feed-item ${i===0?"feed-item-latest":""}`}>
                <span style={{fontSize:16,flexShrink:0,marginTop:1}}>{item.icon||"●"}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                    <span className="badge" style={{background:`${color}15`,color,borderColor:`${color}30`}}>{item.label||item.action}</span>
                    <span className="mono" style={{fontSize:10,color:"var(--text-dim)"}}>{item.pair}</span>
                    {item.confidence>0&&!isHold&&<span style={{fontSize:10,color:"var(--text-dim)",marginLeft:"auto"}}>signal: {item.confidence}%</span>}
                    {item.tx_hash&&<a href={`https://testnet.arcscan.app/tx/${item.tx_hash}`} target="_blank" rel="noreferrer" className="arcscan-link">↗</a>}
                  </div>
                  <div className="feed-msg" style={{color:isRes&&item.outcome==="YES"?"rgba(0,200,100,0.6)":isRes&&item.outcome==="NO"?"rgba(255,80,80,0.6)":"var(--text-dim)"}}>
                    {item.message||item.reasoning||"—"}
                  </div>
                  <div style={{fontSize:10,color:"var(--text-dim)",marginTop:4,opacity:0.6}}>{ago(item.created_at)}</div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────
export default function App(){
  const [stats,setStats]=useState(null);
  const [markets,setMarkets]=useState([]);
  const [latest,setLatest]=useState(null);
  const [tab,setTab]=useState("markets");
  const wallet=useWallet();

  const load=useCallback(async()=>{try{const[s,m,lr]=await Promise.all([fetch(`${API}/stats`).then(x=>x.json()),fetch(`${API}/markets?limit=2000`).then(x=>x.json()),fetch(`${API}/rates/latest`).then(x=>x.json())]);setStats(s);setMarkets(m);setLatest(lr);}catch(e){console.error(e);}},[]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{const t=setInterval(load,15000);return()=>clearInterval(t);},[load]);

  const active=markets.filter(m=>!m.resolved);

  return(<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Outfit:wght@400;500;600;700;800&display=swap');

      :root {
        --bg: #0d0d0f;
        --bg-card: #131316;
        --bg-hover: #17171b;
        --border: #1e1e24;
        --border-subtle: #19191f;
        --text: #e8e8f0;
        --text-secondary: #a0a0b8;
        --text-muted: #606078;
        --text-dim: #3a3a50;
        --green: #00c878;
        --green-dim: rgba(0,200,120,0.6);
        --red: #f04040;
        --red-dim: rgba(240,64,64,0.6);
        --amber: #f0a030;
        --blue: #4aa8f0;
        --amber-dim: rgba(240,160,48,0.6);
      }

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { background: var(--bg); color: var(--text); font-family: 'Outfit', sans-serif; min-height: 100vh; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
      .mono { font-family: 'IBM Plex Mono', monospace; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #2a2a38; border-radius: 2px; }
      input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }

      @keyframes ripple { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(3); opacity: 0; } }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes slideIn { from { opacity: 0; transform: scale(0.97) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

      .fade { animation: fadeUp 0.35s ease both; }

      /* ── Ticker ── */
      .ticker-bar {
        display: flex;
        align-items: center;
        background: #0a0a0c;
        border-bottom: 1px solid var(--border);
        height: 32px;
        overflow: hidden;
      }
      .ticker-label {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 8px;
        font-weight: 800;
        letter-spacing: 2px;
        color: var(--green);
        background: rgba(0,200,120,0.08);
        border-right: 1px solid rgba(0,200,120,0.15);
        padding: 0 12px;
        height: 100%;
        text-transform: uppercase;
      }
      .ticker-track-wrap {
        flex: 1;
        overflow: hidden;
        position: relative;
      }
      .ticker-track-wrap::before,
      .ticker-track-wrap::after {
        content: '';
        position: absolute;
        top: 0; bottom: 0;
        width: 32px;
        z-index: 2;
        pointer-events: none;
      }
      .ticker-track-wrap::before { left: 0; background: linear-gradient(to right, #0a0a0c, transparent); }
      .ticker-track-wrap::after  { right: 0; background: linear-gradient(to left, #0a0a0c, transparent); }
      .ticker-track {
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
        width: max-content;
        animation: ticker-scroll 10s linear infinite;
      }
      .ticker-track:hover { animation-play-state: paused; }
      .ticker-item {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 0 22px;
        border-right: 1px solid var(--border);
        font-size: 11px;
        height: 32px;
      }
      .ticker-pair { color: var(--text-muted); font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.5px; }
      .ticker-sep  { color: var(--text-dim); font-size: 9px; }
      .ticker-rate { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; }

      /* ── Site header ── */
      .site-header {
        background: rgba(13,13,15,0.92);
        border-bottom: 1px solid var(--border);
        position: sticky; top: 0; z-index: 10;
        backdrop-filter: blur(12px);
      }
      .header-inner {
        max-width: 900px; margin: 0 auto;
        padding: 10px 16px;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
      }
      .logo-block { flex-shrink: 0; }
      .logo-text { font-size: 21px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
      .logo-sub { font-size: 9px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; margin-top: 3px; }

      /* ── Wallet ── */
      .btn-connect { background: var(--amber); border: none; color: #0a0a0a; border-radius: 8px; padding: 9px 16px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: opacity 0.15s; }
      .btn-connect:hover { opacity: 0.85; }
      .btn-switch { background: rgba(240,64,64,0.1); border: 1px solid rgba(240,64,64,0.3); color: var(--red); border-radius: 7px; padding: 5px 10px; font-size: 10px; cursor: pointer; font-family: 'Outfit', sans-serif; white-space: nowrap; transition: opacity 0.15s; }
      .wallet-pill { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; display: flex; align-items: center; gap: 8px; }

      /* ── Stats ── */
      .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 12px; flex: 1; min-width: 70px; text-align: center; transition: border-color 0.2s; }
      .stat-card:hover { border-color: #2a2a38; }
      .stat-label { font-size: 9px; color: var(--text-dim); letter-spacing: 1.8px; text-transform: uppercase; margin-bottom: 8px; }
      .stat-value { font-size: 30px; font-weight: 700; line-height: 1; }

      /* ── Tabs ── */
      .tab-bar { display: flex; margin-bottom: 20px; border-bottom: 1px solid var(--border); gap: 0; }
      .tab-btn { background: none; border: none; cursor: pointer; padding: 12px 18px; font-size: 13px; font-family: 'Outfit', sans-serif; font-weight: 500; color: var(--text-muted); border-bottom: 2px solid transparent; transition: all 0.15s; margin-bottom: -1px; }
      .tab-btn:hover { color: var(--text-secondary); }
      .tab-btn.active { color: var(--text); border-bottom-color: var(--amber); font-weight: 700; }

      /* ── Market card ── */
      .market-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; margin-bottom: 12px; transition: border-color 0.2s, box-shadow 0.2s; animation: fadeUp 0.3s ease both; }
      .market-card.active { border-color: rgba(0,200,120,0.15); box-shadow: 0 2px 24px rgba(0,200,120,0.05); }
      .market-card.expired { border-color: rgba(180,120,0,0.2); }
      .market-card.resolved { border-color: var(--border-subtle); }
      .card-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 8px; flex-wrap: wrap; }
      .tvl-badge { font-size: 11px; color: var(--text-muted); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; }
      .btn-share-inline { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px; padding: 3px 8px; font-size: 10px; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
      .btn-share-inline:hover { border-color: var(--text-muted); color: var(--text-muted); }
      .market-question { font-size: 15px; color: var(--text); line-height: 1.6; font-weight: 600; margin-bottom: 18px; }

      /* Pool bar */
      .pool-section { margin-bottom: 18px; }
      .pool-bar { display: flex; border-radius: 6px; overflow: hidden; height: 6px; background: var(--border); margin-bottom: 10px; gap: 1px; }
      .pool-bar-yes { background: var(--green); transition: width 0.5s ease; border-radius: 6px 0 0 6px; }
      .pool-bar-no  { background: var(--red); flex: 1; border-radius: 0 6px 6px 0; }
      .pool-labels  { display: flex; justify-content: space-between; }
      .pool-side-yes, .pool-side-no { display: flex; align-items: baseline; gap: 6px; }
      .pool-pct  { font-size: 13px; color: var(--green); font-weight: 700; }
      .pool-mult { font-size: 11px; color: var(--green-dim); }
      .pool-amt  { font-size: 10px; color: var(--text-dim); }

      /* Prediction buttons */
      .prediction-buttons { display: flex; gap: 10px; margin-bottom: 16px; }
      .btn-yes, .btn-no { flex: 1; padding: 13px 0; border-radius: 10px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 13px; cursor: pointer; letter-spacing: 0.3px; transition: opacity 0.15s, transform 0.1s; }
      .btn-yes:hover, .btn-no:hover { opacity: 0.85; transform: translateY(-1px); }
      .btn-yes:active, .btn-no:active { transform: translateY(0); }
      .btn-yes { background: rgba(0,200,120,0.1); border: 1px solid rgba(0,200,120,0.3); color: var(--green); }
      .btn-no  { background: rgba(240,64,64,0.1);  border: 1px solid rgba(240,64,64,0.3);  color: var(--red); }
      .card-footer { display: flex; gap: 12px; font-size: 11px; color: var(--text-dim); flex-wrap: wrap; align-items: center; }
      .arcscan-link { color: var(--text-dim); text-decoration: none; margin-left: auto; transition: color 0.15s; }
      .arcscan-link:hover { color: var(--text-muted); }

      /* ── Badge ── */
      .badge { font-size: 9px; padding: 3px 9px; border-radius: 5px; border: 1px solid; letter-spacing: 1.2px; text-transform: uppercase; font-weight: 700; flex-shrink: 0; }
      .label-xs { font-size: 9px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; }

      /* ── Modal ── */
      .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(5,5,8,0.95); z-index: 9999; }
      .modal-box { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #131316; border: 1px solid; border-radius: 20px; padding: 24px; width: calc(100% - 32px); max-width: 380px; max-height: 90vh; overflow-y: auto; -webkit-overflow-scrolling: touch; z-index: 10000; animation: none; }
      .modal-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
      .modal-side { font-size: 28px; font-weight: 800; line-height: 1; font-family: 'Outfit', sans-serif; }
      .btn-close { background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; width: 32px; height: 32px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; transition: border-color 0.15s; }
      .btn-close:hover { border-color: var(--text-muted); }
      .modal-question { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 20px; }
      .modal-amount-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .amount-input { width: 100%; background: var(--bg); border: 1px solid; border-radius: 10px; padding: 14px 16px; color: var(--text); font-size: 26px; font-family: 'IBM Plex Mono', monospace; outline: none; transition: border-color 0.15s; }
      .amount-input:focus { border-color: rgba(240,160,48,0.5) !important; }
      .quick-amounts { display: flex; gap: 6px; margin-top: 10px; margin-bottom: 16px; }
      .btn-quick { flex: 1; background: transparent; border: 1px solid; border-radius: 8px; padding: 8px 0; font-size: 12px; cursor: pointer; font-family: 'Outfit', sans-serif; transition: all 0.15s; }
      .btn-max { background: rgba(240,160,48,0.1); border: 1px solid rgba(240,160,48,0.25); color: var(--amber); border-radius: 5px; padding: 2px 8px; font-size: 9px; cursor: pointer; font-weight: 700; font-family: 'Outfit', sans-serif; }
      .modal-stats { display: flex; gap: 8px; margin-bottom: 16px; }
      .stat-box { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; text-align: center; }
      .btn-prediction { width: 100%; padding: 15px 0; border-radius: 12px; font-weight: 700; font-size: 15px; font-family: 'Outfit', sans-serif; cursor: pointer; transition: all 0.2s; }
      .btn-prediction:hover { opacity: 0.88; }
      .modal-footnote { text-align: center; font-size: 10px; color: var(--text-dim); margin-top: 10px; letter-spacing: 0.5px; }
      .tx-success { text-align: center; background: rgba(0,200,120,0.08); border: 1px solid rgba(0,200,120,0.2); border-radius: 10px; padding: 12px; margin-bottom: 14px; font-size: 13px; }
      .tx-error { text-align: center; color: var(--red); font-size: 12px; margin-bottom: 14px; background: rgba(240,64,64,0.08); border: 1px solid rgba(240,64,64,0.2); border-radius: 10px; padding: 10px; }
      .tx-link { color: var(--text-muted); font-size: 11px; text-decoration: none; }
      .tx-link:hover { color: var(--text-secondary); }
      .btn-share { background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); border-radius: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer; }

      /* ── Position cards ── */
      .position-card { background: var(--bg-card); border: 1px solid; border-radius: 12px; padding: 16px; margin-bottom: 10px; transition: border-color 0.2s; }
      .position-question { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 10px; }
      .position-amounts { display: flex; gap: 14px; font-size: 12px; color: var(--text-dim); flex-wrap: wrap; margin-bottom: 12px; }
      .btn-claim { width: 100%; padding: 12px 0; border: 1px solid; border-radius: 10px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 13px; cursor: pointer; transition: opacity 0.15s; }
      .btn-claim:hover { opacity: 0.85; }

      /* ── My Bets ── */
      .bets-summary { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
      .summary-tile { flex: 1; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 10px; text-align: center; min-width: 60px; }
      .unclaimed-banner { background: rgba(0,200,120,0.06); border: 1px solid rgba(0,200,120,0.2); border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }

      /* ── Agent feed ── */
      .feed-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
      .feed-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
      .feed-list { max-height: 420px; overflow-y: auto; }
      .feed-item { display: flex; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border-subtle); align-items: flex-start; transition: background 0.15s; }
      .feed-item:hover { background: var(--bg-hover); }
      .feed-item-latest { background: rgba(255,255,255,0.02); }
      .feed-msg { font-size: 12px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

      /* ── Recent results ── */
      .results-section { margin-top: 28px; }
      .results-label { font-size: 9px; color: var(--text-dim); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
      .results-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
      .result-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 6px; transition: border-color 0.15s; }
      .result-row:hover { border-color: #2a2a38; }
      .result-question { font-size: 13px; color: var(--text-secondary); flex: 1; line-height: 1.4; }
      .result-outcome { font-size: 11px; font-weight: 700; margin-left: 14px; flex-shrink: 0; padding: 3px 10px; border-radius: 6px; }

      /* ── Empty state ── */
      .empty-state { color: var(--text-dim); padding: 60px 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .empty-icon { font-size: 32px; color: var(--text-dim); margin-bottom: 8px; }
      .empty-title { font-size: 15px; font-weight: 600; color: var(--text-muted); }
      .empty-sub { font-size: 12px; color: var(--text-dim); }

      /* ── Footer ── */
      .site-footer { margin-top: 60px; border-top: 1px solid var(--border-subtle); padding: 40px 24px 28px; background: var(--bg-deep, #0a0a0a); }
      .footer-inner { max-width: 960px; margin: 0 auto; }
      .footer-top { display: grid; grid-template-columns: 1.6fr 1fr 1.4fr; gap: 32px; margin-bottom: 32px; }
      @media (max-width: 640px) { .footer-top { grid-template-columns: 1fr; gap: 28px; } }
      .footer-logo { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: var(--text); margin-bottom: 10px; }
      .footer-logo span { color: var(--amber); }
      .footer-tagline { font-size: 12px; color: var(--text-dim); line-height: 1.65; margin: 0; }
      .footer-col { display: flex; flex-direction: column; gap: 0; }
      .footer-col-title { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 12px; }
      .footer-link { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-secondary); text-decoration: none; padding: 5px 0; transition: color 0.15s; }
      .footer-link:hover { color: var(--text); }
      .footer-link-icon { font-size: 14px; }
      .footer-contract-badge { display: flex; align-items: center; gap: 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; transition: border-color 0.15s; }
      .footer-contract-badge:hover { border-color: var(--green); }
      .footer-contract-network { font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 3px; }
      .footer-contract-addr { font-size: 12px; color: var(--text-secondary); font-family: 'IBM Plex Mono', monospace; }
      .footer-bottom { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 20px; border-top: 1px solid var(--border-subtle); }
      .footer-copy { font-size: 11px; color: var(--text-dim); }
      .footer-powered { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-dim); }

      button { font-family: 'Outfit', sans-serif; }
      .btn-circle:hover { opacity: 0.85; }
    `}</style>

    <Header latest={latest} wallet={wallet}/>

    {wallet.error&&(
      <div style={{background:"rgba(240,64,64,0.08)",borderBottom:"1px solid rgba(240,64,64,0.2)",padding:"8px 20px",fontSize:12,color:"var(--red)",textAlign:"center"}}>
        {wallet.error}
      </div>
    )}

    <div style={{maxWidth:900,margin:"0 auto",padding:"24px 14px"}}>

      {stats&&(
        <div style={{display:"flex",gap:10,marginBottom:28}} className="fade">
          <StatCard label="Active"    value={stats.markets.active}        accent="var(--green)"/>
          <StatCard label="Resolved"  value={stats.markets.resolved}      accent="var(--blue)"/>
          <StatCard label="Decisions" value={stats.agent.total_decisions} accent="var(--text-secondary)"/>
          <StatCard label="Created"   value={stats.agent.markets_created} accent="var(--amber)"/>
        </div>
      )}

      <div className="tab-bar">
        {[
          ["markets", `Markets${active.length?` (${active.length})`:""}`],
          ["mybets",  "Positions"],
          ["feed",    "Agent Feed"],
        ].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} className={`tab-btn ${tab===key?"active":""}`}>
            {label}
          </button>
        ))}
      </div>

      {tab==="markets"&&(
        <div className="fade">
          {active.length===0
            ?(
              <div className="empty-state">
                <div className="empty-icon">◎</div>
                <div className="empty-title">Agent monitoring markets</div>
                <div className="empty-sub">Next market opening soon</div>
              </div>
            )
            :active.map(m=><MarketCard key={m.id} market={m} wallet={wallet} onRefresh={load}/>)
          }
          {markets.filter(m=>m.resolved).length>0&&(
            <div className="results-section">
              <div className="results-label">Recent Results</div>
              {markets.filter(m=>m.resolved).slice(0,3).map(m=>{
                const c=m.outcome==="YES"?"var(--green)":m.outcome==="NO"?"var(--red)":"var(--text-muted)";
                return(
                  <div key={m.id} className="result-row">
                    <span className="result-question">{m.question}</span>
                    <span className="result-outcome" style={{color:c,background:`${c}15`}}>{m.outcome||"VOID"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab==="mybets"&&<div className="fade"><MyBets wallet={wallet} markets={markets}/></div>}
      {tab==="feed"&&<div className="fade"><AgentFeed/></div>}

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="footer-logo">Agora<span>FX</span></div>
              <p className="footer-tagline">
                AI-powered FX prediction markets on Arc Network.<br/>
                Predict African currency rates, earn USDC.
              </p>
            </div>
            <div className="footer-col">
              <div className="footer-col-title">Explore</div>
              <a href="https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5" target="_blank" rel="noreferrer" className="footer-link">
                <span className="footer-link-icon">📄</span> Smart Contract
              </a>
              <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="footer-link">
                <span className="footer-link-icon">🔍</span> Arc Explorer
              </a>
            </div>
            <div className="footer-col">
              <div className="footer-col-title">Deployed Contract</div>
              <a href="https://testnet.arcscan.app/address/0x5Ddf555F6d360203d02Fe1D9be49b13981A732b5" target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>
                <div className="footer-contract-badge">
                  <LiveDot color="var(--green)"/>
                  <div>
                    <div className="footer-contract-network">Arc Testnet</div>
                    <div className="footer-contract-addr">0x5Ddf555F6d…732B5</div>
                  </div>
                </div>
              </a>
            </div>
          </div>
          <div className="footer-bottom">
            <span className="footer-copy">© 2026 AgoraFX · Built on Arc Network for Agora Agent Hackathon</span>
            <div className="footer-powered">
              <LiveDot color="var(--green)"/>
              <span>Arc Testnet · USDC · Powered by AI Agent</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  </>);
}