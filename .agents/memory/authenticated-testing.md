---
name: Authenticated test execution
description: Secure acceptance testing when the persistent browser runtime lacks the shell environment.
---

When shared-password acceptance cannot log in because the persistent browser
runtime lacks the configured environment, use the installed Python Playwright
from the shell in a single process. Authenticate with `browser_context.request`
and browse with that same context; its cookies are shared in memory.

**Why:** The persistent browser runtime could not read process environment
variables, while the shell already had the configured application secrets.
Transferring the password or session through tool output or files is unnecessary
and exposes credentials.

**How to apply:** Let the login script consume the configured secret directly;
never print it, log request bodies, save cookies/storage state, or add an
authentication bypass. Retain only nonsecret assertions and screenshots after
login. Use the app's actual authentication, not unused auth-provider credentials.

When Playwright cannot find its bundled browser, check for an installed system
Chromium before downloading another browser.

**Why:** This workspace had a usable Nix Chromium even though Playwright's own
browser cache was empty.

**How to apply:** Launch the process-level test with the discovered executable
path; keep authentication and cookies in the same in-memory browser context.
