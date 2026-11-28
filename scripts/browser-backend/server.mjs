import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { authorized } from '../../cloudflare/query-worker.js';
const require = createRequire(import.meta.url);
const { scrapeAds } = require('../../node_modules/.cache/tucoiva-browser/lib/scraper.js');
const { scrollWaiter } = require('../../node_modules/.cache/tucoiva-browser/lib/scrollDemand.js');
const profile = process.env.AD_PROFILE_DIR;
if (!profile) throw Error('AD_PROFILE_DIR is required');
await mkdir(profile, { recursive: true, mode: 0o700 });
const context = await chromium.launchPersistentContext(profile, {
  headless: false, viewport: null, acceptDownloads: false,
});
const tab = context.pages()[0] ?? await context.newPage();
await tab.goto('https://www.facebook.com/ads/library/', { waitUntil: 'domcontentloaded' }).catch(() => {});
let busy = false;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ service: 'ad-browser-v1' }));
    return;
  }
  const match = /^\/scan\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(req.url ?? '');
  if (req.method !== 'POST' || !match) { res.writeHead(404).end(); return; }
  const id = match[1];
  const headers = new Headers();
  headers.set('Authorization', req.headers['x-ad-workflow-identity'] ?? '');
  if (!await authorized({ headers }, id, 'tucoiva-browser/')) {
    res.writeHead(403).end();
    return;
  }

  let params;
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4000) throw Error();
    }
    const p = JSON.parse(raw);
    if (typeof p.keyword !== 'string' || !p.keyword.trim() || p.keyword.length > 100 ||
        typeof p.country !== 'string' || !/^(ALL|[A-Z]{2})$/.test(p.country) ||
        ![undefined, 'image', 'video', 'meme'].includes(p.ad_type) ||
        !Number.isFinite(p.paginationBudgetMs)) throw Error();
    params = { keyword: p.keyword.trim(), country: p.country, ad_type: p.ad_type,
      status: 'ACTIVE', limit: 0, fetch_details: p.fetch_details === true,
      paginationBudgetMs: Math.max(30000, Math.min(720000, p.paginationBudgetMs)) };
  } catch { res.writeHead(400).end(); return; }
  if (busy) { res.writeHead(409).end(); return; }
  busy = true;
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event) => res.write('data: ' + JSON.stringify(event) + '\n\n');
  const heartbeat = setInterval(() => res.write(': waiting\n\n'), 10000);
  try {
    let paginationStop;
    let total = 0;
    const desktop = { context, signal: controller.signal, waitForScroll: scrollWaiter(id, controller.signal) };
    for await (const batch of scrapeAds(params, undefined, undefined, reason => { paginationStop = reason; }, desktop)) {
      if (controller.signal.aborted) break;
      for (const ad of batch) { send({ type: 'ad', data: ad }); total++; }
    }
    if (!controller.signal.aborted) send({ type: 'done', total, paginationStop });
  } catch {
    if (!controller.signal.aborted) send({ type: 'error', message: '后台浏览器未完成本次查询' });
  } finally {
    clearInterval(heartbeat);
    res.end();
    busy = false;
  }
});
context.on('close', () => { server.close(); });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => { server.close(); void context.close(); });
}
server.listen(4318, '127.0.0.1');
