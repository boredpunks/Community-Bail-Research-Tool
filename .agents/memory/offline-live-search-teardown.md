---
name: Offline live-search fixture teardown
description: Cleanup and source-state safeguards when local API search tests are interrupted.
---

An interrupted live-search integration test can leave its test-created search and discovery job active. It can also leave the test's temporary source approval in place because the `finally` cleanup did not run. Treat that approval as simulated test state, not as proof of real source access. The offline integration test also refuses to run while the API worker holds the shared advisory lock; in this workspace, that means the managed API workflow must be stopped briefly before running the fixture.

**Why:** A timed-out offline integration run left a `RUNNING` job and temporary access verification, preventing later searches and risking a false source-access state. The lock check also prevents a fixture from competing with the active worker.

**How to apply:** If the offline fixture reports that the discovery worker is active, stop the managed API workflow, run the fixture to completion, and restart the workflow. After an interrupted test, inspect active jobs, in-flight requests, and source state. Clean only records identifiable as belonging to that exact test run, and restore source access conservatively before retrying. Prefer normal test completion so its `finally` block restores the captured state.

Offline mock scheduler contexts that override `now()` must also provide `sleep()` that advances the simulated clock; otherwise pacing waits never expire.

**Why:** A real sleep does not change the injected clock, so the scheduler repeats the same eligibility calculation indefinitely.

**How to apply:** Pair virtual `now` and `sleep` in offline source tests; keep live worker timing unchanged.
