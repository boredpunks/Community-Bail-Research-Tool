import assert from "node:assert/strict";
import { chooseDisplayedSearchId, type SearchHistoryItem } from "../src/lib/search-history";

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

console.log("PASS: running and paused searches restore by default; evidence history, explicit selection, and empty history work.");
