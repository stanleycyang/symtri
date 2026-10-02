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
