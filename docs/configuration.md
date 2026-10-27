# Configuration

The extension uses Pi's native Google credential in local mode. It has no user-edited plugin settings file: use `/antigravity` → Vault to choose local credentials or approved vault custody.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PI_AGENT_DIR` | Sets the extension state directory; defaults to `~/.pi/agent`. This does not relocate Pi's native `auth.json`. |
| `PI_ANTIGRAVITY_AUTH_FILE` | Sets the path used to locate extension vault state. By default it is `<PI_AGENT_DIR>/antigravity-accounts.json`; the vault directory is placed beside that path. |

## Credential and state locations

| Data | Location or behavior |
| --- | --- |
| Native Google login | Pi's agent directory `auth.json`, in the native `google` credential slot. Pi's `/login` and `/logout` manage this credential. |
| Extension vault state | `antigravity-auth-vault/` beside `PI_ANTIGRAVITY_AUTH_FILE`; by default `~/.pi/agent/antigravity-auth-vault/`. |
| Mode and account roster | `pi-mode.json` selects local or vault mode. `pi-roster.json` contains account references, not tokens. |
| Saved Google login in vault mode | `google-login-stash.json` in the vault directory holds the native login while the vault uses Pi's Google slot. Switch back through `/antigravity` → Vault; do not edit custody files by hand. |

The native login path is resolved by Pi. `PI_AGENT_DIR` and `PI_ANTIGRAVITY_AUTH_FILE` configure extension state and do not redirect Pi's native credential store.

Local mode uses one native Google login at a time. Vault mode uses an approved vault account selected in the menu; it does not rotate through accounts or record quota for account selection. See [commands](commands.md), [Vault custody](vault.md), and [model variants](model-variants.md). For failures and recovery, see [troubleshooting](troubleshooting.md).

> Keep OAuth credentials, Pi's `auth.json`, vault files, and raw request/response dumps private. Never commit or share them. Filesystem permissions are not encryption.
