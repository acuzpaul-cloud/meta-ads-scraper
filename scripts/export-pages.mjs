import {mkdir,writeFile} from 'node:fs/promises';
const keywords=[...new Set(process.env.AD_KEYWORDS.split(',').map(x=>x.trim()).filter(Boolean))];
const countries=[...new Set(process.env.AD_COUNTRIES.toUpperCase().split(',').map(x=>x.trim()).filter(Boolean))];
if(!keywords.length||!countries.length||keywords.length*countries.length>8||keywords.some(x=>x.length>100)||countries.some(x=>!(/^(ALL|[A-Z]{2})$/).test(x)))throw Error('Enter 1–8 keyword/country combinations');
const ads=new Map();
for(const keyword of keywords)for(const country of countries){
 const response=await fetch('http://127.0.0.1:3000/api/scrape',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword,country,status:'ACTIVE',limit:10}),signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Scan HTTP '+response.status);
 const events=(await response.text()).split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));
 for(const e of events.filter(x=>x.type==='error'||x.type==='warning'))console.log(keyword,country,e.type,e.message);
 if(!events.some(x=>x.type==='done')||events.some(x=>x.type==='error'))throw Error('Incomplete scan: '+keyword+' / '+country);
 for(const {data:a} of events.filter(x=>x.type==='ad'&&/^\d+$/.test(x.data?.id))){
  if(!ads.has(a.id))ads.set(a.id,{id:a.id,name:a.advertiser_name,type:a.media_type,headline:a.headline||'',body:(a.body_variants||[]).join(' ').slice(0,1800),keywords:[],countries:[],media:[],urls:new Set()});
  const row=ads.get(a.id);
  if(!row.keywords.includes(keyword))row.keywords.push(keyword);
  if(!row.countries.includes(country))row.countries.push(country);
  for(const url of [...(a.video_urls||[]),...(a.media_urls||[]),...(a.carousel_cards||[]).flatMap(c=>[c.video_url,c.image_url])])if(url)row.urls.add(url);
 }
}
if(!ads.size)throw Error('No real ads returned; keeping previous publication');
await mkdir('docs/media',{recursive:true});
let remaining=250*1024*1024, kept=0;
const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/webm':'webm'};
for(const row of ads.values()){
 for(const raw of row.urls){
  if(row.media.length>=8||remaining<1024)break;
  try{
   const u=new URL(raw);
   if(u.protocol!=='https:'||!/(^|\.)(fbcdn\.net|facebook\.com|cdninstagram\.com|fbsbx\.com)$/i.test(u.hostname))continue;
   const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(12000)});
   const mime=(r.headers.get('content-type')||'').split(';')[0];
   const cap=Math.min(remaining,24*1024*1024);
   if(!r.ok||!r.body||!extensions[mime]||Number(r.headers.get('content-length'))>cap){await r.body?.cancel();continue}
   let size=0;const chunks=[];
   for await(const chunk of r.body){size+=chunk.byteLength;if(size>cap)break;chunks.push(chunk)}
   if(!size||size>cap)continue;
   const file='media/'+row.id+'-'+(row.media.length+1)+'.'+extensions[mime];
   await writeFile('docs/'+file,Buffer.concat(chunks,size));
   row.media.push({file,kind:mime.startsWith('video/')?'video':'image',size});remaining-=size;kept++;
  }catch(e){console.log('Media unavailable for',row.id,e.name)}
 }
 delete row.urls;
}
if(!kept)throw Error('No original media could be saved; keeping previous publication');
await writeFile('docs/ads.json',JSON.stringify({requestId:process.env.AD_REQUEST_ID||'',updatedAt:new Date().toISOString(),ads:[...ads.values()]}));
console.log('Published',ads.size,'records and',kept,'original media files');
