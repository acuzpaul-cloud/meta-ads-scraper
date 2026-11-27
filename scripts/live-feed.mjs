const base='https://tucoiva-ad-query.acuzpaul-cloud.workers.dev';
const id=process.env.AD_REQUEST_ID;
export const live=Boolean(id&&process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
let credentials;
async function token(){
 if(!credentials||Date.now()>credentials.until){
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience','tucoiva-live/'+id);
  const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Runner identity HTTP '+r.status);
  credentials={value:(await r.json()).value,until:Date.now()+120000};
 }
 return credentials.value;
}
export async function publish(path,card){
 if(!live)return;
 for(let n=0;;n++){
  try{
   const r=await fetch(base+path+'?requestId='+encodeURIComponent(id),{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify(card||{}),signal:AbortSignal.timeout(9000)});
   if(!r.ok)throw Error('Live feed HTTP '+r.status);
   return;
  }catch(e){if(n===2)throw e;await new Promise(r=>setTimeout(r,400*(n+1)))}
 }
}
export async function* events(response){
 const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
 let buffer='';
 try{
  for(;;){
   const {value,done}=await reader.read();buffer+=value||'';
   const lines=buffer.split('\n');buffer=lines.pop();
   for(const line of lines)if(line.startsWith('data: '))yield JSON.parse(line.slice(6));
   if(done){if(buffer.startsWith('data: '))yield JSON.parse(buffer.slice(6));return}
  }
 }finally{reader.releaseLock()}
}
