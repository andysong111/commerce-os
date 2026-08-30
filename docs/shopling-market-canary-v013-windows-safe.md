# Shopling Market Canary v0.1.3 Windows-safe package

## Problem
Windows Explorer repeatedly failed with `0x80004005` while extracting `background-root.js` from the downloaded Canary ZIP.

## Fix
- keep runtime source JS unchanged in the repository
- package downloadable Chrome-extension scripts as `.mjs`
- rewrite the background `importScripts` target inside the ZIP to the `.mjs` filename
- use ZIP store mode (`level: 0`) for maximum Windows Explorer compatibility
- keep the one-item DM1→도매1 manual-route Canary logic and durable submit-lock safety unchanged

Checkpoint: `checkpoint/shopling-canary-v012-before-windows-safe`.
