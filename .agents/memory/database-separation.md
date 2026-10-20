---
name: Database separation proof
description: Safe target-identity comparison when development uses a Unix socket and production uses TCP.
---

Compare database names and meaningful host fingerprints before authorized
development DDL. If inet_server_addr() is null, do not hash a placeholder and
describe it as a known host.

**Why:** This environment's development SQL connection uses a Unix socket,
while production's read-only connection exposes a TCP server address.
Runtime-managed host variables were not returned by the environment metadata
tool. A null address was a transport property, not evidence of a shared or
different database.

**How to apply:** Query current_database() in both environments. Hash a
type-prefixed inet_server_addr() for TCP or the server's unix_socket_directories
setting for a Unix connection, identifying the fingerprint basis explicitly.
Use database identity and transport together; a socket-directory hash is not
a globally unique machine identity. If distinct targets remain unproven, do
not apply DDL; use a scratch schema and disclose its reduced assurance. Never
print connection strings, credentials, or raw host details.
