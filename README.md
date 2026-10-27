# pi-antigravity-auth

Google Antigravity provider for [Pi](https://github.com/earendil-works/pi-mono). Sign in with
your Google account and use Gemini, Claude and GPT-OSS models through Antigravity's endpoints
instead of a pay-as-you-go API key.

> [!CAUTION]
> **Unofficial integration.** Using Antigravity outside Google's own clients violates Google's
> Terms of Service; accounts have been suspended or banned. Not endorsed by Google or the model
> providers. Never share OAuth tokens, `auth.json`, vault files or raw request dumps.

Fork of [cortexkit/antigravity-auth](https://github.com/cortexkit/antigravity-auth), reduced to
the Pi extension. See [Fork changes](#fork-changes).

## Install

```bash
pi install git:https://github.com/furbyhaxx/pi-antigravity-auth
```

Then `/reload` or restart Pi. The extension ships raw TypeScript; there is no build step. For a
local checkout use `pi install "$PWD"`, or `pi -e ./src/index.ts` for a one-off session.

## Login

```
/login google
```

Pi shows a browser URL. Complete the Google OAuth flow and paste the callback URL (or the
authorization code) back into the prompt. Credentials land in Pi's native `google` slot in
`auth.json` in the Pi agent directory.

The extension replaces Pi's built-in `google` catalog with Antigravity models, so use
Antigravity OAuth for this provider, not a Google AI Studio API key.

`/antigravity` opens the account and vault menu: request Claustrum vault access, select a vault
account, and inspect quota. Details in [docs/vault.md](docs/vault.md).

## Models

Registered under the `google` provider, for example:

- `antigravity-gemini-3.8-flash`, `antigravity-gemini-3.5-flash`
- `antigravity-gemini-4-argon` (requires Google AI Ultra)
- `antigravity-claude-sonnet-5-5`, `antigravity-claude-opus-5-5`
- `antigravity-gpt-oss-120b-medium`

Select one with `/model` or `pi -m google/antigravity-gemini-3.8-flash`. Thinking variants,
limits and retired models are listed in [docs/model-variants.md](docs/model-variants.md).

## Configuration

| Environment variable | Effect |
| --- | --- |
| `PI_AGENT_DIR` | Pi agent directory (default `~/.pi/agent`) |
| `PI_ANTIGRAVITY_AUTH_FILE` | Base path that places `antigravity-auth-vault/` beside it |

More in [docs/configuration.md](docs/configuration.md); failures and recovery in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Fork changes

- Pi only: the OpenCode 1/2 adapters, account pool, sidebar, CLI and upstream release
  infrastructure are removed.
- One flat package (`src/`, `tests/`) loaded as raw TypeScript, installable from git.
- `@cortexkit/common-auth` is a regular npm dependency instead of a vendored copy.

## Development

```bash
bun install
just check        # typecheck + lint + test
just rpc-verify   # load the extension in a real Pi RPC session
```

Contributor rules live in [AGENTS.md](AGENTS.md).

## License

MIT. Upstream copyright and provenance in [LICENSE](LICENSE) and [NOTICE](NOTICE).
