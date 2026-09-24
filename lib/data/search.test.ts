import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeSearchQuery } from "./search";

test("archive search keeps the subject and removes recency intent", () => {
  assert.equal(knowledgeSearchQuery("What is new in exoplanet research?"), "exoplanet");
  assert.equal(knowledgeSearchQuery("What's happening with AI agents?"), "ai agents");
  assert.equal(knowledgeSearchQuery("How are AI agents doing?"), "ai agents");
  assert.equal(knowledgeSearchQuery("Latest papers on exoplanets"), "exoplanets");
  assert.equal(knowledgeSearchQuery("What do we know about exoplanets?"), "exoplanets");
  assert.equal(knowledgeSearchQuery("What are people saying about exoplanets?"), "exoplanets");
  assert.equal(knowledgeSearchQuery("What did the UN Security Council say about AI?"), "un security council ai");
  assert.equal(knowledgeSearchQuery("What is new in people analytics?"), "people analytics");
  assert.equal(knowledgeSearchQuery("Quantum meadow"), "quantum meadow");
});

test("archive search retains broad questions when every term is intent", () => {
  assert.equal(knowledgeSearchQuery("Latest research updates"), "latest research updates");
});
