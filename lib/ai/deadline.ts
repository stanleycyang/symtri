/** Bound an entire Ask request and cancel paid model work when it expires. */
export async function runAskWithDeadline(task:(signal:AbortSignal)=>Promise<Response>,timeoutMs=38_000):Promise<Response> {
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<Response>(resolve=>{
    timer=setTimeout(()=>{
      resolve(Response.json({error:"Ask took too long. Try a more specific question."},{status:503,headers:{"Cache-Control":"no-store"}}));
      controller.abort();
    },timeoutMs);
  });
  try {return await Promise.race([task(controller.signal),timeout]);}
  finally {if(timer)clearTimeout(timer);}
}

/** Stop waiting for a provider that does not reject when its abort signal fires. */
export function awaitWithinDeadline<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    // Attach both handlers even when already aborted, so late provider failures are handled.
    void task.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
