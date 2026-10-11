import type { AskResult } from "./ask";

type AskMessage = { type: "preview" | "complete"; answer: AskResult } | { type: "error"; error: string };

/** Keep the request budget alive until the final audited answer, including after headers flush. */
export function streamAskResponse(requestSignal: AbortSignal, task: (signal: AbortSignal, publish: (answer: AskResult) => void) => Promise<Response>): Response {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: AskMessage) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      };
      try {
        const response = await task(signal, answer => send({ type: "preview", answer }));
        if (response.ok) send({ type: "complete", answer: await response.json() });
        else send({ type: "error", error: response.status === 429
          ? "Ask is busy right now. Please try again after the limit resets."
          : "Following these sources could not finish. Please try again." });
      } catch {
        send({ type: "error", error: "Signals are unavailable right now. Try again shortly." });
      } finally {
        if (!cancellation.signal.aborted) controller.close();
      }
    },
    cancel() { cancellation.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

/** Decode records across arbitrary network chunks; a truncated answer is never final. */
export async function readAskStream(response: Response, preview: (answer: AskResult) => void): Promise<AskResult> {
  if (!response.body) throw new Error("Ask returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AskResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as AskMessage;
    if (message.type === "error") throw new Error(message.error);
    if (message.type === "preview") preview(message.answer);
    if (message.type === "complete") final = message.answer;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!final) throw new Error("Following these sources was interrupted. Please try again.");
    return final;
  } finally { await reader.cancel(); reader.releaseLock(); }
}
