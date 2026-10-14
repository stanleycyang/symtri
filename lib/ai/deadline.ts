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
export async function awaitWithinDeadline<T>(task:Promise<T>,signal:AbortSignal):Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error("Aborted")); };
    const onResolve = (value: T) => { cleanup(); resolve(value); };
    const onReject = (error: unknown) => { cleanup(); reject(error as Error); };
    const check = setInterval(() => { if (signal.aborted) onAbort(); }, 5);
    const cleanup = () => { clearInterval(check); signal.removeEventListener("abort", onAbort); };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    void task.then(onResolve).catch(onReject);
  });
}
