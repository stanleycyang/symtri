import { createHash } from "node:crypto";
import type { SignalEvent } from "../data/model";
import type { Topic } from "../universe";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 256;
const BATCH_SIZE = 64;

export function signalEmbeddingText(event: SignalEvent): string {
  return `${event.title.slice(0, 240)}\n${event.summary.slice(0, 800)}`.trim();
}

export function topicEmbeddingText(topic: Topic): string {
  return `${topic.name}. Topics: ${topic.children.map((child) => child.name).join(", ")}.`;
}

export function embeddingInputHash(input: string): string {
  return createHash("sha256").update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:${input}`).digest("hex");
}

export async function embedTexts(inputs: string[], apiKey: string, fetcher: typeof fetch = fetch): Promise<number[][]> {
  if (!inputs.length) return [];
  const vectors: number[][] = [];
  for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + BATCH_SIZE);
    const response = await fetcher("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float", input: batch }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Embedding request failed: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const rows = payload && typeof payload === "object" && "data" in payload ? payload.data : null;
    if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error("Embedding response has an unexpected item count");
    const ordered: number[][] = new Array(batch.length);
    for (const row of rows) {
      if (!row || typeof row !== "object" || !Number.isInteger(row.index) || row.index < 0 || row.index >= batch.length || ordered[row.index]) {
        throw new Error("Embedding response has an invalid index");
      }
      const vector = row.embedding;
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("Embedding response has an invalid vector");
      }
      ordered[row.index] = vector;
    }
    vectors.push(...ordered);
  }
  return vectors;
}
