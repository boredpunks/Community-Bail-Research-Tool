---
name: Pre-POST fixture ordering
description: A Playwright loopback timing detail for exercising the protected Search pacing wait.
---

In the routed Search fixture, a zero-delay form-submit timer can fire before Playwright emits the Search request event. A short delayed timer can run after the request is observed but while the worker is still in its protected wait.

**Why:** Local loopback tests showed that a `RESULT` phase or a zero-delay callback alone cannot prove the error happened during the pre-POST wait.

**How to apply:** When testing this interval, assert the bounded local order `browserRequestStartOrder < eventOrder < postAttemptOrder`; do not infer it from a stage label or timer delay alone.
