import { readFile } from 'node:fs/promises';

export async function browserEndpoint(path = '.github/ad-browser.json') {
  let file;
  try { file = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const { url } = JSON.parse(file);
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+-4318\.app\.github\.dev$/.test(url)) {
    throw Error('Invalid fixed browser address');
  }
  return url;
}

export async function scanWithBrowser(endpoint, id, options) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', 'tucoiva-browser/' + id);
  const identity = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!identity.ok) throw Error('Fixed browser identity unavailable');
  const { value } = await identity.json();
  const res = await fetch(endpoint + '/scan/' + id, {
    ...options, redirect: 'error',
    headers: { ...options.headers, 'X-Ad-Workflow-Identity': 'Bearer ' + value },
  });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('text/event-stream')) {
    await res.body?.cancel();
    throw Error('Fixed browser unavailable');
  }
  return res;
}
