---
name: Dependency type rebuilds
description: Incremental TypeScript declarations can conceal incompatibilities after dependency major upgrades.
---

Force a rebuild of composite library declarations after a major upgrade to a schema or typing dependency.

**Why:** Incremental checks reused Zod 3 declarations after installing Zod 4, producing a misleading downstream unknown-type error and concealing invalid generated schema methods.

**How to apply:** Run `pnpm exec tsc --build --force` before diagnosing downstream type errors during major dependency upgrades. Regenerate schemas for the installed major, then run the full typecheck and runtime contract tests.
