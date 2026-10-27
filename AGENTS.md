# AGENTS.md — pi-antigravity-auth

Fork of `cortexkit/antigravity-auth`, developed independently for Pi (no upstream merges).
Pi package `@cortexkit/pi-antigravity-auth` (`packages/pi`): a custom Pi provider serving
Gemini, Claude and GPT-OSS through Google Antigravity OAuth, on the shared engine in
`packages/core`. These instructions apply to the whole repository.

## Project goals

In priority order:

1. **Working Pi provider.** Login, model catalog, streaming, thinking variants and tool calls
   behave like a native Pi provider. A regression there outranks everything else.
2. **Correct, honest failures.** Quota, rate-limit and auth errors name the account state,
   the endpoint, the status and a recovery action. Never swallow a parse error or invent a
   value.
3. **No credential leaks.** Tokens, refresh tokens, cookies and account files appear in no
   log, output, test fixture, doc or commit.
4. **Cheap on the hot path.** No avoidable latency per request or per stream chunk. Measure
   before and after; prefer Bun-native APIs.
5. **Pi-native surface.** One `/antigravity` command family, nothing bolted on beside it.
6. **Testable core.** Transforms, sanitizers, rotation and storage are plain functions over
   plain data; Pi wiring stays thin.

## Tech stack

- Bun workspace (`packages/*`); `bun test --isolate`. Toolchain pins in `mise.toml`.
- TypeScript, strict plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, explicit `.ts`
  import specifiers, no path aliases.
- Biome per `biome.jsonc`: 2 spaces, single quotes, no semicolons, trailing commas. Lefthook
  runs Biome on staged files.
- Pi APIs (`@earendil-works/pi-*`) as `peerDependencies: "*"`, pinned in devDependencies.
- `zod` v4 at boundaries. Runtime deps of `packages/pi`: core, `claustrum-client`,
  `subc-client`. A new runtime dependency needs user approval.
- `packages/pi` ships `dist/` built with esbuild; build before loading it in Pi.
- `Justfile` is the command surface; it wraps the `bun run` scripts.

## Commands and completion criteria

`just check` (typecheck + lint + test) is the required gate. Single steps: `just typecheck`,
`just lint`, `just test`, `just format`, `just build` (core + pi), `just e2e`.
`just rpc-verify` builds and loads the Pi extension in a real Pi RPC session (`PI_BIN`,
default `pi-bolt`).

- Run `just check` after code changes and fix every error and warning. Docs-only changes do
  not need it.
- Never claim a check passed unless it ran in this session and you read its output.
- `just rpc-verify` is required after changing provider or command registration, event
  wiring, the OAuth flow or settings persistence.
- `just e2e` after changes to request transforms, streaming or message conversion.
- Live Antigravity verification is authorized and expected, on any configured account. Capture
  request and response as evidence with secrets redacted; a mock never proves a provider path.
- Changes to `/antigravity` panels need a live Pi-Bolt terminal pass (tmux capture or
  equivalent) at 36, 57, 80 and 140 columns. Captures go to
  `.project/analyses/<slug>/captures/`.
- Implement, validate and QA fully before claiming completion or pushing. Do not defer or
  leave items open unless the user explicitly asks for it.

## Repository shape

```text
packages/
  core/        harness-agnostic engine: OAuth, accounts, rotation, quota, transport,
               transforms, model registry
  pi/          Pi adapter: provider, stream, convert, commands, credential cache, vault
  opencode/    inherited OpenCode 1/2 adapter; kept, not developed (see below)
  e2e-tests/   deterministic e2e flows and the mock Antigravity server
test/          shared preload (test/setup.ts) and cross-package tests
scripts/, tools/   build, embed and gate scripts
ARCHITECTURE.md, STRUCTURE.md   architecture and file map
.project/      development artifacts
```

- Tests are colocated as `*.test.ts`; e2e tests are `*.e2e.test.ts`.
- Split a module by responsibility, not by line count; ~400 lines means it does two jobs.
- `src/common-auth-embedded`, `tui-*-compiled` and `tui-*-raw` are generated or vendored.
  Never hand-edit them; `bun run embed:check` guards them.
- `packages/opencode` is kept but not developed: no features or fixes there unless the user
  asks. Core changes must not break its tests; if keeping it green costs real effort, raise
  removing it instead.

## Design invariants

Full design in `ARCHITECTURE.md`. The rules that bite:

- Claude: strip all thinking blocks from outgoing requests; Claude regenerates them.
- Interrupted tool calls get synthetic `tool_result` blocks so the session recovers.
- Tool schemas pass the allowlist sanitizer (`const`, `$ref`, `$defs` removed or converted).
- Rate-limit and quota errors rotate accounts instead of failing the turn. Gemini has two
  quota pools (Antigravity and Gemini CLI headers).
- Fingerprints are per account in `antigravity-accounts.json`; only `User-Agent` is composed
  from them (`buildFingerprintHeaders()`).
- Account storage writes are lock-held read-modify-write; unreadable storage fails closed and
  is never overwritten.
- Every request honors the caller's `AbortSignal` with a bounded timeout. The extension must
  never hang a turn.
- Resolve paths through `packages/pi/src/paths.ts` and `ctx.cwd`, never `process.cwd()`.

## Pi surface

- `/antigravity` is the only command family. Commands with arguments provide
  `getArgumentCompletions`; subcommands accept forgiving aliases; unknown input reports the
  usage line and the closest valid names.
- Headless-safe: gate panels on `ctx.mode === "tui" && ctx.hasUI`. Without a TUI, read-only
  output still renders as text; interactive-only actions say they need the TUI.
- Feedback goes through `ctx.ui.notify` with the right tone (`info`, `warning`, `error`).
- Keys come from the user's keybindings, never hardcoded. Enter confirms, Esc goes back one
  level, Ctrl+C dismisses.
- Use theme tokens and Pi's ANSI-aware helpers (`visibleWidth`, `truncateToWidth`,
  `wrapTextWithAnsi`); never measure layout with `String.length`. Every line fits the width.
- Color is never the only signal. Strip control characters from provider-supplied text.
- A panel or refresh belongs to the session that started it; late results must not change UI
  state after shutdown.
- New surfaces or layout changes are the user's call. Show rendered frames first.

## Code conventions

- Explicit, readable code over clever code; descriptive names; early returns; no dead code.
- Named exports only, except where a host requires a default export. `import type` for
  type-only imports; kebab-case file names; `createLogger("module")` for logging.
- No `any`, `@ts-ignore`, `@ts-expect-error`, non-null assertions or casts to silence the
  compiler. Fix the type instead.
- Validate unknown input once at the boundary that owns it (zod), then stay typed inside.
- Errors carry context; catch only what you can act on; no empty catch blocks.
- No compat shims or feature flags for removed behavior: change the code and update callers.
- Comments state constraints and non-obvious reasons, never restate the code.

## Testing

- `bun:test` only; `test/setup.ts` isolates env and temp roots. Assert observable behavior:
  transformed requests, converted messages, rotation decisions, storage state.
- Every new transform, parser or rotation branch needs a case that fails when it breaks.
- No network and no real credentials in the suite; use the mock Antigravity server and fake
  transports.
- Determinism: inject clocks (`jest.setSystemTime`, patched to cover `Date.now()`) and ids.
- A regression fix gets a test that reproduces it. Live runs never replace the suite.

## Git and delivery

- Conventional Commits, granular, English. Stage explicit paths; never `git add -A` or
  `git add .`.
- Never run `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`,
  `git commit --no-verify`, or force-push. Never stage, revert or stash files you did not
  change.
- The extension is installed from `git:https://github.com/furbyhaxx/pi-antigravity-auth`, so
  unpushed work never reaches a session. After `just check` and the relevant live verification
  pass, merge to `main`, push, then run `pi-bolt update --extensions`. That sequence is the
  authorized default; do not ask again for it.
- Delete worktrees and their branches once merged and no longer needed.
- Version bumps, tags and publishing stay with the user. Inherited release tooling
  (`release.yml`, `RELEASING.md`, `scripts/release.sh`) is not run here.

## Documentation sync

| File | Covers |
|---|---|
| `README.md` | fork overview, Pi install, fork changes |
| `packages/pi/README.md` | Pi install, login, commands, models |
| `packages/pi/CHANGELOG.md` | user-visible Pi changes |
| `ARCHITECTURE.md`, `STRUCTURE.md` | architecture and file map; update with structural changes |
| `AGENTS.md` | this file, when a convention changes |

Adding or removing a command, setting key, model family or storage location is a docs change
in the same commit. Keep every fork-authored Markdown file under 500 lines.

## Changelog

`packages/pi/CHANGELOG.md`, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

- New entries go under `## [Unreleased]` in the right subsection (`### Added`, `### Changed`,
  `### Fixed`, `### Removed`, `### Security`). Read the section first and append; never
  duplicate a subsection.
- One bullet per change: what changed, then why or what a user must do.
- Released version sections are immutable.

## Development artifacts

- `.project/{research,designs,plans,analyses}/<slug>/`, never `docs/`.
- Every artifact starts with YAML frontmatter: `version`, `id`, `title`, `description`,
  `type`, `created`, `updated`, `createdBy`, `updatedBy` (ISO 8601, Europe/Zurich).
- Reference artifacts by relative path.

## Not yet aligned

This file describes the target state.

- Git install is unproven: `packages/pi` loads from a gitignored `dist/` and depends on the
  workspace `core` package, so `pi install git:...` likely yields a package that cannot load.
- `embed:check` (OpenCode TUI check) requires exactly Bun 1.4.2, while `mise.toml` pins 1.3
  and the host runs 1.4.3. Root `build`, `typecheck`, `lint` and `test` all run it, so
  `just check` fails before checking anything. `just build` builds only core and pi.

Fix these in dedicated commits and delete each line when done.

## Self-maintenance

This extension serves Antigravity models in the user's Pi sessions. If login, streaming or
rotation misbehaves live, reproduce with `just build` and
`pi-bolt -e ./packages/pi/dist/index.js`, confirm loading with `just rpc-verify`, and fix it
here: provider and commands in `packages/pi/src`, transport, rotation and transforms in
`packages/core/src`.

## What to avoid

- Never print, log or commit real tokens, account files or raw request dumps.
- Never touch the user's real `antigravity-accounts.json` or Pi auth in tests.
- No new runtime dependencies, frameworks or model-facing tools without user approval.
- Never weaken type safety or a test to get a check green.
- No stubs, placeholders or TODOs presented as finished work.
- No drive-by refactors, reformatting or dependency upgrades inside an unrelated change.

## User override

If the user's instructions conflict with a rule here, name the rule and the conflict, get
confirmation, then follow the user.
