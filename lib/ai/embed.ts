import { createHash } from "node:crypto";
import { embedMany, gateway, type EmbeddingModel } from "ai";
import type { SignalEvent } from "../data/model";
import type { Topic } from "../universe";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 256;
const BATCH_SIZE = 64;

export function embeddingModelId(): string {
  return process.env.SYMTRI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function embeddingOptions(modelId: string): Record<string, Record<string, number>> {
  if (modelId.startsWith("google/")) return { google: { outputDimensionality: EMBEDDING_DIMENSIONS } };
  if (modelId.startsWith("openai/")) return { openai: { dimensions: EMBEDDING_DIMENSIONS } };
  throw new Error(`Embedding model ${modelId} has no configured 256-dimensional output`);
}

export function signalEmbeddingText(event: SignalEvent): string {
  return `${event.title.slice(0, 240)}\n${event.summary.slice(0, 800)}`.trim();
}

export function topicEmbeddingText(topic: Topic): string {
  return `${topic.name}. Topics: ${topic.children.map((child) => child.name).join(", ")}.`;
}

export function embeddingInputHash(input: string): string {
  return createHash("sha256").update(`${embeddingModelId()}:${EMBEDDING_DIMENSIONS}:${input}`).digest("hex");
}

export async function embedTexts(inputs: string[], model: EmbeddingModel = gateway.embeddingModel(embeddingModelId())): Promise<number[][]> {
  if (!inputs.length) return [];
  const vectors: number[][] = [];
  const modelId = embeddingModelId();
  for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + BATCH_SIZE);
    const { embeddings } = await embedMany({
      model,
      values: batch,
      providerOptions: embeddingOptions(modelId),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (embeddings.length !== batch.length) throw new Error("Embedding response has an unexpected item count");
    for (const vector of embeddings) {
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("Embedding response has an invalid vector");
      }
      vectors.push(vector);
    }
  }
  return vectors;
}
