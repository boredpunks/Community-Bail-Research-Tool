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
