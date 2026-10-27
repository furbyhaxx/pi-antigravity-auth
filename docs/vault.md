# Claustrum vault custody

The Pi extension can serve Antigravity from Pi's native Google login (**local mode**) or from an approved Claustrum vault (**vault mode**). They do not serve together. Pi uses one account at a time and does not rotate accounts or record quota. For errors, see [Troubleshooting](troubleshooting.md).

## Request and use vault access

1. In Pi, open `/antigravity` → **Vault** and choose **Request vault access**.
2. The vault operator finds and approves Pi's request, then grants read access to Antigravity accounts. Both are required. Run these commands in the vault environment, not in Pi:

   ```sh
   ck auth enroll list
   ck auth enroll approve --request-id <id>
   ck auth grant --principal enrolled:antigravity-auth-pi --selector-kind category --selector antigravity-native --operation read
   ```

3. When Pi sees approval it activates vault mode. If the Vault section offers **Use the vault**, choose it. Then choose **Use this account** for the account Pi should serve. The active row is marked **in use by Pi**. Turn an account off or back on for this computer with **Turn off for Pi** or **Turn back on for Pi**.

An approved request with no accounts usually means read access is missing or does not match an Antigravity login. Check the grant with the operator. If a grant reaches no Antigravity login, the operator can run `ck auth reclassify --from-registry`, then `ck auth status` to inspect the vault's accounts.

## Credential handling

In vault mode, the extension replaces Pi's native `google` credential slot in `auth.json` with a non-secret marker and saves the previous Google login in `google-login-stash.json`. Antigravity requests use the selected vault account, with a fresh token and project from the vault for each send. Pi does not use the saved login as a fallback. If the native Google slot still contains a login while vault mode is active, requests are refused; use the Vault section's recovery action.

To return to local mode, choose **Disconnect from the vault** in the Vault section. Pi removes this computer's enrollment and returns to its own login. The vault operator's approval remains until revoked there. Restoration will not overwrite a native Google login changed by another process. If Pi reports a slot conflict, resolve it before using the saved login.

Never copy or edit the custody marker, `auth.json`, `google-login-stash.json`, vault enrollment credentials, or roster by hand. Do not delete these files as a reset; use the menu actions.

## Files and paths

| Purpose | Location |
| --- | --- |
| Pi's native Google credential | Pi's `auth.json`, in the native `google` provider slot |
| Extension state base | `PI_AGENT_DIR` (default `~/.pi/agent`) and `antigravity-accounts.json`; `PI_ANTIGRAVITY_AUTH_FILE` overrides the base file path |
| Vault state directory | `antigravity-auth-vault/`, beside the extension state base file |
| Vault mode and account roster | `pi-mode.json` and `pi-roster.json` inside the vault state directory |
| Saved native-login backup | `google-login-stash.json` inside the vault state directory |

The extension state paths are separate from Pi's native `auth.json`. Keep all credential and vault files private. See [Configuration](configuration.md) for the environment variables.
