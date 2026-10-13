import {test} from "node:test";
import assert from "node:assert/strict";
import {evidenceIndexable, subjectContent} from "../seo/content";
import {parseTopicCursor} from "./topic-cursor";
import {sourceDatePresentation} from "./source-presentation";
import {normalizeGitHub, normalizeHackerNews} from "./normalize";

test("empty archive pages are excluded without treating an outage as confirmed emptiness", () => {
  assert.equal(evidenceIndexable(0, false), false);
  assert.equal(evidenceIndexable(1, false), false);
  assert.equal(evidenceIndexable(2, false), false);
  assert.equal(evidenceIndexable(3, false), true);
  assert.equal(evidenceIndexable(0, true), undefined);
});

test("source timestamps retain their actual meaning instead of inventing publication dates", () => {
  const repository = normalizeGitHub({id: 1, full_name: "example/repository", html_url: "https://github.com/example/repository", created_at: "2020-01-01T00:00:00Z", updated_at: "2026-10-13T00:00:00Z"});
  assert.equal(repository?.publishedAt, "2020-01-01T00:00:00.000Z", "Repository feed timestamps represent creation, not the latest update");
  const discussion = normalizeHackerNews({id: 1, type: "story", title: "An older research paper", time: 1700000000, url: "https://example.org/older-paper"});
  assert.equal(discussion?.url, "https://example.org/older-paper");
  assert.equal(sourceDatePresentation(discussion!.source).schemaProperty, null, "A discussion post time cannot date the externally linked paper");
  assert.deepEqual(sourceDatePresentation("github"), {label: "Repository created", schemaProperty: "dateCreated"});
  assert.equal(sourceDatePresentation("hugging-face").schemaProperty, "dateModified");
  assert.equal(sourceDatePresentation("arxiv").schemaProperty, "datePublished");
  assert.equal(sourceDatePresentation("cisa").label, "Added to KEV");
  assert.equal(sourceDatePresentation("hacker-news").schemaProperty, null);
  assert.equal(sourceDatePresentation("feed-custom").schemaProperty, null);
});

test("archive source page cursors reject malformed input and retain stable document identifiers", () => {
  const position = {id: "hacker-news:123", publishedAt: "2026-10-13T00:00:00Z", topicId: "ai", childId: "ai-agents"};
  assert.deepEqual(parseTopicCursor(Buffer.from(JSON.stringify(position)).toString("base64url")), position);
  for (const value of ["bad", "[]", "x".repeat(1201), Buffer.from("null").toString("base64url"), Buffer.from(JSON.stringify({...position, publishedAt: "invalid"})).toString("base64url")]) assert.equal(parseTopicCursor(value), null);
});

test("generic map labels have explicit search context and distinct editorial definitions", () => {
  const agents = subjectContent("ai", "Artificial Intelligence", "Agents", "ai-agents");
  const coding = subjectContent("ai", "Artificial Intelligence", "Coding Agents", "ai-coding-agents");
  assert.equal(agents.subject, "AI agents");
  assert.notEqual(agents.definition, coding.definition);
  assert.match(agents.definition, /call tools/);
  assert.match(coding.definition, /test software/);
  assert.match(subjectContent("startups", "Startups", "Design", "startups-design").definition, /startups thread/);
  assert.match(subjectContent("hardware", "Hardware", "Hardware").definition, /physical foundation/);
});
