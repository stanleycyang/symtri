const intentWords = new Set([
  "a", "about", "an", "are", "for", "in", "is", "of", "on", "the", "to", "what", "whats", "with",
  "new", "latest", "recent", "currently", "today", "now", "update", "updates", "news",
  "happening", "research", "paper", "papers", "study", "studies",
]);

export function knowledgeSearchQuery(question: string): string {
  const subjectQuestion = question.replace(/^\s*(?:what do we know about|what are people saying about|tell me about)\s+/i, "");
  const terms = subjectQuestion.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [];
  const subject = terms.filter((term) => !intentWords.has(term));
  return (subject.length ? subject : terms).join(" ");
}
