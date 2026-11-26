import {readFile,writeFile} from 'node:fs/promises';
const key=process.env.ADSPENDSPY_API_KEY;
if(!key){console.log('AdSpendSpy key not set; leaving unavailable estimates blank');process.exit(0)}
const path='docs/ads.json', catalog=JSON.parse(await readFile(path,'utf8'));
const rows=new Map(catalog.ads.map(ad=>[String(ad.id),ad]));
const linked=new Set();
let cursor;
try{
 for(let page=0;page<8;page++){
  const u=new URL('https://www.adspendspy.com/api/v1/ads/new.php');
  u.searchParams.set('limit','100');if(cursor)u.searchParams.set('cursor',cursor);
  const r=await fetch(u,{headers:{'X-API-Key':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok){console.log('AdSpendSpy HTTP',r.status);break}
  const data=await r.json();
  if(data.success!==true||!Array.isArray(data.items)){console.log('Unexpected AdSpendSpy response');break}
  for(const {ad} of data.items){
   if(typeof ad?.ad_archive_id!=='string')continue;
   const row=rows.get(ad.ad_archive_id), amount=ad.estimated_spend_eur;
   if(!row||ad.spend_coverage!=='eu_uk')continue;
   if(typeof amount==='number'&&Number.isFinite(amount)&&amount>0){
    row.spendEstimate={amount,currency:'EUR',scope:'EU_UK',source:'AdSpendSpy'};linked.add(row.id);
   }
  }
  const next=data.pagination?.next_cursor;
  if(!next||next===cursor||linked.size>=rows.size)break;
  cursor=next;
 }
}catch(e){console.log('AdSpendSpy enrichment unavailable:',e.name)}
if(linked.size)await writeFile(path,JSON.stringify(catalog));
console.log('AdSpendSpy estimates matched by Meta Library ID:',linked.size);
