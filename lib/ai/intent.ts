import { knowledgeSearchQuery } from "../data/search";

export type AskIntent = "update" | "explanation" | "comparison" | "connection";
export type AskContext = { question?: string; answer?: string; subject?: string; signalId?: string };
export type QuestionPlan = {
  question: string;
  intent: AskIntent;
  subjects: string[];
  needsClarification: boolean;
};

function cleanSubject(value: string): string {
  return value.trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ").slice(0, 180);
}

export function planQuestion(input: string, context: AskContext = {}): QuestionPlan {
  let question = input.trim();
  let previousSubjects: string[] | undefined;
  const shortFollowUp = /^(?:tell me more|go deeper|why|how so)\s*[?.!]*$/i.test(question);
  const followUp = shortFollowUp || /\b(?:their|them|these|those|its)\b/i.test(question)
    || /\b(?:it|that)\s*(?:[?.!]|$)/i.test(question) && !/\bIT\b/.test(question)
    || /\b(?:it|that)\s+(?:work|works|mean|means|matter|affect|compare)\b/i.test(question);
  if (followUp) {
    const previous = context.question ? planQuestion(context.question) : null;
    const subject = previous && !previous.needsClarification
      ? previous.subjects.join(" and ") : context.subject;
    if (!subject) return { question, intent: "explanation", subjects: [], needsClarification: true };
    if (previous?.intent === "comparison") previousSubjects = previous.subjects;
    question = shortFollowUp ? `Explain ${cleanSubject(subject)}`
      : question.replace(/\b(?:their|them|these|those|that|it|its)\b/gi, cleanSubject(subject));
  }
  const comparison = question.match(/^(?:compare\s+|.*?difference(?:s)?\s+between\s+)(.+?)\s+(?:and|with|to)\s+(.+?)\s*[?.!]*$/i)
    ?? question.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+?)\s*[?.!]*$/i);
  const intent: AskIntent = comparison || previousSubjects ? "comparison"
    : /\b(?:connects?|connections?|relationship|relates?|link(?:s|ed)?)\b/i.test(question) ? "connection"
    : /\b(?:explain|why|how|limitations?|risks?|tradeoffs?|what is|what are)\b/i.test(question)
      && !/\b(?:new|latest|happening|updates?|recent)\b/i.test(question) ? "explanation" : "update";
  const subjects = comparison
    ? [cleanSubject(comparison[1]), cleanSubject(comparison[2])]
    : previousSubjects ?? [knowledgeSearchQuery(question)];
  return { question, intent, subjects, needsClarification: false };
}
