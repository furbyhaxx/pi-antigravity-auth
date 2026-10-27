# Commands

## `/antigravity`

Open `/antigravity` to inspect how Pi serves Antigravity and manage vault access. The menu has five sections:

| Section | What it shows or does |
| --- | --- |
| Accounts | Shows the local login or vault accounts available to Pi. Pi uses one account at a time. |
| Quota | Explains that Pi does not record Antigravity quota; quota refusals come from Google. |
| Routing | Shows whether requests use Pi's own login or one selected vault account. There is no account rotation. |
| Limits | Explains that Pi has no per-account limits for Antigravity. |
| Vault | Requests vault access, selects or turns vault accounts on or off, switches credential source, or disconnects from the vault. |

In local mode, requests use Pi's native Google login. In vault mode, the menu lets you choose one approved vault account; the vault supplies a fresh token and project for each request. See [Vault custody](vault.md) for enrollment and switching details.

## Pi login commands

Use Pi's native `/login` and `/logout` commands to manage the Google login used in local mode. The `/antigravity` Accounts section reports whether that login is active. Sign-in steps are in the [README](../README.md#login).

Choose Antigravity models through Pi's model picker. See [model variants](model-variants.md) for the available models and thinking variants.

> Never share OAuth tokens, `auth.json`, vault files, or raw request/response dumps. Treat them as credentials.
