import assert from "node:assert/strict";
import test from "node:test";
import { dispatchReadingNotes } from "./enrichment-dispatch";

test("concurrent dispatchers reserve each lane once",async()=>{
  const reserved=new Set<number>(),started:number[]=[];
  const dispatch=()=>dispatchReadingNotes("slot",async(_slot,lane)=>{started.push(lane);},async()=>[0,1,2,3],async()=>4,
    async lane=>{if(reserved.has(lane))return false;reserved.add(lane);return true;},async()=>{});
  await Promise.all([dispatch(),dispatch()]);
  assert.deepEqual(started.sort(),[0,1,2,3]);
});

test("failed dispatch releases only its reservation and continues",async()=>{
  const released:number[]=[];
  const result=await dispatchReadingNotes("slot",async(_slot,lane)=>{if(lane===0)throw new Error("Unavailable");},async()=>[0,1],async()=>2,async()=>true,
    async lane=>{released.push(lane);});
  assert.equal(result.queued,1);assert.equal(result.expected,2);assert.deepEqual(released,[0]);
});

test("empty queues create no workflows or worker reservations",async()=>{
  const forbidden=async()=>{throw new Error("No work must start");};
  const result=await dispatchReadingNotes("slot",forbidden,async()=>[0,1],async()=>0,forbidden,forbidden);
  assert.equal(result.status,"idle");
});
