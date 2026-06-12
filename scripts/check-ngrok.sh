#!/usr/bin/env bash
# Detects a running ngrok agent by querying its local inspection API
# (http://127.0.0.1:4040). ngrok exposes this interface whenever the agent is
# up, so it's a reliable, dependency-free probe (no `jq`, no `pgrep` parsing).
#
# Prints a single JSON object to stdout, consumed by GET /api/dev/ngrok:
#   {"running":true,"url":"https://xxxx.ngrok.app"}   when a tunnel is up
#   {"running":false,"url":null}                       otherwise
#
# Always exits 0 — "ngrok isn't running" is a normal result, not an error.

API="http://127.0.0.1:4040/api/tunnels"

# Ask ngrok's local web interface for its active tunnels. If ngrok isn't
# running the connection is refused and curl returns an empty string.
response="$(curl -s --max-time 2 "$API" 2>/dev/null)"

# Pull the first https public_url out of the JSON. ngrok's payload is stable
# enough that grep/sed beats taking a hard dependency on jq here.
url="$(printf '%s' "$response" | grep -o '"public_url":"https:[^"]*"' | head -n1 | sed 's/.*"public_url":"//;s/"$//')"

# Fall back to any public_url (e.g. an http-only tunnel) if no https one exists.
if [ -z "$url" ]; then
  url="$(printf '%s' "$response" | grep -o '"public_url":"[^"]*"' | head -n1 | sed 's/.*"public_url":"//;s/"$//')"
fi

if [ -n "$url" ]; then
  printf '{"running":true,"url":"%s"}\n' "$url"
else
  printf '{"running":false,"url":null}\n'
fi
