---
version: 1
id: "analysis-pi-only-live-verification"
title: "Live verification of the Pi-only package"
description: "Git-install mechanics and live Antigravity calls against the collapsed Pi-only package at commit 61fc343."
type: "analysis"
status: "done"
created: "2026-10-27T08:57:35+01:00"
updated: "2026-10-27T08:57:35+01:00"
createdBy: "pi"
updatedBy: "pi"
---

# Live verification of the Pi-only package

Subject: branch `refactor/pi-only` at `61fc343`, cloned fresh into `/tmp`.

## Git install mechanics

Pi installs git packages with `npm install --omit=dev --omit=peer`
(`pi-coding-agent/dist/core/package-manager.js`). Reproduced on a fresh clone:

- `npm install --omit=dev --omit=peer`: 6 packages, only `@cortexkit/*` runtime
  dependencies; no `@earendil-works/*` peers installed.
- `pi-bolt --mode rpc -ne -e ./src/index.ts` + `get_commands` lists `"name":"antigravity"`.

Limitation: pi-bolt's `install` parser rejects `git://` and `file://` URLs, so the
URL step itself is only exercised by the post-push install from GitHub.

## Live Antigravity calls

`pi-bolt -ne -e ./src/index.ts --no-session --mode json`, real account in Pi's native
`google` OAuth slot. Event summaries (no headers, tokens or bodies) in `captures/`.

| Run | Result |
| --- | --- |
| `antigravity-gemini-3.8-flash`, "pong" | `stop`, text `pong` |
| `antigravity-claude-sonnet-5-5`, "pong" | `stop`, text `pong` |
| Claude 5.5, `--thinking high`, read tool on `./NOTICE` | `toolUse` → `read` → `stop`, text `cortexkit/antigravity-auth` |

The third run covers the multi-turn path: tool call emission, tool result conversion back
into Antigravity contents, and a final answer.
