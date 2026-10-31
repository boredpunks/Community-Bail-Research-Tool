import assert from "node:assert/strict";
import { chooseDisplayedSearchId, type SearchHistoryItem } from "../src/lib/search-history";

const latestEmpty: SearchHistoryItem = {
  searchId: "latest-empty",
  progress: { completed: 0, documentsProcessed: 0 },
};
const earlierWithEvidence: SearchHistoryItem = {
  searchId: "earlier-evidence",
  progress: { completed: 1, documentsProcessed: 1 },
};
const olderComplete: SearchHistoryItem = {
  searchId: "older-complete",
  progress: { completed: 7, documentsProcessed: 0 },
};

assert.equal(chooseDisplayedSearchId([latestEmpty, earlierWithEvidence]), "earlier-evidence");
assert.equal(chooseDisplayedSearchId([latestEmpty, earlierWithEvidence], "latest-empty"), "latest-empty");
assert.equal(chooseDisplayedSearchId([latestEmpty, olderComplete]), "older-complete");
assert.equal(chooseDisplayedSearchId([latestEmpty]), "latest-empty");
assert.equal(chooseDisplayedSearchId([]), "");

console.log("PASS: empty newer searches preserve selectable prior results; explicit selection and empty history work.");
