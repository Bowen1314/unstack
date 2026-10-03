#!/usr/bin/env bash
# Store the YouCam API key in .env (mode 600) without echoing it, then check it
# against the free balance endpoint. Prints only the key length and the balance.
set -euo pipefail
cd "$(dirname "$0")/.."

read -rsp "YouCam API key (hidden): " KEY; echo
[ -n "$KEY" ] || { echo "empty, nothing saved"; exit 1; }

umask 077
touch .env
chmod 600 .env
KEY="$KEY" python3 - <<'EOF'
import os, re
key = os.environ["KEY"].strip()
lines = [l for l in open(".env").read().splitlines() if not l.startswith("YOUCAM_API_KEY=")]
lines.append(f"YOUCAM_API_KEY={key}")
open(".env", "w").write("\n".join(lines) + "\n")
print(f"saved YOUCAM_API_KEY ({len(key)} chars) to .env")
EOF

KEY="$KEY" python3 - <<'EOF'
import json, os, urllib.request
req = urllib.request.Request(
    "https://yce-api-01.makeupar.com/s2s/v1.0/client/credit",
    headers={"Authorization": "Bearer " + os.environ["KEY"].strip()},
)
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    total = sum(float(x.get("amount_dec", 0)) for x in data.get("results", []))
    print(f"key works: balance {total:g} units")
except urllib.error.HTTPError as e:
    print(f"key check failed: HTTP {e.code} (saved anyway; re-run this script with the right key)")
except Exception as e:
    print(f"key check skipped: {type(e).__name__}")
EOF
