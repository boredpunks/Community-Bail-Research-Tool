/** Closed wire contract and actual Python sanitizer; no network or case data. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { validSourceResponse, sourceResponseEvents } from "../src/lib/document-response";

let checks = 0;
const check = (value: unknown) => { assert.ok(value); checks++; };
const message = {
  kind: "response" as const, requestId: "00000000-0000-0000-0000-000000000000",
  status: 401, outcome: "ACCESS_DENIED", retryAfter: null,
  linkCaptureToGetSeconds: 3.25,
  denialEvidence: {status: 401, mediaType: "text/plain", byteCount: 20,
    headers: {"server": "nginx", "retry-after": "120"}, excerpt: "Unauthorized request"},
};
check(validSourceResponse(message));
for (const extra of [{url: "not-retained"}, {dnh: "not-retained"}, {requestHeaders: {}},
  {cookie: "not-retained"}]) check(!validSourceResponse({...message, ...extra}));
for (const extra of [{extra: true}, {status: 403}, {byteCount: -1}, {byteCount: 4_000_002},
  {contentLength: Number.NaN}, {mediaType: "unsafe/type"}, {excerpt: "PRIVATE PERSON"},
  {excerpt: "Unauthorized request ".repeat(20)}, {headers: {"set-cookie": "not-retained"}},
  {headers: {server: "PRIVATE PERSON"}}, {headers: {"www-authenticate": "Bearer credential"}}])
  check(!validSourceResponse({...message, denialEvidence: {...message.denialEvidence, ...extra}}));
for (const elapsed of [-1, NaN, Infinity, "3", {}])
  check(!validSourceResponse({...message, linkCaptureToGetSeconds: elapsed}));
check(validSourceResponse({...message, linkCaptureToGetSeconds: null}));
const events = sourceResponseEvents(message, 2345);
check(events.length === 2);
assert.deepEqual(JSON.parse(events[0]!.message), {
  requestId: message.requestId, durationMs: 2345, linkCaptureToGetSeconds: 3.25,
}); checks++;
check(events[1]!.kind === "DOCUMENT_DENIAL");
check(JSON.parse(events[1]!.message).excerpt === "Unauthorized request");
const success = {...message, status: 200, outcome: "OK", denialEvidence: undefined};
delete success.denialEvidence;
check(sourceResponseEvents(success, 600).length === 1);
for (const duration of [-1, NaN, Infinity]) {
  assert.throws(() => sourceResponseEvents(message, duration)); checks++;
}
// Exercise real Python output, not a hand-coded approximation of its shape.
const wire = spawnSync("python", ["-c", `
import json
from document_diagnostics import denial_evidence
print(json.dumps(denial_evidence(401,
 {"content-type": "text/plain; charset=utf-8", "server": "nginx", "set-cookie": "private",
  "via": "1.1 nginx", "www-authenticate": 'Bearer realm="private"',
  "date": "Wed, 21 Oct 2026 12:00:00 GMT"},
 b"<p>Unauthorized request</p> PRIVATE PERSON")))
`], {encoding: "utf8", env: {...process.env, PYTHONPATH: "src/ujs"}});
assert.equal(wire.status, 0); checks++;
check(validSourceResponse({...message, denialEvidence: JSON.parse(wire.stdout)}));
check(!wire.stdout.includes("PRIVATE"));
console.log(`PASS: ${checks} strict document-response, actual Python redaction, denial propagation and request-timing checks.`);
export const documentResponseChecks = checks;
