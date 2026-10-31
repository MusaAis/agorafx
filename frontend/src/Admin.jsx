import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { loadAdminStats, getProvider, CONTRACT_ADDRESS } from "./onchain.js";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "https://api.kudiarc.xyz";
const PUBLIC_RPC   = "https://rpc.testnet.arc.network";
const ADMIN_WALLET = "0xca3b6cc345e82f063ef61d534caaa36c20c2b061";
const ARC_CHAIN    = {
  chainId:"0x4cef52",chainName:"Arc Testnet",
  nativeCurrency:{name:"USDC",symbol:"USDC",decimals:6},
  rpcUrls:[PUBLIC_RPC],blockExplorerUrls:["https://testnet.arcscan.app"],
};
const MARKET_ABI = [
  "function accumulatedFees() view returns (uint256)",
  "function withdrawFees() external",
];

const ago=(ts)=>{const s=Math.floor((Date.now()-new Date(ts+"Z").getTime())/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ago`;return new Date(ts+"Z").toLocaleDateString("en-US",{month:"short",day:"numeric"});};
const short=(a)=>a?`${a.slice(0,6)}…${a.slice(-4)}`:"";
const timeLeft=(e)=>{const s=e-Math.floor(Date.now()/1000);if(s<=0)return"Expired";if(s<60)return`${s}s`;if(s<3600)return`${Math.floor(s/60)}m ${s%60}s`;return`${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;};

// ── Operator token for protected API routes ──────────────────────────────────
const ADMIN_KEY = "agorafx_admin_token";
let adminToken = "";

const adminHeaders = () => {
  let t = adminToken;
  if (!t) { try { t = sessionStorage.getItem(ADMIN_KEY) || ""; } catch { t = ""; } }
  return t ? { "X-Admin-Token": t } : {};
};

async function adminFetch(url, opts = {}) {
  const run = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...adminHeaders() } });
  const res = await run();
  if (res.status !== 401) return res;
  const t = window.prompt("Admin token");
  if (!t) return res;
  adminToken = t.trim();
  try { sessionStorage.setItem(ADMIN_KEY, adminToken); } catch { /* storage unavailable */ }
  return run();
}

// ── Auth ──────────────────────────────────────────────────────────
function useAdminAuth(){
  const [account,setAccount]=useState(null);
  const [loading,setLoading]=useState(false);
  const [chainOk,setChainOk]=useState(false);
  const isAdmin=account?.toLowerCase()===ADMIN_WALLET.toLowerCase();
  const checkChain=async()=>{if(!window.ethereum)return;const id=await window.ethereum.request({method:"eth_chainId"});setChainOk(id.toLowerCase()===ARC_CHAIN.chainId.toLowerCase());};
  const connect=async()=>{if(!window.ethereum)return;setLoading(true);try{const a=await window.ethereum.request({method:"eth_requestAccounts"});setAccount(a[0]);await checkChain();}finally{setLoading(false);}};
  const switchToArc=async()=>{try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:ARC_CHAIN.chainId}]});setChainOk(true);}catch(e){if(e.code===4902){try{await window.ethereum.request({method:"wallet_addEthereumChain",params:[ARC_CHAIN]});setChainOk(true);}catch{}}}};
  useEffect(()=>{if(!window.ethereum)return;window.ethereum.request({method:"eth_accounts"}).then(a=>{if(a[0]){setAccount(a[0]);checkChain();}});window.ethereum.on("accountsChanged",a=>setAccount(a[0]||null));window.ethereum.on("chainChanged",()=>checkChain());},[]);
  return{account,isAdmin,loading,chainOk,connect,switchToArc};
}

// ── Primitives ────────────────────────────────────────────────────
const Badge=({label,color="#555",bg})=>(<span style={{fontSize:9,padding:"2px 8px",borderRadius:4,letterSpacing:1,textTransform:"uppercase",fontWeight:700,color,background:bg||`${color}18`,border:`1px solid ${color}33`}}>{label}</span>);

const StatBox=({label,value,sub,accent="#fff"})=>(
  <div style={{background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:12,padding:"16px 14px",flex:1,minWidth:110}}>
    <div style={{fontSize:9,color:"#444",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{label}</div>
    <div style={{fontSize:22,fontFamily:"'DM Mono',monospace",color:accent,fontWeight:700,lineHeight:1}}>{value==="…"?<span style={{color:"#222"}}>—</span>:value}</div>
    {sub&&<div style={{fontSize:10,color:"#3a3a3a",marginTop:4}}>{sub}</div>}
  </div>
);

const Spinner=()=>(<div style={{width:13,height:13,border:"2px solid #1e1e1e",borderTop:"2px solid #e8ff87",borderRadius:"50%",animation:"spin .7s linear infinite",display:"inline-block"}}/>);

const ChartCard=({title,sub,children})=>(
  <div style={{background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:16,padding:"18px 16px"}}>
    <div style={{marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,color:"#ccc"}}>{title}</div>
      {sub&&<div style={{fontSize:9,color:"#333",marginTop:2,letterSpacing:1,textTransform:"uppercase"}}>{sub}</div>}
    </div>
    {children}
  </div>
);

// ── Toast ─────────────────────────────────────────────────────────
function useToast(){
  const [toasts,setToasts]=useState([]);
  const push=(msg,type="success")=>{const id=Date.now();setToasts(t=>[...t,{id,msg,type}]);setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3500);};
  return{toasts,push};
}
const ToastContainer=({toasts})=>(
  <div style={{position:"fixed",bottom:24,right:24,zIndex:999,display:"flex",flexDirection:"column",gap:8}}>
    {toasts.map(t=>(
      <div key={t.id} style={{background:t.type==="error"?"#1a0808":"#0a1a0a",border:`1px solid ${t.type==="error"?"#ff475755":"#00ff8755"}`,color:t.type==="error"?"#ff6b6b":"#00ff87",borderRadius:10,padding:"10px 16px",fontSize:13,fontFamily:"'Syne',sans-serif",fontWeight:600,animation:"fadeIn .25s ease",boxShadow:"0 8px 24px rgba(0,0,0,.5)"}}>
        {t.type==="error"?"✗":"✓"} {t.msg}
      </div>
    ))}
  </div>
);

// ── Auto Refresh Hook ─────────────────────────────────────────────
function useAutoRefresh(callback,intervalSec=30,enabled=true){
  const [countdown,setCountdown]=useState(intervalSec);
  const cbRef=useRef(callback);
  cbRef.current=callback;
  useEffect(()=>{
    if(!enabled)return;
    setCountdown(intervalSec);
    const tick=setInterval(()=>{
      setCountdown(c=>{
        if(c<=1){cbRef.current();return intervalSec;}
        return c-1;
      });
    },1000);
    return()=>clearInterval(tick);
  },[intervalSec,enabled]);
  return countdown;
}

// ══════════════════════════════════════════════════════════════════
// TAB: OVERVIEW
// ══════════════════════════════════════════════════════════════════
function Overview({stats,onChain,rates,loadAll,loading,toast,auth}){
  const tooltipStyle={contentStyle:{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:8,fontSize:11},labelStyle:{color:"#555"},itemStyle:{color:"#e8ff87"}};
  return(
    <div className="fade">
      {/* On-chain */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:9,color:"#333",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>On-Chain</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <StatBox label="Contract Balance" value={onChain?`$${onChain.contractBalance}`:"…"} sub="USDC locked" accent="#e8ff87"/>
          <StatBox label="Accumulated Fees" value={onChain?`$${onChain.accumulatedFees}`:"…"} sub="Protocol 1%" accent="#87d4ff"/>
          <StatBox label="Markets On-Chain" value={onChain?onChain.marketCount:"…"} accent="#00ff87"/>
        </div>
      </div>

      {/* Fee withdraw */}
      {onChain&&parseFloat(onChain.accumulatedFees)>0&&(
        <div style={{background:"#0a1f10",border:"1px solid #00ff8722",borderRadius:14,padding:"14px 18px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:14,color:"#00ff87",fontWeight:700}}>💰 ${onChain.accumulatedFees} fees available</div>
            <div style={{fontSize:11,color:"#3a5a3a",marginTop:2}}>Protocol fees from winning payouts</div>
          </div>
          <button onClick={async()=>{
            try{
              if(!auth.chainOk){await auth.switchToArc();return;}
              const provider=new ethers.BrowserProvider(window.ethereum);
              const signer=await provider.getSigner();
              const contract=new ethers.Contract(CONTRACT_ADDRESS,MARKET_ABI,signer);
              toast.push("Confirm in wallet…","success");
              await(await contract.withdrawFees()).wait();
              toast.push("Fees withdrawn successfully!");
              loadAll();
            }catch(e){toast.push(e?.reason||"Withdraw failed","error");}
          }} style={{background:"#00ff87",border:"none",color:"#000",borderRadius:10,padding:"10px 20px",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,cursor:"pointer"}}>
            Withdraw Fees
          </button>
        </div>
      )}

      {/* Agent stats */}
      {stats&&(
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#333",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Agent Stats</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <StatBox label="Total Markets"   value={stats.markets.total}         accent="#e8ff87"/>
            <StatBox label="Active"          value={stats.markets.active}        accent="#00ff87"/>
            <StatBox label="Resolved"        value={stats.markets.resolved}      accent="#87d4ff"/>
            <StatBox label="YES Wins"        value={stats.markets.yes_wins}      accent="#00ff87"/>
            <StatBox label="NO Wins"         value={stats.markets.no_wins}       accent="#ff4757"/>
            <StatBox label="Decisions"       value={stats.agent.total_decisions} accent="#ccc"/>
          </div>
        </div>
      )}

      {/* Rates */}
      {Object.keys(rates).length>0&&(
        <div style={{background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,color:"#555",marginBottom:12}}>Live Rates</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {Object.entries(rates).map(([pair,rateList])=>{
              const latest=rateList?.[rateList.length-1];
              if(!latest)return null;
              return(
                <div key={pair} style={{background:"#080808",borderRadius:10,padding:"10px 14px",flex:1,minWidth:100}}>
                  <div style={{fontSize:9,color:"#3a3a3a",letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>{pair.replace("USDC/","")}</div>
                  <div style={{fontSize:15,fontFamily:"'DM Mono',monospace",color:"#e8ff87",fontWeight:700}}>
                    {pair==="USDC/EURC"?Number(latest.rate).toFixed(4):Number(latest.rate).toLocaleString("en-NG",{maximumFractionDigits:0})}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: STUCK MARKETS
// ══════════════════════════════════════════════════════════════════
function StuckMarkets({toast}){
  const [stuck,setStuck]=useState([]);
  const [loading,setLoading]=useState(true);
  const [resolving,setResolving]=useState({});
  const [resolvingAll,setResolvingAll]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    try{const d=await adminFetch(`${API}/admin/stuck-markets`).then(x=>x.json());setStuck(Array.isArray(d)?d:[]);}
    catch{setStuck([]);}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{load();},[load]);

  const resolveOne=async(mid)=>{
    setResolving(r=>({...r,[mid]:true}));
    try{
      const d=await adminFetch(`${API}/admin/force-resolve/${mid}`,{method:"POST"}).then(x=>x.json());
      if(d.ok){toast.push(`Resolved: ${d.outcome}`);await load();}
      else toast.push(d.reason||"Not resolved on-chain yet","error");
    }catch{toast.push("Failed","error");}
    finally{setResolving(r=>({...r,[mid]:false}));}
  };

  const resolveAll=async()=>{
    setResolvingAll(true);
    try{
      const d=await adminFetch(`${API}/admin/force-resolve-all`,{method:"POST"}).then(x=>x.json());
      if(d.ok){toast.push(`Fixed ${d.fixed}/${d.total} markets`);await load();}
      else toast.push("Failed","error");
    }catch{toast.push("Failed","error");}
    finally{setResolvingAll(false);}
  };

  if(loading)return<div style={{textAlign:"center",padding:"40px 0",color:"#333"}}>Loading…</div>;

  return(
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>Stuck Markets</div>
          <div style={{fontSize:11,color:"#3a3a3a",marginTop:2}}>Expired but not resolved in DB</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:11,color:stuck.length>0?"#ff4757":"#00ff87",fontWeight:700}}>{stuck.length} stuck</span>
          {stuck.length>0&&(
            <button onClick={resolveAll} disabled={resolvingAll} style={{background:"#ff475718",border:"1px solid #ff475744",color:"#ff4757",borderRadius:9,padding:"8px 16px",fontSize:12,fontFamily:"'Syne',sans-serif",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:8,opacity:resolvingAll?0.6:1}}>
              {resolvingAll?<><Spinner/> Fixing all…</>:"⚡ Fix All"}
            </button>
          )}
          <button onClick={load} style={{background:"#111",border:"1px solid #1e1e1e",color:"#555",borderRadius:8,padding:"7px 13px",fontSize:11,cursor:"pointer"}}>↻</button>
        </div>
      </div>

      {stuck.length===0?(
        <div style={{textAlign:"center",padding:"60px 0"}}>
          <div style={{fontSize:32,marginBottom:12}}>✅</div>
          <div style={{color:"#00ff87",fontWeight:700,fontSize:14}}>All markets resolved</div>
          <div style={{color:"#333",fontSize:12,marginTop:6}}>No stuck markets found</div>
        </div>
      ):(
        stuck.map(m=>(
          <div key={m.id} style={{background:"#0e0e0e",border:"1px solid #ff475722",borderRadius:12,padding:"14px 16px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"center",flexWrap:"wrap"}}>
                  <Badge label="Stuck" color="#ff4757"/>
                  <span style={{fontSize:10,color:"#3a3a3a",fontFamily:"'DM Mono',monospace"}}>{m.pair}</span>
                  <span style={{fontSize:10,color:"#ff475799"}}>Expired {ago(new Date(m.expiry_ts*1000).toISOString().slice(0,19))}</span>
                </div>
                <div style={{fontSize:13,color:"#bbb",marginBottom:6}}>{m.question}</div>
                <div style={{fontSize:10,color:"#333",fontFamily:"'DM Mono',monospace"}}>{m.market_id_hex?.slice(0,20)}…</div>
              </div>
              <button onClick={()=>resolveOne(m.market_id_hex)} disabled={resolving[m.market_id_hex]} style={{background:"#e8ff8715",border:"1px solid #e8ff8730",color:"#e8ff87",borderRadius:9,padding:"8px 16px",fontSize:12,fontFamily:"'Syne',sans-serif",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:8,flexShrink:0,opacity:resolving[m.market_id_hex]?0.6:1}}>
                {resolving[m.market_id_hex]?<><Spinner/>Fixing…</>:"⚡ Fix"}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: AGENT CONTROLS
// ══════════════════════════════════════════════════════════════════
function AgentControls({toast}){
  const [status,setStatus]=useState(null);
  const [loadingS,setLoadingS]=useState(false);
  const [toggling,setToggling]=useState(false);
  const [logs,setLogs]=useState([]);

  const fetchStatus=useCallback(async()=>{setLoadingS(true);try{const s=await fetch(`${API}/agent/status`).then(x=>x.json());setStatus(s);}catch{setStatus({running:false,error:"Cannot reach agent"});}finally{setLoadingS(false);};},[]);
  const fetchLogs=useCallback(async()=>{try{const l=await adminFetch(`${API}/agent/logs?limit=30`).then(x=>x.json());setLogs(Array.isArray(l)?l:[]);}catch{setLogs([]);}},[]);

  useEffect(()=>{fetchStatus();fetchLogs();},[fetchStatus,fetchLogs]);

  const toggle=async()=>{if(!status)return;setToggling(true);try{await adminFetch(status.running?`${API}/agent/pause`:`${API}/agent/resume`,{method:"POST"});await fetchStatus();toast.push(status.running?"Agent paused":"Agent resumed");}catch{toast.push("Failed","error");}finally{setToggling(false);}};

  const isRunning=status?.running;
  return(
    <div className="fade">
      <div style={{background:"#0e0e0e",border:`1px solid ${isRunning?"#00ff8722":"#ff475722"}`,borderRadius:16,padding:24,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:48,height:48,borderRadius:14,background:isRunning?"#00ff8715":"#ff475715",border:`1px solid ${isRunning?"#00ff8733":"#ff475733"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>
              {loadingS?"…":isRunning?"⚡":"⏸"}
            </div>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:"#fff"}}>AI Agent <span style={{color:isRunning?"#00ff87":"#ff4757"}}>{loadingS?"checking…":isRunning?"Running":"Paused"}</span></div>
              {status?.last_scan&&<div style={{fontSize:11,color:"#3a3a3a",marginTop:2}}>Last scan: {ago(status.last_scan)}</div>}
              {status?.error&&<div style={{fontSize:11,color:"#ff6b6b",marginTop:2}}>{status.error}</div>}
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={toggle} disabled={toggling||loadingS} style={{background:isRunning?"#ff475718":"#00ff8718",border:`1px solid ${isRunning?"#ff475744":"#00ff8744"}`,color:isRunning?"#ff4757":"#00ff87",borderRadius:10,padding:"10px 18px",fontSize:12,cursor:toggling?"default":"pointer",fontFamily:"'Syne',sans-serif",fontWeight:700,display:"flex",alignItems:"center",gap:8}}>
              {toggling?<><Spinner/>…</>:isRunning?"⏸ Pause":"▶ Resume"}
            </button>
          </div>
        </div>
        {status&&!status.error&&(
          <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap"}}>
            {[["Markets Today",status.markets_created_today??"—","#e8ff87"],["Decisions Today",status.decisions_today??"—","#87d4ff"],["Interval",status.scan_interval_minutes?`${status.scan_interval_minutes}m`:"—","#fff"],["Status",status.uptime??"—","#00ff87"]].map(([lbl,val,accent])=>(
              <div key={lbl} style={{background:"#0a0a0a",border:"1px solid #161616",borderRadius:10,padding:"10px 14px",flex:1,minWidth:100}}>
                <div style={{fontSize:9,color:"#3a3a3a",letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>{lbl}</div>
                <div style={{fontSize:18,fontFamily:"'DM Mono',monospace",color:accent,fontWeight:700}}>{val}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{background:"#0e0e0e",border:"1px solid #161616",borderRadius:16,padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"#555"}}>Agent Logs</div>
          <button onClick={fetchLogs} style={{background:"none",border:"1px solid #1e1e1e",color:"#444",borderRadius:7,padding:"5px 12px",fontSize:10,cursor:"pointer"}}>↻ Refresh</button>
        </div>
        <div style={{background:"#080808",borderRadius:10,padding:"12px 14px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#3a3a3a",maxHeight:300,overflowY:"auto",border:"1px solid #111"}}>
          {logs.length===0?<div style={{color:"#222",textAlign:"center",padding:"20px 0"}}>No logs</div>:logs.map((log,i)=>(
            <div key={i} style={{padding:"3px 0",borderBottom:"1px solid #0f0f0f",color:log.level==="error"?"#ff475799":log.level==="warn"?"#e8ff8766":"#3a3a3a"}}>
              <span style={{color:log.level==="error"?"#ff4757":log.level==="warn"?"#e8ff87":"#4a4a4a",marginRight:8}}>[{log.level?.toUpperCase()||"INFO"}]</span>
              {log.message||JSON.stringify(log)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: BETS TRACKER
// ══════════════════════════════════════════════════════════════════
function BetsTracker({markets,toast}){
  const [bets,setBets]=useState({});
  const [loadingId,setLoadingId]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  const [filterPair,setFilterPair]=useState("all");
  const [filterStatus,setFilterStatus]=useState("all");
  const [search,setSearch]=useState("");

  const pairs=["all",...new Set(markets.map(m=>m.pair))];

  const loadBets=async(marketId)=>{
    if(bets[marketId]){setExpandedId(expandedId===marketId?null:marketId);return;}
    setLoadingId(marketId);
    try{
      const data=await fetch(`${API}/markets/${marketId}/bets`).then(x=>x.json());
      setBets(b=>({...b,[marketId]:Array.isArray(data)?data:[]}));
      setExpandedId(marketId);
    }catch{toast.push("Failed to load bets","error");}
    finally{setLoadingId(null);}
  };

  const filtered=markets.filter(m=>{
    if(filterPair!=="all"&&m.pair!==filterPair)return false;
    if(filterStatus==="active"&&m.resolved)return false;
    if(filterStatus==="resolved"&&!m.resolved)return false;
    if(search&&!m.question.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });

  return(
    <div className="fade">
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input placeholder="Search markets…" value={search} onChange={e=>setSearch(e.target.value)} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:9,padding:"8px 14px",color:"#ccc",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",flex:1,minWidth:180}}/>
        <select value={filterPair} onChange={e=>setFilterPair(e.target.value)} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:9,padding:"8px 12px",color:"#888",fontSize:11,cursor:"pointer",outline:"none"}}>
          {pairs.map(p=><option key={p} value={p}>{p==="all"?"All Pairs":p}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:9,padding:"8px 12px",color:"#888",fontSize:11,cursor:"pointer",outline:"none"}}>
          <option value="all">All</option><option value="active">Active</option><option value="resolved">Resolved</option>
        </select>
        <span style={{fontSize:11,color:"#3a3a3a"}}>{filtered.length} markets</span>
      </div>
      {filtered.map(m=>{
        const isExpanded=expandedId===m.id;
        const marketBets=bets[m.id]||[];
        const yesTotal=marketBets.filter(b=>b.side===true||b.side==="YES").reduce((s,b)=>s+(b.amount||0),0);
        const noTotal=marketBets.filter(b=>b.side===false||b.side==="NO").reduce((s,b)=>s+(b.amount||0),0);
        const outColor=m.outcome==="YES"?"#00ff87":m.outcome==="NO"?"#ff4757":"#666";
        return(
          <div key={m.id} style={{background:"#0e0e0e",border:"1px solid #161616",borderRadius:14,marginBottom:8,overflow:"hidden"}}>
            <div onClick={()=>loadBets(m.id)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,marginBottom:5,alignItems:"center",flexWrap:"wrap"}}>
                  {m.resolved?<Badge label={m.outcome||"VOID"} color={outColor}/>:<Badge label="Active" color="#00ff87"/>}
                  <span style={{fontSize:10,color:"#3a3a3a",fontFamily:"'DM Mono',monospace"}}>{m.pair}</span>
                  <span style={{fontSize:10,color:"#2a2a2a"}}>{ago(m.created_at)}</span>
                </div>
                <div style={{fontSize:13,color:"#bbb"}}>{m.question}</div>
              </div>
              <div style={{display:"flex",gap:16,alignItems:"center",flexShrink:0}}>
                {bets[m.id]&&<div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#3a3a3a",marginBottom:3}}>Bets</div><div style={{fontSize:14,fontFamily:"'DM Mono',monospace",color:"#e8ff87",fontWeight:700}}>{marketBets.length}</div></div>}
                <div style={{fontSize:14,color:"#2a2a2a",transition:"transform .2s",transform:isExpanded?"rotate(90deg)":"none"}}>{loadingId===m.id?<Spinner/>:"›"}</div>
              </div>
            </div>
            {isExpanded&&(
              <div style={{borderTop:"1px solid #111",padding:"14px 16px"}}>
                {marketBets.length>0&&(
                  <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    {[["YES Vol",`${(yesTotal/1e6).toFixed(2)} USDC`,"#00ff87"],["NO Vol",`${(noTotal/1e6).toFixed(2)} USDC`,"#ff4757"],["Bets",marketBets.length,"#e8ff87"],["Wallets",new Set(marketBets.map(b=>b.wallet)).size,"#87d4ff"]].map(([lbl,val,accent])=>(
                      <div key={lbl} style={{background:"#080808",border:"1px solid #111",borderRadius:9,padding:"8px 14px",flex:1,minWidth:80}}>
                        <div style={{fontSize:9,color:"#333",letterSpacing:1.5,textTransform:"uppercase",marginBottom:3}}>{lbl}</div>
                        <div style={{fontSize:15,fontFamily:"'DM Mono',monospace",color:accent,fontWeight:700}}>{val}</div>
                      </div>
                    ))}
                  </div>
                )}
                {marketBets.length===0?<div style={{color:"#2a2a2a",fontSize:12,padding:"16px 0",textAlign:"center"}}>No bets placed</div>:(
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr>{["Wallet","Side","Amount","Tx"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",color:"#333",fontSize:9,letterSpacing:1.5,textTransform:"uppercase",borderBottom:"1px solid #111"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {marketBets.map((bet,i)=>{
                        const isYes=bet.side===true||bet.side==="YES";
                        return(
                          <tr key={i} style={{borderBottom:"1px solid #0d0d0d"}}>
                            <td style={{padding:"8px 10px",fontFamily:"'DM Mono',monospace",color:"#888"}}>{short(bet.wallet)}<a href={`https://testnet.arcscan.app/address/${bet.wallet}`} target="_blank" rel="noreferrer" style={{color:"#2a2a2a",marginLeft:6,textDecoration:"none"}}>↗</a></td>
                            <td style={{padding:"8px 10px"}}><Badge label={isYes?"YES":"NO"} color={isYes?"#00ff87":"#ff4757"}/></td>
                            <td style={{padding:"8px 10px",fontFamily:"'DM Mono',monospace",color:"#e8ff87"}}>{((bet.amount||0)/1e6).toFixed(2)} USDC</td>
                            <td style={{padding:"8px 10px"}}>{bet.tx_hash?<a href={`https://testnet.arcscan.app/tx/${bet.tx_hash}`} target="_blank" rel="noreferrer" style={{color:"#3a3a3a",fontSize:10,fontFamily:"'DM Mono',monospace",textDecoration:"none"}}>{short(bet.tx_hash)}↗</a>:"—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: ANALYTICS
// ══════════════════════════════════════════════════════════════════
function Analytics(){
  const [chainStats,setChainStats]=useState({});
  const [A,setA]=useState(null);
  useEffect(()=>{
    fetch(`${API}/stats/chain/v5`).then(x=>x.json()).catch(()=>null).then(d=>{if(d&&!d.error)setChainStats(d);});
    fetch(`${API}/stats/analytics`).then(x=>x.json()).catch(()=>null).then(d=>{if(d)setA(d);});
  },[]);
  if(!A)return <div style={{color:"#444",fontSize:12,padding:"32px 0",textAlign:"center"}}>Loading…</div>;

  const yesWins=A.yes_wins,noWins=A.no_wins,voided=A.void;
  const pieData=[{name:"YES Wins",value:yesWins,color:"#00ff87"},{name:"NO Wins",value:noWins,color:"#ff4757"},{name:"Void",value:voided,color:"#333"}].filter(d=>d.value>0);
  const volumeData=A.markets_by_day.map(r=>({day:r.day.slice(5),count:r.count}));
  const pairData=A.markets_by_pair.map(r=>({pair:r.pair.replace("USDC/",""),count:r.count}));
  const decData=A.decisions_by_day.map(r=>({day:r.day.slice(5),count:r.count}));
  const created=A.created;
  const holds=A.decisions-A.created;
  const decPie=[{name:"Market Created",value:created,color:"#e8ff87"},{name:"Hold",value:holds,color:"#2a2a2a"}].filter(d=>d.value>0);
  const decisions={length:A.decisions};
  const total=A.markets;
  const resolved=A.resolved;
  const resRate=total>0?((resolved/total)*100).toFixed(0):0;
  const tooltipStyle={contentStyle:{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:8,fontSize:11},labelStyle:{color:"#555"},itemStyle:{color:"#e8ff87"}};

  return(
    <div className="fade">
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
        {[["Total TVL",chainStats.tvl_usdc!=null?`$${Number(chainStats.tvl_usdc).toLocaleString(undefined,{maximumFractionDigits:2})}`:"…","#e8ff87"],["Total Txns",chainStats.total_txns!=null?chainStats.total_txns:"…","#87d4ff"],["Unique Wallets",chainStats.unique_wallets!=null?chainStats.unique_wallets:"…","#e8ff87"],["YES Bets",chainStats.yes_bets!=null?chainStats.yes_bets:"…","#00ff87",chainStats.yes_volume_usdc!=null?`$${chainStats.yes_volume_usdc}`:null],["NO Bets",chainStats.no_bets!=null?chainStats.no_bets:"…","#ff4757",chainStats.no_volume_usdc!=null?`$${chainStats.no_volume_usdc}`:null],["Total Bets",chainStats.yes_bets!=null&&chainStats.no_bets!=null?chainStats.yes_bets+chainStats.no_bets:"…","#fff"]].map(([lbl,val,accent,sub])=>(
          <StatBox key={lbl} label={lbl} value={val} accent={accent} sub={sub}/>
        ))}
      </div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        {[["Total Markets",total,"#fff"],["Resolution Rate",`${resRate}%`,"#87d4ff"],["YES Win Rate",yesWins+noWins>0?`${((yesWins/(yesWins+noWins))*100).toFixed(0)}%`:"—","#00ff87"],["Decisions",A.decisions,"#e8ff87"],["Create Rate",created>0?`${((created/decisions.length)*100).toFixed(0)}%`:"—","#ccc"]].map(([lbl,val,accent])=>(
          <StatBox key={lbl} label={lbl} value={val} accent={accent}/>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <ChartCard title="Markets Created" sub="LAST 14 DAYS">
          {volumeData.length<2?<div style={{color:"#2a2a2a",fontSize:12,padding:"32px 0",textAlign:"center"}}>Not enough data</div>:(
            <ResponsiveContainer width="100%" height={160}><BarChart data={volumeData} margin={{top:4,right:4,bottom:0,left:-20}}><XAxis dataKey="day" tick={{fill:"#333",fontSize:9}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#333",fontSize:9}} axisLine={false} tickLine={false} allowDecimals={false}/><Tooltip {...tooltipStyle}/><Bar dataKey="count" fill="#e8ff87" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Outcome Distribution" sub="YES / NO / VOID">
          {pieData.length===0?<div style={{color:"#2a2a2a",fontSize:12,padding:"32px 0",textAlign:"center"}}>No resolved</div>:(
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <ResponsiveContainer width="50%" height={160}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>{pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip {...tooltipStyle}/></PieChart></ResponsiveContainer>
              <div style={{flex:1}}>{pieData.map(d=><div key={d.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:8,height:8,borderRadius:2,background:d.color,flexShrink:0}}/><div style={{flex:1,fontSize:11,color:"#888"}}>{d.name}</div><div style={{fontSize:14,fontFamily:"'DM Mono',monospace",color:d.color,fontWeight:700}}>{d.value}</div></div>)}</div>
            </div>
          )}
        </ChartCard>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <ChartCard title="Markets per Pair" sub="VOLUME BY CURRENCY">
          {pairData.length===0?<div style={{color:"#2a2a2a",fontSize:12,padding:"32px 0",textAlign:"center"}}>No data</div>:(
            <ResponsiveContainer width="100%" height={160}><BarChart data={pairData} layout="vertical" margin={{top:4,right:4,bottom:0,left:10}}><XAxis type="number" tick={{fill:"#333",fontSize:9}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="pair" tick={{fill:"#666",fontSize:10}} axisLine={false} tickLine={false} width={40}/><Tooltip {...tooltipStyle}/><Bar dataKey="count" fill="#87d4ff" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Agent Decisions" sub="CREATE VS HOLD">
          {decPie.length===0?<div style={{color:"#2a2a2a",fontSize:12,padding:"32px 0",textAlign:"center"}}>No decisions</div>:(
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <ResponsiveContainer width="50%" height={160}><PieChart><Pie data={decPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>{decPie.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip {...tooltipStyle}/></PieChart></ResponsiveContainer>
              <div style={{flex:1}}>{decPie.map(d=><div key={d.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><div style={{width:8,height:8,borderRadius:2,background:d.color,flexShrink:0}}/><div style={{flex:1,fontSize:11,color:"#888"}}>{d.name}</div><div style={{fontSize:14,fontFamily:"'DM Mono',monospace",color:d.color,fontWeight:700}}>{d.value}</div></div>)}{decisions.length>0&&<div style={{fontSize:10,color:"#3a3a3a",marginTop:8,borderTop:"1px solid #111",paddingTop:8}}>Signal rate: {((created/decisions.length)*100).toFixed(1)}%</div>}</div>
            </div>
          )}
        </ChartCard>
      </div>
      <ChartCard title="Agent Activity Over Time" sub="DECISIONS PER DAY · LAST 14 DAYS">
        {decData.length<2?<div style={{color:"#2a2a2a",fontSize:12,padding:"32px 0",textAlign:"center"}}>Not enough data</div>:(
          <ResponsiveContainer width="100%" height={140}><LineChart data={decData} margin={{top:4,right:4,bottom:0,left:-20}}><XAxis dataKey="day" tick={{fill:"#333",fontSize:9}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"#333",fontSize:9}} axisLine={false} tickLine={false} allowDecimals={false}/><Tooltip {...tooltipStyle}/><Line type="monotone" dataKey="count" stroke="#87d4ff" dot={false} strokeWidth={1.5}/></LineChart></ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: ADD PAIRS
// ══════════════════════════════════════════════════════════════════
function AddPairInfo(){
  return(
    <div style={{background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:14,padding:20}}>
      <div style={{fontSize:14,fontWeight:700,color:"#e8ff87",marginBottom:12}}>➕ Add New Currency Pair</div>
      <div style={{fontSize:13,color:"#888",lineHeight:1.6,marginBottom:16}}>Edit <span style={{color:"#e8ff87",fontFamily:"'DM Mono',monospace"}}>MONITORED_PAIRS</span> in <span style={{color:"#87d4ff",fontFamily:"'DM Mono',monospace"}}>agent/config.py</span> on Oracle Cloud.</div>
      <div style={{background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
        <div style={{fontSize:11,color:"#444",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Available sources</div>
        {[["okx_eurusdt","EURC/USDC — OKX"],["flutterwave_ngn","NGN/USDC — Flutterwave"],["exchangerate_ghs","GHS/USDC — Ghana"],["exchangerate_kes","KES/USDC — Kenya"],["exchangerate_zar","ZAR/USDC — South Africa"],["exchangerate_egp","EGP/USDC — Egypt"],["exchangerate_tzs","TZS/USDC — Tanzania"],["exchangerate_ugx","UGX/USDC — Uganda"],["exchangerate_mad","MAD/USDC — Morocco"]].map(([src,label])=>(
          <div key={src} style={{display:"flex",gap:12,marginBottom:6,alignItems:"center"}}>
            <code style={{fontSize:11,color:"#87d4ff",background:"#1a1a1a",padding:"2px 7px",borderRadius:4}}>{src}</code>
            <span style={{fontSize:12,color:"#555"}}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{background:"#0a1f0a",border:"1px solid #00e87a22",borderRadius:10,padding:"12px 14px"}}>
        <div style={{fontSize:11,color:"#00e87a",fontWeight:700,marginBottom:6}}>Example</div>
        <pre style={{fontSize:11,color:"#777",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{'{"pair":"USDC/TZS","source":"exchangerate_tzs","label":"TZS per USDC"},'}</pre>
        <div style={{fontSize:11,color:"#447744",marginTop:6}}>Restart: <code style={{color:"#00e87a"}}>sudo systemctl restart agorafx</code></div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
export default function Admin(){
  const auth=useAdminAuth();
  const toast=useToast();
  const [stats,setStats]=useState(null);
  const [markets,setMarkets]=useState([]);
  const [decisions,setDecisions]=useState([]);
  const [rates,setRates]=useState({});
  const [onChain,setOnChain]=useState(null);
  const [loading,setLoading]=useState(false);
  const [tab,setTab]=useState("overview");
  const [autoRefresh,setAutoRefresh]=useState(true);
  const [refreshInterval,setRefreshInterval]=useState(30);

  const loadAll=useCallback(async()=>{
    if(!auth.isAdmin)return;
    setLoading(true);
    try{
      const[s,m,d,oc]=await Promise.all([
        fetch(`${API}/stats`).then(x=>x.json()),
        fetch(`${API}/markets?limit=5000`).then(x=>x.json()),
        fetch(`${API}/decisions?limit=20000`).then(x=>x.json()),
        loadAdminStats(),
      ]);
      setStats(s);setMarkets(m);setDecisions(d);setOnChain(oc);
      const pairs=[...new Set(m.map(x=>x.pair))];
      const rateResults=await Promise.all(pairs.map(p=>fetch(`${API}/rates?pair=${encodeURIComponent(p)}&limit=30`).then(x=>x.json())));
      const rateMap={};pairs.forEach((p,i)=>rateMap[p]=rateResults[i]);
      setRates(rateMap);
    }catch(e){console.error(e);}
    finally{setLoading(false);}
  },[auth.isAdmin]);

  useEffect(()=>{if(auth.isAdmin)loadAll();},[auth.isAdmin,loadAll]);
  const countdown=useAutoRefresh(loadAll,refreshInterval,autoRefresh&&auth.isAdmin);

  const gateStyle={minHeight:"100vh",background:"#080808",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:20,padding:24,fontFamily:"'Syne',sans-serif"};

  if(!auth.account)return(
    <div style={gateStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;600&family=Syne:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#080808;}`}</style>
      <div style={{fontSize:26,fontWeight:800,color:"#fff"}}>Agora<span style={{color:"#e8ff87"}}>FX</span> <span style={{color:"#333"}}>Admin</span></div>
      <div style={{fontSize:13,color:"#444"}}>Restricted — Admin Only</div>
      <button onClick={auth.connect} style={{background:"#e8ff87",border:"none",color:"#000",borderRadius:12,padding:"12px 32px",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,cursor:"pointer"}}>{auth.loading?"Connecting…":"Connect Wallet"}</button>
    </div>
  );

  if(!auth.isAdmin)return(
    <div style={gateStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#080808;}`}</style>
      <div style={{fontSize:32}}>🔒</div>
      <div style={{fontSize:18,fontWeight:700,color:"#ff6b6b"}}>Access Denied</div>
      <div style={{fontSize:13,color:"#444",textAlign:"center"}}>{auth.account}<br/>Admin only.</div>
      <a href="/" style={{color:"#e8ff87",fontSize:13,marginTop:8}}>← Back</a>
    </div>
  );

  if(!auth.chainOk)return(
    <div style={gateStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{background:#080808;}`}</style>
      <div style={{fontSize:32}}>⚠️</div>
      <div style={{fontSize:16,color:"#ff6b6b",fontWeight:700}}>Switch to Arc Testnet</div>
      <button onClick={auth.switchToArc} style={{background:"#ff4c4c",border:"none",color:"#fff",borderRadius:10,padding:"10px 24px",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer"}}>Switch Network</button>
    </div>
  );

  const TABS=[["overview","Overview"],["stuck","🔧 Stuck Markets"],["agent","⚡ Agent"],["bets","🎯 Positions"],["analytics","📊 Analytics"],["markets","Markets"],["decisions","Decisions"],["rates","Rates"],["pairs","+ Pairs"]];

  const stuckCount=markets.filter(m=>!m.resolved&&m.expiry_ts<=Math.floor(Date.now()/1000)).length;

  return(
    <div style={{minHeight:"100vh",background:"#080808",color:"#fff",fontFamily:"'Syne',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;600&family=Syne:wght@400;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#080808;overflow-x:hidden;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:2px;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:none;}}
        @keyframes spin{to{transform:rotate(360deg);}}
        .fade{animation:fadeIn .3s ease both;}
        input::placeholder{color:#333;}
      `}</style>
      <ToastContainer toasts={toast.toasts}/>

      {/* Header */}
      <div style={{background:"rgba(8,8,8,.96)",backdropFilter:"blur(12px)",borderBottom:"1px solid #111",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,position:"sticky",top:0,zIndex:20}}>
        <div>
          <div style={{fontSize:18,fontWeight:800}}>Agora<span style={{color:"#e8ff87"}}>FX</span> <span style={{color:"#333",fontWeight:400}}>Admin</span></div>
          <div style={{fontSize:9,color:"#2a2a2a",marginTop:2,fontFamily:"'DM Mono',monospace",letterSpacing:1}}>{auth.account}</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          {/* Auto refresh controls */}
          <div style={{display:"flex",alignItems:"center",gap:8,background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:9,padding:"6px 12px"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:autoRefresh?"#00ff87":"#333",flexShrink:0}}/>
            <span style={{fontSize:10,color:"#555",fontFamily:"'DM Mono',monospace"}}>{autoRefresh?`${countdown}s`:"paused"}</span>
            <select value={refreshInterval} onChange={e=>setRefreshInterval(Number(e.target.value))} style={{background:"transparent",border:"none",color:"#555",fontSize:10,cursor:"pointer",outline:"none"}}>
              <option value={15}>15s</option><option value={30}>30s</option><option value={60}>1m</option><option value={120}>2m</option>
            </select>
            <button onClick={()=>setAutoRefresh(a=>!a)} style={{background:"none",border:"none",color:autoRefresh?"#e8ff87":"#444",cursor:"pointer",fontSize:11,padding:0}}>
              {autoRefresh?"⏸":"▶"}
            </button>
          </div>
          <button onClick={loadAll} disabled={loading} style={{background:"#111",border:"1px solid #1e1e1e",color:loading?"#333":"#777",borderRadius:9,padding:"7px 14px",fontSize:11,cursor:"pointer",fontFamily:"'Syne',sans-serif",display:"flex",alignItems:"center",gap:7}}>
            {loading?<><Spinner/>Refreshing</>:"↻ Refresh"}
          </button>
          <a href="/" style={{background:"#e8ff8715",border:"1px solid #e8ff8730",color:"#e8ff87",borderRadius:9,padding:"7px 14px",fontSize:11,textDecoration:"none",fontWeight:700}}>← App</a>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{display:"flex",gap:0,borderBottom:"1px solid #111",overflowX:"auto",padding:"0 16px",background:"#0a0a0a"}}>
        {TABS.map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{background:"none",border:"none",cursor:"pointer",padding:"12px 14px",fontSize:11,fontFamily:"'Syne',sans-serif",whiteSpace:"nowrap",color:tab===key?"#fff":"#3a3a3a",borderBottom:tab===key?"2px solid #e8ff87":"2px solid transparent",fontWeight:tab===key?700:400,transition:"color .18s",position:"relative"}}>
            {label}
            {key==="stuck"&&stuckCount>0&&<span style={{position:"absolute",top:8,right:4,background:"#ff4757",color:"#fff",fontSize:8,borderRadius:10,padding:"1px 5px",fontWeight:700}}>{stuckCount}</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px"}}>
        {tab==="overview"&&<Overview stats={stats} onChain={onChain} rates={rates} loadAll={loadAll} loading={loading} toast={toast} auth={auth}/>}
        {tab==="stuck"&&<StuckMarkets toast={toast}/>}
        {tab==="agent"&&<AgentControls toast={toast}/>}
        {tab==="bets"&&<BetsTracker markets={markets} toast={toast}/>}
        {tab==="analytics"&&<Analytics/>}

        {tab==="markets"&&(
          <div className="fade">
            <div style={{marginBottom:12,fontSize:12,color:"#3a3a3a"}}>{markets.length} total markets</div>
            {markets.map(m=>{
              const outColor=m.outcome==="YES"?"#00ff87":m.outcome==="NO"?"#ff4757":"#666";
              const isStuck=!m.resolved&&m.expiry_ts<=Math.floor(Date.now()/1000);
              return(
                <div key={m.id} style={{background:"#0e0e0e",border:`1px solid ${isStuck?"#ff475722":"#161616"}`,borderRadius:12,padding:"14px 16px",marginBottom:7}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:8,marginBottom:7,alignItems:"center",flexWrap:"wrap"}}>
                        {isStuck?<Badge label="Stuck" color="#ff4757"/>:<Badge label={m.resolved?(m.outcome||"VOID"):"Active"} color={m.resolved?outColor:"#00ff87"}/>}
                        <span style={{fontSize:10,color:"#3a3a3a",fontFamily:"'DM Mono',monospace"}}>{m.pair}</span>
                        <span style={{fontSize:10,color:"#2a2a2a"}}>{ago(m.created_at)}</span>
                        <Badge label={m.is_above?"↑ above":"↓ below"} color={m.is_above?"#00ff87":"#ff4757"}/>
                      </div>
                      <div style={{fontSize:13,color:"#bbb"}}>{m.question}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:9,color:"#3a3a3a",marginBottom:3}}>Threshold</div>
                      <div style={{fontSize:14,color:"#e8ff87",fontFamily:"'DM Mono',monospace",fontWeight:700}}>{(m.threshold/1_000_000).toFixed(4)}</div>
                      {m.tx_hash&&<a href={`https://testnet.arcscan.app/tx/${m.tx_hash}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#2a2a2a",textDecoration:"none",display:"block",marginTop:4}}>↗ Arcscan</a>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab==="decisions"&&(
          <div className="fade">
            <div style={{marginBottom:12,fontSize:12,color:"#3a3a3a"}}>{decisions.length} decisions</div>
            {decisions.map((d,i)=>{
              const isCreate=d.action==="create_market";
              return(
                <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",background:"#0e0e0e",border:"1px solid #141414",borderRadius:10,marginBottom:6,alignItems:"flex-start"}}>
                  <Badge label={isCreate?"Market":"Hold"} color={isCreate?"#00ff87":"#2a2a2a"}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"#999",lineHeight:1.45}}>{d.reasoning}</div>
                    <div style={{fontSize:10,color:"#2a2a2a",marginTop:3}}>{d.pair} · {ago(d.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab==="rates"&&(
          <div className="fade">
            {Object.entries(rates).map(([pair,rateList])=>(
              <div key={pair} style={{background:"#0e0e0e",border:"1px solid #161616",borderRadius:14,padding:20,marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:"#bbb",marginBottom:14}}>{pair}</div>
                {rateList?.length>0?(
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr>{["Time","Rate","Source"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",color:"#3a3a3a",fontSize:9,letterSpacing:1.5,textTransform:"uppercase",borderBottom:"1px solid #111"}}>{h}</th>)}</tr></thead>
                    <tbody>{[...rateList].reverse().slice(0,15).map((r,i)=>(
                      <tr key={i} style={{borderBottom:"1px solid #0d0d0d"}}>
                        <td style={{padding:"7px 10px",color:"#555",fontFamily:"'DM Mono',monospace"}}>{new Date(r.recorded_at+"Z").toLocaleTimeString()}</td>
                        <td style={{padding:"7px 10px",color:"#e8ff87",fontFamily:"'DM Mono',monospace",fontWeight:600}}>{Number(r.rate).toFixed(pair==="USDC/EURC"?6:2)}</td>
                        <td style={{padding:"7px 10px",color:"#3a3a3a"}}>{r.source}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ):<div style={{color:"#333",fontSize:12}}>No data</div>}
              </div>
            ))}
          </div>
        )}

        {tab==="pairs"&&<div className="fade"><AddPairInfo/></div>}
      </div>
    </div>
  );
}

