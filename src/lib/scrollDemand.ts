// Only dashboard-dispatched runs wait for a browsing gesture. Manual exports keep scanning.
export function scrollWaiter(id?: string, signal?: AbortSignal) {
  let consumed = 0;
  return async (end: number): Promise<boolean> => {
    if (!id) return true;
    const until = Math.min(end, Date.now() + 90000);
    while (!signal?.aborted && Date.now() < until) {
      try {
        const response = await fetch('https://tucoiva-ad-query.acuzpaul-cloud.workers.dev/demand?requestId=' + encodeURIComponent(id), {
          cache: 'no-store', signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const { demand } = await response.json();
          if (Number.isSafeInteger(demand) && demand > consumed) {
            consumed = demand;
            console.log('[scraper] dashboard scroll', consumed);
            return true;
          }
        }
      } catch { /* Transient network errors leave the pending gesture intact. */ }
      await new Promise(resolve => setTimeout(resolve, 850));
    }
    return false;
  };
}
export const waitForScroll = scrollWaiter(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? process.env.AD_REQUEST_ID : undefined);
