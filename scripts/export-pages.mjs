import {mkdir,writeFile,readFile} from 'node:fs/promises';
const backfill=process.env.AD_BACKFILL==='1';
const existing=backfill?JSON.parse(await readFile('docs/ads.json','utf8')):null;
if(existing){process.env.AD_KEYWORDS=[...new Set(existing.ads.flatMap(a=>a.keywords))].join(',');process.env.AD_COUNTRIES=[...new Set(existing.ads.flatMap(a=>a.countries))].join(',')}
const keywords=[...new Set(process.env.AD_KEYWORDS.split(',').map(x=>x.trim()).filter(Boolean))];
const countries=[...new Set(process.env.AD_COUNTRIES.toUpperCase().split(',').map(x=>x.trim()).filter(Boolean))];
if(!keywords.length||!countries.length||keywords.length*countries.length>8||keywords.some(x=>x.length>100)||countries.some(x=>!(/^(ALL|[A-Z]{2})$/).test(x)))throw Error('Enter 1–8 keyword/country combinations');
const ads=new Map();
const scans=[];
const perSearch=Math.floor(10*60000/(keywords.length*countries.length));
function landingUrl(raw){
 if(typeof raw!=='string'||raw.length>4000)return null;
 try{
  let url=new URL(raw);
  if(/(^|\.)facebook\.com$/i.test(url.hostname)&&url.pathname==='/l.php')url=new URL(url.searchParams.get('u')||'');
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||/(^|\.)(facebook\.com|instagram\.com|fbcdn\.net)$/i.test(url.hostname))return null;
  return url.href;
 }catch{return null}
}
for(const keyword of keywords)for(const country of countries){
 const response=await fetch('http://127.0.0.1:3000/api/scrape',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword,country,status:'ACTIVE',limit:backfill?60:0,paginationBudgetMs:perSearch,fetch_details:!backfill && /^(GB|FR|DE|IT|ES|PL|NL|BE|IE|AT|SE|DK|FI|PT|GR|CZ|RO|HU|SK|SI|HR|BG|LT|LV|EE|LU|MT|CY)$/.test(country)}),signal:AbortSignal.timeout(backfill?240000:perSearch+90000)});
 if(!response.ok)throw Error('Scan HTTP '+response.status);
 const events=(await response.text()).split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));
 for(const e of events.filter(x=>x.type==='error'||x.type==='warning'))console.log(keyword,country,e.type,e.message);
 const done=events.find(x=>x.type==='done');
 const warnings=events.filter(x=>x.type==='warning').map(x=>x.code);
 if(backfill&&(!done||events.some(x=>x.type==='error')))throw Error('Incomplete backfill: '+keyword+' / '+country);
 scans.push({keyword,country,count:events.filter(x=>x.type==='ad').length,partial:!done||events.some(x=>x.type==='error')||['TIME_BUDGET','PAGINATION_BLOCKED','PAGINATION_UNCONFIRMED','NO_MORE_RESULTS_OBSERVED'].includes(done.paginationStop)||warnings.includes('META_RATE_LIMITED'),stop:done?.paginationStop||null});
 for(const {data:a} of events.filter(x=>x.type==='ad'&&/^\d+$/.test(x.data?.id))){
  if(!ads.has(a.id))ads.set(a.id,{id:a.id,name:a.advertiser_name,type:a.media_type,startedAt:a.started_at||null,daysRunning:a.days_running??null,reach:a.total_reach??null,impressionsMin:a.impressions_min??null,impressionsMax:a.impressions_max??null,spendMin:a.spend_min??null,spendMax:a.spend_max??null,currency:a.spend_currency||'',headline:a.headline||'',body:(a.body_variants||[]).join(' ').slice(0,1800),keywords:[],countries:[],media:[],urls:new Set(),destinations:new Map()});
  const row=ads.get(a.id);
  const links=[a.link_url,...(a.carousel_cards||[]).map(c=>c.link_url)].map(landingUrl).filter(Boolean);
  for(const c of a.carousel_cards||[]){
   const page=landingUrl(c.link_url);
   if(page&&new URL(page).pathname!=='/')for(const asset of [c.image_url,c.video_url])if(asset&&!row.destinations.has(asset))row.destinations.set(asset,page);
  }
  if(links.length)row.landingPages=[...new Set([...(row.landingPages||[]),...links])].slice(0,20);
  if(a.post_engagement)row.postEngagement={...row.postEngagement,...a.post_engagement};
  for(const [key,value] of Object.entries({startedAt:a.started_at,daysRunning:a.days_running,reach:a.total_reach,impressionsMin:a.impressions_min,impressionsMax:a.impressions_max,spendMin:a.spend_min,spendMax:a.spend_max,currency:a.spend_currency}))if((row[key]==null||row[key]==='')&&value!=null)row[key]=value;
  if(!row.keywords.includes(keyword))row.keywords.push(keyword);
  if(!row.countries.includes(country))row.countries.push(country);
  for(const url of [...(a.video_urls||[]),...(a.media_urls||[]),...(a.carousel_cards||[]).flatMap(c=>[c.video_url,c.image_url])])if(url)row.urls.add(url);
 }
}
if(!ads.size&&(backfill||scans.some(x=>x.partial)))throw Error('No reliable results; keeping previous publication');
if(existing){
 let dates=0,landing=0;
 for(const row of existing.ads){
  const fresh=ads.get(row.id);if(!fresh)continue;
  if(fresh.landingPages?.length){row.landingPages=fresh.landingPages;landing++}
  for(const key of ['startedAt','daysRunning','reach','impressionsMin','impressionsMax','spendMin','spendMax','currency','postEngagement']){
   if(fresh[key]!=null&&fresh[key]!==''){if(key==='startedAt'&&!row[key])dates++;row[key]=fresh[key]}
  }
 }
 if(!dates&&!landing)throw Error('No dates or landing pages matched the existing cards');
 await writeFile('docs/ads.json',JSON.stringify(existing));
 console.log('Backfilled dates:',dates,'Landing pages:',landing,'of',existing.ads.length);
 process.exit(0);
}
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
   row.media.push({file,kind:mime.startsWith('video/')?'video':'image',size,landingPage:row.destinations.get(raw)});remaining-=size;kept++;
  }catch(e){console.log('Media unavailable for',row.id,e.name)}
 }
 delete row.urls;
 delete row.destinations;
}
if(ads.size&&!kept)console.log('No downloadable media; publishing ad records and original links');
await writeFile('docs/ads.json',JSON.stringify({requestId:process.env.AD_REQUEST_ID||'',updatedAt:new Date().toISOString(),scans,ads:[...ads.values()]}));
console.log('Published',ads.size,'records and',kept,'original media files');
