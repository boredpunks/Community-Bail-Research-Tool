---
name: pnpm CLI argument forwarding
description: Argument forwarding differs from the familiar npm run separator convention.
---

Pass subcommands directly after `pnpm run <script>` in this workspace, without an extra standalone `--`.

**Why:** The extra separator was forwarded unchanged, so an operator CLI interpreted it as the command and rejected an otherwise valid invocation before any source traffic.

**How to apply:** For operator CLIs, use `pnpm --filter <package> run <script> <command> <options>`. Do not assume npm-style separator handling.
