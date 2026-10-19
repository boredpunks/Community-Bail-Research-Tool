---
name: Browser stream integrity
description: Browser interception pitfalls that can hide interrupted responses or redirect transmissions.
---

Do not treat EOF from an intercepted/replaced browser body as proof that the
upstream response completed. Require the original network completion signal and
decoded-byte agreement, failing closed when either is unavailable.

**Why:** Offline Chromium experiments returned stream EOF for a response whose
declared Content-Length exceeded its delivered body. Fulfilling the replacement
would make that incomplete upstream response look complete to the page.

**How to apply:** When changing browser receive/interception strategies, include
an interrupted Content-Length fixture. Test completion using the original
network lifecycle, not the replacement body's lifecycle.

Native Playwright request continuation needs a response-header redirect stop;
do not assume the route handler is called again before a redirect transmission.

**Why:** An offline fixture reached its redirect target without another routing
grant when only request-stage routing was used.

**How to apply:** Keep the header-stage stop and a local redirect fixture that
asserts exactly one actual request. Browser completion can also precede parent
accounting, so passive inspection must wait for accounting to settle.
