import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeSearchQuery } from "./search";

test("archive search keeps the subject and removes recency intent", () => {
  assert.equal(knowledgeSearchQuery("What is new in exoplanet research?"), "exoplanet");
  assert.equal(knowledgeSearchQuery("Latest papers on exoplanets"), "exoplanets");
  assert.equal(knowledgeSearchQuery("Quantum meadow"), "quantum meadow");
});

test("archive search retains broad questions when every term is intent", () => {
  assert.equal(knowledgeSearchQuery("Latest research updates"), "latest research updates");
});
