const intentWords = new Set([
  "a", "about", "an", "are", "can", "could", "did", "do", "does", "for", "how", "in", "is", "of", "on", "should", "the", "to", "was", "were", "what", "whats", "when", "where", "which", "who", "why", "will", "would", "with",
  "new", "latest", "recent", "currently", "today", "now", "update", "updates", "news",
  "doing", "going", "happening", "say", "says", "said", "saying", "tell", "tells", "told", "research", "paper", "papers", "study", "studies",
]);

export function knowledgeSearchQuery(question: string): string {
  const subjectQuestion = question.replace(/^\s*(?:what do we know about|what are people saying about|tell me about)\s+/i, "");
  const terms = subjectQuestion.toLowerCase().replace(/\bwhat['’]s\b/g, "whats").match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [];
  const subject = terms.filter((term) => !intentWords.has(term));
  return (subject.length ? subject : terms).join(" ");
}
