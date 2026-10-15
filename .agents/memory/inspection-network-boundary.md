---
name: Inspector network boundary
description: Limits and review gates for the form inspector's Linux seccomp egress control.
---

The inspector's process-tree seccomp filter denies non-Unix sockets, but AF_UNIX remains available for Chromium IPC. Do not claim this proves host-level isolation or rules out a Unix-socket proxy/resolver relay.

**Why:** The workspace cannot create a network namespace (`unshare --net` is denied), so the implemented kernel boundary is syscall-based rather than a separate network namespace or host firewall.

**How to apply:** Keep live inspection disabled until the deployed runtime and egress enforcement are attested, Unix-socket host relays are ruled out, and controlled canary attempts are observed at the deployed enforcement point. If that guarantee cannot be made, require a stronger supported host/network boundary.
