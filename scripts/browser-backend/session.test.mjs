import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { scrapeAds } from '../../node_modules/.cache/tucoiva-browser/lib/scraper.js';

const profile = await mkdtemp(path.join(tmpdir(), 'ad-browser-test-'));
const url = 'https://www.facebook.com/ads/library/';
const open = () => chromium.launchPersistentContext(profile, {headless: true});
let context = await open();
async function fixture() {
  await context.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    body: '<script type="application/json" data-sjs>{"ad_archive_id":"1234567","page_name":"Fixture"}</script>',
  }));
}
try {
  await fixture();
  const operator = context.pages()[0];
  await operator.goto(url);
  await operator.evaluate(() => localStorage.setItem('testSession', 'chosen-profile'));
  for (const keyword of ['homary','povison']) {
    const gen = scrapeAds({keyword, country:'ALL', limit:1}, undefined, undefined, undefined, {
      context, signal: new AbortController().signal, waitForScroll: async () => false,
    });
    try {
      assert.equal((await gen.next()).value[0].id, '1234567');
      const tabs = context.pages();
      assert.equal(tabs.length, 2);
      assert.equal(await tabs[1].evaluate(() => localStorage.getItem('testSession')), 'chosen-profile');
    } finally { await gen.return(); }
    assert.deepEqual(context.pages(), [operator]);
  }
  await context.close();
  context = await open();
  await fixture();
  await context.pages()[0].goto(url);
  assert.equal(await context.pages()[0].evaluate(() => localStorage.getItem('testSession')), 'chosen-profile');
  console.log('Both searches reused the operator profile; closing the query tabs and restarting preserved its state.');
} finally {
  await context.close();
  await rm(profile, {recursive:true, force:true});
}
