# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Package renamed to `@furbyhaxx/pi-antigravity-auth` and installed from git.** Install with `pi install git:https://github.com/furbyhaxx/pi-antigravity-auth`; the npm package `@cortexkit/pi-antigravity-auth` is no longer the source. Provider ID, model IDs and stored credentials are unchanged.
- **Ships raw TypeScript from `src/index.ts`.** No build step and no `dist/`; the engine formerly published as `@cortexkit/antigravity-auth-core` is part of this package.
- **`@cortexkit/common-auth` 0.26.0 is a regular dependency** instead of a vendored, hash-pinned copy.
- **Development types target Pi 1.3.**

### Removed

- **OpenCode 1 and OpenCode 2 adapters**, the OpenCode account pool, sidebar, `antigravity-auth` CLI, setup installer, e2e harness and upstream release/CI tooling. Pi never used them.

### Fixed

- On Pi 0.86 and newer, requests now include the system prompt and tool declarations again. Pi now delivers them as system messages in the conversation, and the extension replays them with pi-ai's own helpers, including later prompt additions, section updates, and tool additions or removals. Older Pi versions keep working unchanged.
- Conversations without a Pi session ID no longer share Antigravity request metadata on Pi 0.86 and newer.
