import assert from "node:assert/strict";
import { chooseDisplayedSearchId, lastStartedSearchId, rememberStartedSearch, type SearchHistoryItem } from "../src/lib/search-history";

const latestEmpty: SearchHistoryItem = {
  searchId: "latest-empty",
  status: "complete",
  progress: { completed: 0, documentsProcessed: 0 },
};
const latestRunning: SearchHistoryItem = {
  searchId: "latest-running",
  status: "running",
  progress: { completed: 0, documentsProcessed: 0 },
};
const latestPaused: SearchHistoryItem = {
  searchId: "latest-paused",
  status: "paused",
  progress: { completed: 0, documentsProcessed: 0 },
};
const earlierWithEvidence: SearchHistoryItem = {
  searchId: "earlier-evidence",
  status: "complete",
  progress: { completed: 1, documentsProcessed: 1 },
};
const olderComplete: SearchHistoryItem = {
  searchId: "older-complete",
  status: "complete",
  progress: { completed: 7, documentsProcessed: 0 },
};

assert.equal(chooseDisplayedSearchId([latestEmpty, earlierWithEvidence]), "earlier-evidence");
assert.equal(chooseDisplayedSearchId([latestEmpty, earlierWithEvidence], "latest-empty"), "latest-empty");
assert.equal(chooseDisplayedSearchId([latestEmpty, olderComplete]), "older-complete");
assert.equal(chooseDisplayedSearchId([latestRunning, earlierWithEvidence]), "latest-running");
assert.equal(chooseDisplayedSearchId([latestRunning, earlierWithEvidence], "earlier-evidence"), "earlier-evidence");
assert.equal(chooseDisplayedSearchId([latestPaused, earlierWithEvidence]), "latest-paused");
assert.equal(chooseDisplayedSearchId([latestPaused, earlierWithEvidence], "earlier-evidence"), "earlier-evidence");
assert.equal(chooseDisplayedSearchId([latestEmpty]), "latest-empty");
assert.equal(chooseDisplayedSearchId([]), "");

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
try {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  assert.equal(lastStartedSearchId(), "");
  rememberStartedSearch("started-search");
  assert.equal(lastStartedSearchId(), "started-search");
  rememberStartedSearch("resumed-search");
  assert.equal(lastStartedSearchId(), "resumed-search");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  assert.equal(lastStartedSearchId(), "");
  assert.doesNotThrow(() => rememberStartedSearch("server-history-still-works"));
} finally {
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
}

console.log("PASS: running and paused searches restore by default; evidence history, explicit selection, and empty history work.");
