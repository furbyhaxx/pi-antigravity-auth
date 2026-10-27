# AGENTS.md — pi-antigravity-auth

Pi package (`@furbyhaxx/pi-antigravity-auth`): a custom Pi provider serving Gemini, Claude and
GPT-OSS through Google Antigravity OAuth, plus the `/antigravity` account and vault menu. Fork
of `cortexkit/antigravity-auth`, reduced to the Pi extension and developed independently (no
upstream merges). These instructions apply to the whole repository.

## Project goals

In priority order:

1. **Working Pi provider.** Login, model catalog, streaming, thinking variants and tool calls
   behave like a native Pi provider. A regression there outranks everything else.
2. **Correct, honest failures.** Quota, rate-limit and auth errors name the account state, the
   endpoint, the status and a recovery action. Never swallow a parse error or invent a value.
3. **No credential leaks.** Tokens, refresh tokens, cookies and vault files appear in no log,
   output, test fixture, doc or commit.
4. **Cheap on the hot path.** No avoidable latency per request or per stream chunk. Measure
   before and after; prefer Bun-native APIs.
5. **Pi-native surface.** One `/antigravity` command family, nothing bolted on beside it.
6. **Testable core.** Transforms, sanitizers, conversion and custody state are plain functions
   over plain data; Pi wiring stays thin.

## Tech stack

- Bun `1.4.3` (`.bun-version`, `packageManager`); `bun test` for tests.
- TypeScript `7.0.2` with the strictness flags in `tsconfig.json`, erasable syntax only,
  explicit `.ts` import specifiers.
- Biome `2.5.15`: tabs, 100 columns, no `any`, no non-null assertions.
- Pi APIs (`@earendil-works/pi-ai`, `-pi-coding-agent`, `-pi-tui`) as `peerDependencies: "*"`,
  pinned exactly in `devDependencies`. Development types target Pi 1.3; terminal acceptance
  uses Pi-Bolt.
- Runtime dependencies: `@cortexkit/common-auth`, `@cortexkit/claustrum-client`,
  `@cortexkit/subc-client`. A new runtime dependency needs user approval.
- `Justfile` is the command surface.

## Commands and completion criteria

`just check` (typecheck + lint + test) is the required gate. Single steps: `just typecheck`,
`just lint`, `just test`, `just format`. `just rpc-verify` loads the extension in a real Pi RPC
session (`PI_BIN`, default `pi-bolt`).

- Run `just check` after code changes and fix every error and warning. Docs-only changes do not
  need it.
- Never claim a check passed unless it ran in this session and you read its output.
- `just rpc-verify` is required after changing provider or command registration, event wiring,
  the OAuth flow or credential-slot handling.
- Live Antigravity verification is authorized and expected, on any configured account. Capture
  request and response as evidence with secrets redacted; a mock never proves a provider path.
- Changes to `/antigravity` panels need a live Pi-Bolt terminal pass (tmux capture or
  equivalent) at the widths in the TUI section. Captures go to
  `.project/analyses/<slug>/captures/`.
- Implement, validate and QA fully before claiming completion or pushing. Do not defer or leave
  items open unless the user explicitly asks for it.

## Repository shape

```text
src/
  index.ts            Pi entrypoint: provider registration (local, vault custody, refusing)
  commands.ts         /antigravity command wiring
  stream.ts           Antigravity stream for Pi; convert.ts maps Pi context to Gemini contents
  vault-setup.ts      Claustrum vault enrollment and native credential-slot custody
  vault-source.ts     vault account source; credential-cache.ts, paths.ts
  core/               engine: OAuth, transport, request metadata, model registry, transforms,
                      fingerprint, quota presentation, vault state, command menu
tests/                bun:test suite mirroring src/; setup.ts preload, support/, fixtures/
docs/                 end-user documentation
.project/             development artifacts
README.md, CHANGELOG.md, LICENSE, NOTICE, AGENTS.md
```

- Split a module by responsibility, not by line count; ~400 lines is the point where a module is
  doing two jobs.
- Tests live in `tests/`, mirroring `src/`, never beside the source. `tests/fixtures/` holds
  captured Antigravity CLI payloads; keep them byte-for-byte as captured.
- The package ships raw TypeScript: `pi.extensions` points at `./src/index.ts` and `files` ships
  `src/`. Do not add a build step or a compiled entrypoint.
- Import `@earendil-works/*` only through specifiers Pi's extension loader aliases
  (`pi-ai`, `pi-ai/compat`, `pi-ai/oauth`, `pi-coding-agent`, `pi-tui`); anything else resolves
  against this package's own `node_modules` and mixes Pi versions.

## Not yet aligned

This file describes the target state.

- `src/vault-setup.ts` (838), `src/stream.ts` (902), `src/core/transform/gemini.ts` (955) and
  `src/core/vault-provider-state.ts` (667) exceed the module-size rule.
- Pi files import the engine through the `src/core/index.ts` barrel; tests mock that barrel.
  Direct module imports would cut load cost but need the mocks retargeted.

Fix these in dedicated `refactor:` commits, not inside feature work. Delete each line when it is
done, and the section when it is empty.

## Design invariants

Upstream design is preserved in `.project/research/upstream-architecture/report.md`; the wire
contract in `.project/research/antigravity-api-spec/report.md`. The rules that bite:

- Claude: strip all thinking blocks from outgoing requests; Claude regenerates them.
- Interrupted tool calls get synthetic `tool_result` blocks so the session recovers.
- Tool schemas pass the allowlist sanitizer (`const`, `$ref`, `$defs` removed or converted).
- Fingerprints are per account; only `User-Agent` is composed from them
  (`buildFingerprintHeaders()`).
- Retired models refuse before credential acquisition or transport; never alias them.
- Vault custody: the native `google` slot is swapped for a non-secret marker and restored only
  when the slot still holds that marker. Never overwrite a slot another process changed.
- Every request honors the caller's `AbortSignal` with a bounded timeout. The extension must
  never hang a turn.
- Resolve paths through `src/paths.ts` and `ctx.cwd`, never `process.cwd()`.

## Slash commands and panels

- `/antigravity` is the only command family. Commands with arguments provide
  `getArgumentCompletions`; subcommands accept forgiving aliases; unknown input reports the usage
  line and the closest valid names.
- Headless-safe: gate panels on `ctx.mode === "tui" && ctx.hasUI`. Without a TUI, read-only
  output still renders as text; interactive-only actions say they need the TUI.
- Feedback goes through `ctx.ui.notify` with the right tone (`info`, `warning`, `error`).
- Keys come from the user's keybindings, never hardcoded; hint rows show the bound keys. Enter
  confirms, Esc goes back one level, Ctrl+C dismisses.
- A panel or refresh belongs to the session that started it; after shutdown, late results must
  not change UI state.
- New surfaces or layout changes are the user's call. Show rendered frames (captures at the
  check widths, or an HTML mock for larger designs) before settling a new layout.

### TUI widths

- Use theme tokens and Pi's ANSI-aware helpers (`visibleWidth`, `truncateToWidth`,
  `wrapTextWithAnsi`). Never measure layout with `String.length`.
- Every rendered line fits the width. Check 36, 57, 80 and 140 columns when touching layout.
- Color is never the only signal: pair stress colors with a glyph, a number or a word.
- Strip control characters from provider-supplied text before rendering it.

## Code conventions

- Explicit, readable code over clever code; descriptive names; early returns; no dead code; no
  boilerplate comments.
- Types describe reality: no `any`, no non-null assertions, no casts to silence the compiler,
  no `@ts-ignore` or `@ts-expect-error`. Fix the type instead.
- `node:` protocol imports; `import type` for type-only imports; named exports, except the Pi
  entry's default export; kebab-case file names.
- Validate unknown input once at the boundary that owns it, then stay typed inside.
- Errors carry context: what failed, where, and a recovery action. Catch only what you can act
  on; no empty catch blocks.
- No compat shims or feature flags in place of changing the code and its callers. Stored
  formats (Pi's `auth.json` slot, vault state files) are the exception: change them only with a
  reader for the old form.
- Comments state constraints and non-obvious reasons, never restate the code.

## Testing

- `bun:test` only; `tests/setup.ts` isolates env and temp roots. Assert observable behavior:
  transformed requests, converted messages, stream events, custody state transitions.
- Every new transform, parser or custody branch needs a case that fails when it breaks.
- No network and no real credentials in the suite: fake the transport and use captured fixtures.
- Determinism: inject clocks (`jest.setSystemTime`, patched to cover `Date.now()`) and ids.
- A regression fix gets a test that reproduces it.
- Live provider and terminal verification are separate from the suite and never replace it.

## Git and delivery

- Conventional Commits, granular, English. Stage explicit paths; never `git add -A` or
  `git add .`.
- Never run `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`,
  `git commit --no-verify`, or force-push. Never stage, revert or stash files you did not change.
- The extension is installed from `git:https://github.com/furbyhaxx/pi-antigravity-auth`, so
  unpushed work never reaches a session. After `just check` and the relevant live verification
  pass, merge to `main`, push, then run `pi-bolt update --extensions`. That sequence is the
  authorized default; do not ask again for it.
- Delete worktrees and their branches once merged and no longer needed.
- Version bumps, tags and publishing stay with the user.

## Documentation sync

| File | Covers |
|---|---|
| `README.md` | overview, install, login, models, fork changes |
| `docs/` | configuration, commands, models, vault, troubleshooting |
| `CHANGELOG.md` | user-visible changes |
| `NOTICE`, `LICENSE` | upstream provenance and copyright |
| `AGENTS.md` | this file, when a convention changes |
| `.project/` | research and design artifacts behind a decision |

Adding or removing a command, setting key, environment variable, model family or storage
location is a docs change in the same commit. Keep every Markdown file under 500 lines;
inherited upstream artifacts in `.project/` are exempt.

## Changelog

`CHANGELOG.md`, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

- New entries go under `## [Unreleased]` in the right subsection (`### Added`, `### Changed`,
  `### Fixed`, `### Removed`, `### Security`). Read the section first and append; never
  duplicate a subsection.
- One bullet per change: a bold lead-in on what changed, then why and what a user must do.
- Released version sections are immutable.

## Development artifacts

Plans, designs, research, analyses, reviews and ideas are development artifacts. They live in
`.project/`, never in `docs/`, and are committed.

```text
.project/
  research/<slug>/report.md     external facts, API contracts, prior art
  designs/<slug>/design.md      architecture and UX decisions
  plans/<slug>/plan.md          current and next slice only; later work stays sparse
  analyses/<slug>/report.md     root causes, QA passes, measurements
  reviews/<slug>/review.md      independent reviews of a design or diff
  ideas/<slug>/idea.md          captured ideas not yet scheduled
```

- One directory per topic slug. Evidence (captures, logs, request/response dumps with secrets
  redacted, fixtures) sits beside the report in the same slug directory.
- Every artifact starts with YAML frontmatter, every value quoted:

  ```yaml
  ---
  version: 1
  id: "analysis-<slug>"
  title: "..."
  description: "..."
  type: "analysis"
  status: "draft"            # optional: draft, accepted, superseded, done
  created: "<date -Iseconds>"
  updated: "<date -Iseconds>"
  createdBy: "pi"
  updatedBy: "pi"
  ---
  ```

- Bump `version` and `updated` on every substantive revision. Mark replaced artifacts
  `status: "superseded"` and link the successor instead of deleting them.
- Reference artifacts by relative path, from chat and from other artifacts.
- Artifacts inherited from upstream (`createdBy: "cortexkit-upstream"`) describe the former
  monorepo; treat their paths as historical.

## Self-maintenance

This extension serves Antigravity models in the user's Pi sessions. If login, streaming or
vault custody misbehaves live, reproduce with `pi-bolt -e ./src/index.ts`, confirm loading with
`just rpc-verify`, and fix it here: provider and commands in `src/`, transport, transforms and
models in `src/core/`.

## What to avoid

- Never print, log or commit real tokens, `auth.json` contents, vault files or raw request dumps.
- Never touch the user's real Pi `auth.json` or vault state in tests.
- No new runtime dependencies, frameworks or model-facing tools without user approval.
- Never weaken type safety or a test to get a check green.
- No hardcoded machine-specific paths, agent dirs or credentials.
- No stubs, placeholders or TODOs presented as finished work.
- No drive-by refactors, reformatting or dependency upgrades inside an unrelated change; raise
  them instead.

## User override

If the user's instructions conflict with a rule here, name the rule and the conflict, get
confirmation, then follow the user.
