set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

install:
	bun install

build:
	bun run --cwd packages/core build
	bun run --cwd packages/pi build

typecheck:
	bun run typecheck

lint:
	bun run lint

format:
	bun run format

test:
	bun run test

e2e:
	bun run test:e2e

rpc-verify: build
	{ echo '{"type":"get_commands","id":"1"}'; sleep 2; } | timeout 30 ${PI_BIN:-pi-bolt} --mode rpc --no-session -ne --offline -e ./packages/pi/dist/index.js

check: typecheck lint test
