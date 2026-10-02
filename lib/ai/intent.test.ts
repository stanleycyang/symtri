import assert from "node:assert/strict";
import test from "node:test";
import { planQuestion } from "./intent";

test("comparison subjects are retrieved independently of task words", () => {
  for (const question of ["Compare coding agents and language models", "What is the difference between coding agents and language models?", "coding agents vs. language models"]) {
    const plan = planQuestion(question);
    assert.equal(plan.intent, "comparison");
    assert.deepEqual(plan.subjects, ["coding agents", "language models"]);
  }
});

test("follow-ups resolve bounded prior subjects or request clarification", () => {
  const question = "What are their limitations?";
  assert.equal(planQuestion(question).needsClarification, true);
  const plan = planQuestion(question, { question: "Compare coding agents and language models" });
  assert.equal(plan.needsClarification, false);
  assert.match(plan.question, /coding agents and language models/);
  assert.match(plan.question,/limitations/);
  assert.equal(plan.intent, "comparison");
  assert.deepEqual(plan.subjects, ["coding agents", "language models"]);
  assert.equal(planQuestion("Explain it", { subject: "battery recycling" }).question, "Explain battery recycling");
  assert.equal(planQuestion(question, { question: "Tell me about them" }).needsClarification, true);
  assert.equal(planQuestion("Tell me more").needsClarification, true);
  assert.equal(planQuestion("Tell me more", { subject: "battery recycling" }).question, "Explain battery recycling");
  assert.equal(planQuestion("What's happening with AI agents that use tools?").needsClarification, false);
  assert.equal(planQuestion("What is IT security?").needsClarification, false);
});
