const origin='https://acuzpaul-cloud.github.io';
const api='https://api.github.com/repos/acuzpaul-cloud/meta-ads-scraper/actions/workflows/ads-pages.yml';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'no-store'};
const json=(data,status=200)=>Response.json(data,{status,headers:cors});
export default {async fetch(request,env){
 const {pathname,searchParams}=new URL(request.url);
 const site=request.headers.get('Origin');
 if(site && site!==origin)return json({error:'ORIGIN_NOT_ALLOWED'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(pathname==='/health'&&request.method==='GET')return json({ok:true,configured:Boolean(env.GITHUB_ACTIONS_TOKEN)});
 if(['/feed','/more','/demand','/record','/archiving','/asset'].includes(pathname)){
  try{return await live(request,env,pathname,searchParams)}catch{return json({error:'LIVE_UNAVAILABLE'},503)}
 }
 if(!((pathname==='/query'&&request.method==='POST')||(pathname==='/status'&&request.method==='GET')))return json({error:'NOT_FOUND'},404);
 if(!env.GITHUB_ACTIONS_TOKEN)return json({error:'NOT_CONFIGURED'},503);
 const headers={Authorization:'Bearer '+env.GITHUB_ACTIONS_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'Tucoiva-Ad-Dashboard','X-GitHub-Api-Version':'2026-03-10'};
 try{
  if(pathname==='/query'){
   let body;try{const raw=await request.text();if(raw.length>3000)return json({error:'INVALID_INPUT'},400);body=JSON.parse(raw)}catch{return json({error:'INVALID_INPUT'},400)}
   const keywords=typeof body?.keywords==='string'?[...new Set(body.keywords.split(/[,，]/).map(x=>x.trim()).filter(Boolean))]:[];
   const country=body?.country;
   if(!keywords.length||keywords.length>8||keywords.some(x=>x.length>100)||typeof country!=='string'||! /^(ALL|[A-Z]{2})$/.test(country))return json({error:'INVALID_INPUT'},400);
   const requestId=crypto.randomUUID();
   await env.LIVE.prepare('DELETE FROM sessions WHERE created < ?').bind(Date.now()-86400000).run();
   await env.LIVE.prepare('INSERT INTO sessions(id,created) VALUES(?,?)').bind(requestId,Date.now()).run();
   const r=await fetch(api+'/dispatches',{method:'POST',headers,body:JSON.stringify({ref:'master',inputs:{keywords:keywords.join(','),countries:country,request_id:requestId}}),signal:AbortSignal.timeout(15000)});
   if(!r.ok)return json({error:'GITHUB_REJECTED',upstreamStatus:r.status},502);
   return json({requestId},202);
  }
  const requestId=searchParams.get('requestId');
  if(!uuid.test(requestId||''))return json({error:'INVALID_INPUT'},400);
  const r=await fetch(api+'/runs?event=workflow_dispatch&per_page=30',{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)return json({error:'GITHUB_REJECTED',upstreamStatus:r.status},502);
  const data=await r.json();
  const run=data.workflow_runs?.find(x=>x.display_title==='Dashboard scan '+requestId);
  return json(run?{status:run.status,conclusion:run.conclusion}:{status:'waiting'});
 }catch{return json({error:'UPSTREAM_UNAVAILABLE'},502)}
}};

const issuer='https://token.actions.githubusercontent.com';
const repo='acuzpaul-cloud/meta-ads-scraper';
let keyCache, expires=0;
function decode(s){
 return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
async function authorized(request,id){
 try{
  const bearer=request.headers.get('Authorization')||'';
  if(!bearer.startsWith('Bearer '))return false;
  const [head,body,signature]=bearer.slice(7).split('.');
  const read=s=>JSON.parse(new TextDecoder().decode(decode(s)));
  const h=read(head),c=read(body),now=Date.now()/1000;
  if(h.alg!=='RS256'||c.iss!==issuer||c.aud!=='tucoiva-live/'+id||c.exp<=now||!Number.isFinite(c.exp)||c.nbf>now+15||
     c.workflow_ref!==repo+'/.github/workflows/ads-pages.yml@refs/heads/master'||c.event_name!=='workflow_dispatch'||c.repository!==repo)return false;
  if(!keyCache||expires<now){
   const r=await fetch(issuer+'/.well-known/jwks',{signal:AbortSignal.timeout(6000)});
   if(!r.ok)return false;
   keyCache=(await r.json()).keys;expires=now+600;
  }
  const jwk=keyCache.find(k=>k.kid===h.kid);
  if(!jwk){expires=0;return false}
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(signature),new TextEncoder().encode(head+'.'+body));
 }catch{return false}
}
async function live(request,env,path,q){
 const id=q.get('requestId');
 if(!uuid.test(id||''))return json({error:'INVALID_SESSION'},400);
 const db=env.LIVE;
 const read=['/feed','/demand','/asset'].includes(path);
 if(request.method!==(read?'GET':'POST'))return json({error:'METHOD'},405);
 const session=await db.prepare('SELECT demand,phase FROM sessions WHERE id=?').bind(id).first();
 if(!session)return json({error:'UNKNOWN_SESSION'},404);
 if(path==='/demand')return json(session);
 if(path==='/more'){
  const seq=Number(q.get('seq'));
  if(!Number.isSafeInteger(seq)||seq<=0)return json({error:'BAD_SEQUENCE'},400);
  await db.prepare("UPDATE sessions SET demand=max(demand,?) WHERE id=? AND phase='open'").bind(seq,id).run();
  return json({ok:true});
 }
 if(path==='/feed'){
  const after=Number(q.get('after')||0);
  if(!Number.isSafeInteger(after)||after<0)return json({error:'INVALID_CURSOR'},400);
  const until=Date.now()+6000;
  for(;;){
   const {results}=await db.prepare('SELECT seq,payload FROM cards WHERE session=? AND seq>? ORDER BY seq LIMIT 40').bind(id,after).all();
   if(results.length||Date.now()>=until||request.signal.aborted||session.phase!=='open')
    return json({events:results.map(r=>({seq:r.seq,card:JSON.parse(r.payload)})),phase:session.phase});
   await new Promise(resolve=>setTimeout(resolve,650));
  }
 }
 if(path==='/asset'){
  const ad=q.get('ad'),index=Number(q.get('index'));
  if(!/^\d+$/.test(ad||'')||!Number.isSafeInteger(index)||index<0)return json({error:'BAD_ASSET'},400);
  const row=await db.prepare('SELECT payload FROM cards WHERE session=? AND ad=?').bind(id,ad).first();
  const raw=row&&JSON.parse(row.payload).media[index]?.file;
  if(!raw)return json({error:'NO_ASSET'},404);
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/i.test(url.hostname))return json({error:'NO_ASSET'},404);
  const source=await fetch(url,{redirect:'error'});
  const mime=source.headers.get('Content-Type')||'';
  if(!source.ok||!(/^(image\/(jpeg|png|webp|avif|gif)|video\/(mp4|webm))(;|$)/i.test(mime)))return json({error:'MEDIA_UNAVAILABLE'},502);
  return new Response(source.body,{headers:{...cors,'Content-Type':mime,'X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="'+ad+'-'+(index+1)+'.'+mime.split('/')[1].split(';')[0]+'"'}});
 }
 if(!await authorized(request,id))return json({error:'FORBIDDEN'},403);
 if(path==='/archiving'){
  await db.prepare("UPDATE sessions SET phase='archiving' WHERE id=?").bind(id).run();
  return json({ok:true});
 }
 const card=await request.json();
 if(!/^\d+$/.test(card.id)||!Array.isArray(card.media))return json({error:'INVALID_CARD'},400);
 await db.prepare('INSERT OR IGNORE INTO cards(session,ad,payload) VALUES(?,?,?)').bind(id,card.id,JSON.stringify(card)).run();
 return json({ok:true});
}
