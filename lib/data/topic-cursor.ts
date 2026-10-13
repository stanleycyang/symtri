export type TopicPageCursor = {publishedAt: string; id: string; topicId?: string; childId?: string | null; asOf?: string};
export function parseTopicCursor(value: string | null): TopicPageCursor | null {
  if (!value) return null;
  try {
    if (value.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Partial<TopicPageCursor>;
    if (typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 300 ||
      typeof cursor.publishedAt !== "string" || !Number.isFinite(Date.parse(cursor.publishedAt))) return null;
    if (cursor.topicId !== undefined && typeof cursor.topicId !== "string") return null;
    if (cursor.childId !== undefined && cursor.childId !== null && typeof cursor.childId !== "string") return null;
    if (cursor.asOf !== undefined && (typeof cursor.asOf !== "string" || !Number.isFinite(Date.parse(cursor.asOf)) || Date.parse(cursor.asOf) > Date.now() + 60_000)) return null;
    return cursor as TopicPageCursor;
  } catch { return null; }
}
