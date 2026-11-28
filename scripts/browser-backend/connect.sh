#!/usr/bin/env bash
set -euo pipefail
# Run once from the owner's Codespace, after opening its private browser.
repo=acuzpaul-cloud/meta-ads-scraper
[[ "${GITHUB_REPOSITORY:-}" = "$repo" && -n "${CODESPACE_NAME:-}" ]]
curl -fsS --max-time 5 http://127.0.0.1:4318/health >/dev/null
if ! gh codespace ports visibility 6080:private 4318:public -c "$CODESPACE_NAME"; then
  echo "请确认 Ports 中 6080 为 Private、4318 为 Public。" >&2
fi
endpoint="https://${CODESPACE_NAME}-4318.app.github.dev"
# Never publish an address until the authenticated scan gateway is reachable.
curl -fsS --retry 5 --retry-all-errors --max-time 10 "$endpoint/health" | node -e \
  'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(JSON.parse(s).service!=="ad-browser-v1")process.exit(1)})'
file="repos/$repo/contents/.github/ad-browser.json"
prev=$(gh api "$file?ref=master" --jq .sha 2>/dev/null || true)
content=$(printf '{"url":"%s"}\n' "$endpoint" | base64 -w0)
args=()
if [[ -n "$prev" ]]; then args+=(-f "sha=$prev"); fi
gh api "$file" -X PUT -f branch=master -f message="Connect the dashboard to its fixed ad browser" \
  -f "content=$content" "${args[@]}" --silent
echo '后台浏览器已接入。现在可以从原广告观察台查询。'
