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

For the embedded Replit preview, a successful password POST is not proof that
the browser retained a usable session cookie. On HTTPS, use a partitioned
`SameSite=None; Secure` workspace cookie, and verify the session endpoint before
the client marks the workspace authenticated.

**Why:** The UI accepted the password, but protected discovery requests still
returned 401 in the embedded preview. A first-party browser flow worked; the
preview needed a partitioned cookie, and the client had trusted the login
response without reading the session back.

**How to apply:** Test password entry, session readback, and a protected
read-only endpoint in one browser context without invoking Search. Never log or
persist the cookie or password. Keep the cookie clear operation partitioned too.

Sanitize browser/API exceptions before they reach tool output; TLS request
errors can include automatically attached Cookie headers even when the script
never explicitly prints credentials.

**Why:** An authenticated acceptance diagnostic exposed its in-memory session
through an unsanitized transport exception.

**How to apply:** Catch errors around authenticated requests and report only
the exception type and nonsecret assertion context. Never print request objects,
raw transport exceptions, headers, or debugging traces containing sessions.
