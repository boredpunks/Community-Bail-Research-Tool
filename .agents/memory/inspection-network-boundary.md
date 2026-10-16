---
name: Inspector network boundary
description: Limits and review gates for the form inspector's Linux seccomp egress control.
---

The operator-controlled workspace is the first inspection-readiness review target. Keep a separate environment-specific deployed-readiness gate for any future deployed execution; workspace evidence never proves deployed readiness. Keep live inspection disabled and preserve all separate source/run approvals.

**Why:** The user explicitly chose workspace-first review and rejected treating that evidence as deployed proof. The workspace cannot create a network namespace, so syscall/channel evidence must not be described as complete host isolation.

**How to apply:** Review the workspace locally without source contact or opening Docker/Replit service sockets. See `docs/inspection-broker-workspace-review.md` for the channel assessment and explicit remaining gates. Require stronger supported isolation if the intended threat model cannot be established.

Allowing AF_UNIX alone is not enough to exclude named host relays: datagram socket pairs can address a third endpoint without connect(). Conversely, denying every socket() breaks the pinned Chromium profile singleton.

**Why:** Controlled local tests demonstrated both behaviors. A visible writable host socket proves permissions, not relay behavior; never probe host services to settle that question.

**How to apply:** Any future sandbox redesign must account for datagram sendto/sendmsg as well as connect(), preserve required browser IPC, and repeat local canary tests. Do not assume all Unix socket pairs are fixed-peer.

The broker, sandbox/seccomp and form-inspection v3 work is paused. Leave live inspection disabled and do not add safety infrastructure or new one-time permit types for the completion effort.

**Why:** The user directed completion toward selectable searches and staged PDF verification; this infrastructure guards a switched-off three-request check that is not needed for that definition of done.

**How to apply:** Preserve the existing disabled controls without expanding them. Follow the ordered offline work and explicit stop points in the user's completion instructions; ask before continuing when a reproduction differs from its hypothesis or an expected passing test fails. Live requests and barrier clearing require their own approvals.
