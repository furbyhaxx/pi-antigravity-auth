# Troubleshooting

This guide covers the Pi extension. For installation and native Google sign-in, see the [README](../README.md); for vault setup, see [Vault custody](vault.md).

> **Protect credentials.** Do not share Pi's `auth.json`, vault files, OAuth tokens, or raw request/response dumps. Do not delete authentication or vault files as a generic reset.

## The provider is missing or a model is unavailable

- If `/antigravity` is unavailable, the extension has not registered. Check the [installation instructions](../README.md) and reload or restart Pi.
- The extension registers Antigravity models under Pi's `google` provider. Choose a model from the provider's current model list.
- If a request says **“This Antigravity model is no longer offered. Choose another model.”**, that route is retired. Choose another listed model; signing in again does not restore it.

## Local sign-in fails

In the `/antigravity` menu, check **Accounts** and **Routing**. Local mode uses Pi's native Google login, one account at a time. If the menu says you are not signed in, run `/login` and choose Google.

If you see **“Missing Antigravity OAuth access token”**, sign in to the Google account used by Pi, then retry. When the Vault section is serving Antigravity, Pi's own Google login is set aside; follow [Vault custody](vault.md) instead of adding another local login.

## Vault requests are refused

Open `/antigravity` → **Vault** and follow the status shown there. If access is pending, the vault operator must approve the request and grant read access. An approved request with no accounts can also mean the grant reaches no Antigravity login. See [Vault custody](vault.md).

If you see **“Antigravity vault mode is unclear”**, Pi cannot read its mode settings and sends no request. Use the Vault section to resolve the source choice. Do not hand-edit or delete vault files. If the native Google slot is out of sync, Pi refuses rather than sending with the wrong credential. Check the Accounts and Vault sections and follow the available mode-switching or sign-out action.

## A request does not start

A fixed **10-minute pre-response limit** bounds work until successful response headers arrive. It does not limit the response body after headers arrive. On expiry Pi reports:

> Antigravity did not begin a response within the pre-response time limit. Check your connection and try again later.

Check the connection, then retry later. Pi does not record Antigravity quota; a quota refusal comes from Google.

## Paths and credential safety

`PI_AGENT_DIR` and `PI_ANTIGRAVITY_AUTH_FILE` configure the extension's state base and are described in [Configuration](configuration.md). Pi's native `auth.json` is a separate file used for its Google credential slot. Vault custody also keeps the saved native-login backup and mode/roster state in the extension's vault directory. Keep those files private; never paste them into a report or issue.
