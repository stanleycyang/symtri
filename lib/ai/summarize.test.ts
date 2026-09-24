import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { answerQuestion } from "./ask";
import { canSummarize, summarizeAnswer } from "./summarize";
import type { SignalEvent, SignalFeed } from "../data/model";

const event: SignalEvent = {
  id: "arxiv:agents", source: "arxiv", externalId: "agents", title: "Agents learn to use tools",
  url: "https://arxiv.org/abs/2609.12345", summary: "A research paper evaluates tool use by AI agents.",
  publishedAt: "2026-09-22T12:00:00.000Z", importance: 60,
  topics: [{ topicId: "ai", subtopicId: "ai-agents", relevance: 1 }],
};
const feed: SignalFeed = { observedAt: "2026-09-22T13:00:00.000Z", events: [event], sources: { "hacker-news": "ok", github: "ok", arxiv: "ok" }, partial: false, scope: "sample" };

function modelResponse(note: { summary: string; source_ids: string[] }) {
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "text", text: JSON.stringify(note) }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  } });
}

test("a source synthesis uses only the selected evidence and validates its citations", async () => {
  const answer = answerQuestion("What is happening with AI agents?", feed);
  assert.equal(canSummarize(answer, feed), true);
  const model = modelResponse({ summary: "A new paper evaluates how AI agents use tools.", source_ids: [event.id] });
  const note = await summarizeAnswer(answer, feed, model);
  assert.equal(note.summary, "A new paper evaluates how AI agents use tools.");
  assert.deepEqual(note.citedEventIds, [event.id]);
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /arxiv:agents/);
});

test("unsupported citations and broader evidence do not produce a model note", async () => {
  const answer = answerQuestion("What is happening with AI agents?", feed);
  const model = modelResponse({ summary: "A confident unsupported claim.", source_ids: ["not-in-the-sample"] });
  await assert.rejects(summarizeAnswer(answer, feed, model), /valid source citations/);
  assert.equal(canSummarize(answerQuestion("What is happening with AI robotics?", feed), feed), false);
  assert.equal(canSummarize(answerQuestion("What connects AI and energy?", feed), feed), false);
});
