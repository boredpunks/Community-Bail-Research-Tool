import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  BrokerTimeoutError, InspectionFetchBroker, INSPECTION_BROKER_MAX_BYTES,
  INSPECTION_BROKER_ORIGIN as origin, isPublicIpv4,
} from "../src/lib/inspection-fetch-broker";

// All transports in this file are in-memory fixtures. Never use the default
// transport, DNS, source sockets, real permits, or case/docket records.
export async function runInspectionBrokerChecks() {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.168.1.1",
    "172.16.0.1", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1"]) {
    assert.equal(isPublicIpv4(address), false);
  }
  assert.equal(isPublicIpv4("8.8.8.8"), true);
  const documentUrl = `${origin}/CaseSearch`;
  const js = `${origin}/resource/js/sitemain.min.js?v=abcdefghijklmnop`;
  const css = `${origin}/resource/css/sitemain.min.css?v=qrstuvwxyzABCDEF`;
  const html = Buffer.from(`<html><script src="${js}"></script><link rel="stylesheet" href="${css}"></html>`);
  const message = (url = documentUrl, resourceType = "document", headers = {}) => ({
    kind: "request", path: new URL(url).pathname, method: "GET", url, resourceType, headers,
  });
  const authorize = async () => ({ allow: true, requestId: randomUUID() });
  const fixture = (body = html, rawHeaders = ["Content-Type", "text/html"], status = 200) => ({
    status, rawHeaders, body: (async function* () { yield body; })(),
    cancel() {}, close() {},
  });
  const accounting = (reply: Awaited<ReturnType<InspectionFetchBroker["handle"]>>, outcome = "OK") => {
    assert.ok(reply.allow);
    return {
      kind: "response", requestId: reply.requestId, status: reply.status,
      outcome, retryAfter: "retryAfter" in reply ? reply.retryAfter : null,
    };
  };

  let transmitted = 0;
  let authorized = 0;
  const broker = new InspectionFetchBroker(async (_url, headers, timeoutMs) => {
    transmitted++;
    assert.equal(authorized, transmitted);
    assert.equal(headers.cookie, "fixture_session=opaque");
    assert.equal(headers["accept-encoding"], "identity");
    assert.ok(timeoutMs > 0 && timeoutMs <= 45_000);
    return fixture(html, [
      "Content-Type", "text/html",
      "Set-Cookie", "first=one; Path=/; Secure",
      "Set-Cookie", "second=two; Path=/; Secure",
    ]);
  });
  const auth = async () => { authorized++; return authorize(); };
  const headers = { Cookie: "fixture_session=opaque", Host: "ignored.invalid", "Accept-Encoding": "gzip" };
  const first = await broker.handle(message(documentUrl, "document", headers), auth);
  assert.ok(first.allow && "body" in first);
  assert.deepEqual(first.headers.filter(([name]) => name === "Set-Cookie").map(([, value]) => value),
    ["first=one; Path=/; Secure", "second=two; Path=/; Secure"]);
  assert.equal(broker.acknowledge({ ...accounting(first), status: 403 }), false);
  assert.equal((await broker.handle(message(js, "script", headers), auth)).allow, false);
  assert.equal(broker.acknowledge(accounting(first)), true);
  assert.equal(broker.acknowledge(accounting(first)), false);
  assert.equal((await broker.handle(message(), auth)).allow, false);
  assert.equal((await broker.handle(message(js.replace("abcdefghijklmnop", "ponmlkjihgfedcba"), "script"), auth)).allow, false);
  for (const [url, type] of [[js, "script"], [css, "stylesheet"]]) {
    const reply = await broker.handle(message(url!, type!, headers), auth);
    assert.ok(reply.allow);
    assert.equal(broker.acknowledge(accounting(reply)), true);
  }
  assert.equal(transmitted, 3);

  let forbiddenTransmissions = 0;
  const rejectBroker = new InspectionFetchBroker(async () => {
    forbiddenTransmissions++; throw new Error("must not transmit");
  });
  const denyAuth = async () => { throw new Error("invalid request reached authorization"); };
  for (const invalid of [
    { ...message(), method: "POST" },
    { ...message(), url: "https://evil.invalid/CaseSearch" },
    { ...message(), url: documentUrl + "?x=1" },
    { ...message(), path: "/Report/CpDocketSheet" },
    { ...message(), resourceType: "fetch" },
    { ...message(), body: "not-permitted" },
    { ...message(), headers: { Authorization: "not-permitted" } },
    { ...message(), headers: { Cookie: "bad\r\nheader" } },
    { ...message(), headers: { Referer: "https://evil.invalid/" } },
    { ...message(), headers: { Cookie: "one", cookie: "two" } },
  ]) assert.equal((await rejectBroker.handle(invalid, denyAuth)).allow, false);
  assert.equal((await rejectBroker.handle(message(js, "script"), denyAuth)).allow, false);
  const denied = await rejectBroker.handle(message(), async () => ({ allow: false, reason: "PERMIT_DENIED" }));
  assert.deepEqual(denied, { allow: false, reason: "PERMIT_DENIED" });
  assert.equal(forbiddenTransmissions, 0);

  let concurrentTransmissions = 0;
  const concurrent = new InspectionFetchBroker(async () => {
    concurrentTransmissions++; await Promise.resolve(); return fixture();
  });
  const duplicates = await Promise.all(Array.from({ length: 20 }, () => concurrent.handle(message(), authorize)));
  assert.equal(duplicates.filter((reply) => reply.allow).length, 1);
  assert.equal(concurrentTransmissions, 1);

  for (const advertised of [false, true]) {
    let cancelled = false;
    const oversized = new InspectionFetchBroker(async () => ({
      ...fixture(), rawHeaders: advertised ? ["Content-Length", String(INSPECTION_BROKER_MAX_BYTES + 1)] : [],
      body: (async function* () {
        yield Buffer.alloc(INSPECTION_BROKER_MAX_BYTES); yield Buffer.from("x");
        throw new Error("must stop before reading another chunk");
      })(),
      cancel() { cancelled = true; },
    }));
    const reply = await oversized.handle(message(), authorize);
    assert.ok(reply.allow && "brokerOutcome" in reply);
    assert.equal(reply.brokerOutcome, "SIZE_LIMIT");
    assert.equal(cancelled, true);
    assert.equal(oversized.acknowledge(accounting(reply, "SIZE_LIMIT")), true);
  }

  const exact = new InspectionFetchBroker(async () => fixture(Buffer.alloc(INSPECTION_BROKER_MAX_BYTES), []));
  const exactReply = await exact.handle(message(), authorize);
  assert.ok(exactReply.allow && "body" in exactReply);
  assert.equal(Buffer.from(exactReply.body, "base64").length, INSPECTION_BROKER_MAX_BYTES);
  assert.equal(exact.acknowledge(accounting(exactReply)), true);

  const unsupported = new InspectionFetchBroker(async () => fixture(Buffer.from("compressed"), ["Content-Encoding", "gzip"]));
  const unsupportedReply = await unsupported.handle(message(), authorize);
  assert.ok(unsupportedReply.allow && "brokerOutcome" in unsupportedReply);
  assert.equal(unsupportedReply.brokerOutcome, "UNSUPPORTED_RESPONSE");
  assert.equal(unsupported.acknowledge(accounting(unsupportedReply, "UNSUPPORTED_RESPONSE")), true);
  for (const rawHeaders of [
    ["Connection", "Set-Cookie"], ["Trailer", "Set-Cookie"],
    ["Content-Length", "1", "Content-Length", "2"],
    ["Set-Cookie", "unsupported=\u00e9"],
  ]) {
    const unsupportedHeaders = new InspectionFetchBroker(async () => fixture(Buffer.from("x"), rawHeaders));
    const reply = await unsupportedHeaders.handle(message(), authorize);
    assert.ok(reply.allow && "brokerOutcome" in reply && reply.brokerOutcome === "UNSUPPORTED_RESPONSE");
  }

  for (const [error, outcome] of [
    [new BrokerTimeoutError("opaque timeout detail"), "TIMEOUT"],
    [new Error("COOKIE_SENTINEL_DO_NOT_LOG"), "NETWORK_ERROR"],
  ] as const) {
    let calls = 0;
    const interrupted = new InspectionFetchBroker(async () => { calls++; throw error; });
    const reply = await interrupted.handle(message(), authorize);
    assert.ok(reply.allow && "transportError" in reply);
    assert.equal(reply.transportError, outcome);
    assert.equal(JSON.stringify(reply).includes("COOKIE_SENTINEL"), false);
    assert.equal(interrupted.acknowledge(accounting(reply, outcome)), true);
    assert.equal((await interrupted.handle(message(), authorize)).allow, false);
    assert.equal(calls, 1);
  }

  const redirect = new InspectionFetchBroker(async () => fixture(Buffer.alloc(0), ["Location", "https://evil.invalid/"], 302));
  const redirectReply = await redirect.handle(message(), authorize);
  assert.ok(redirectReply.allow);
  assert.equal(redirect.acknowledge(accounting(redirectReply, "REDIRECT")), true);
  assert.equal((await redirect.handle(message("https://evil.invalid/"), authorize)).allow, false);

  const challenge = new InspectionFetchBroker(async () => fixture(Buffer.from("<html>verify you are human</html>")));
  const challengeReply = await challenge.handle(message(), authorize);
  assert.equal(challenge.acknowledge(accounting(challengeReply, "OK")), false);
  assert.equal(challenge.acknowledge(accounting(challengeReply, "CHALLENGE")), true);

  {
    let clock = 0;
    let transmissions = 0;
    const expired = new InspectionFetchBroker(async () => { transmissions++; return fixture(); },
      INSPECTION_BROKER_MAX_BYTES, () => clock);
    clock += 601_000;
    assert.deepEqual(await expired.handle(message(), authorize),
      { allow: false, reason: "INSPECTION_SESSION_DEADLINE" });
    const reservationTimeout = new InspectionFetchBroker(async () => { transmissions++; return fixture(); },
      INSPECTION_BROKER_MAX_BYTES, () => clock);
    const reply = await reservationTimeout.handle(message(), async () => {
      clock += 601_000; return authorize();
    });
    assert.ok(reply.allow && "transportError" in reply && reply.transportError === "TIMEOUT");
    assert.equal(transmissions, 0);
  }
}
