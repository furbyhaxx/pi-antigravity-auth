# Model Variants

> [!CAUTION]
> Never share OAuth tokens, `auth.json`, vault files, or raw request dumps.

The extension registers models under Pi's `google` provider. For Gemini 4 Argon, Gemini 3.5/3.8 Flash, and Claude 5.5, Pi's reasoning level selects the effort. `minimal` maps to `low`; `xhigh` maps to `high`. Defaults are shown below. These efforts are request settings, not separate entries in the model catalog. See the [README model list](../README.md#models).

| Pi model ID | Effort | Context / output tokens |
| --- | --- | --- |
| `antigravity-gemini-4-argon` | `low`, `medium` (default), `high` | 1,048,576 / 65,536 |
| `antigravity-gemini-3.5-flash` | `low`, `medium` (default), `high` | 1,048,576 / 65,536 |
| `antigravity-gemini-3.8-flash` | `low`, `medium` (default), `high` | 1,048,576 / 65,536 |
| `antigravity-claude-sonnet-5-5` | `low` (default), `medium`, `high` | 1,000,000 / 128,000 |
| `antigravity-claude-opus-5-5` | `low` (default), `medium`, `high` | 1,000,000 / 128,000 |
| `antigravity-gpt-oss-120b-medium` | Medium only | 131,072 / 32,768 |

The registry also contains `antigravity-gemini-3.1-flash-image`, but the Pi chat catalog omits image-output models because Pi's assistant message format cannot represent generated images.

Historical routes for Claude Opus/Sonnet 4.6, Gemini 3.1 Pro, Gemini 3.6/3.7 Flash, and Gemini Pro Agent are rejected rather than redirected. The error is: `This Antigravity model is no longer offered. Choose another model.`
