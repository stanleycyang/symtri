import assert from "node:assert/strict";
import test from "node:test";
import { dispatchReadingNotes } from "./enrichment-dispatch";

test("concurrent dispatchers reserve each lane once",async()=>{
  const reserved=new Set<number>(),started:number[]=[];
  const dispatch=()=>dispatchReadingNotes("slot",async(_slot,lane)=>{started.push(lane);},async()=>[0,1,2,3],async()=>40,
    async lane=>{if(reserved.has(lane))return false;reserved.add(lane);return true;},async()=>{});
  await Promise.all([dispatch(),dispatch()]);
  assert.deepEqual(started.sort(),[0,1,2,3]);
});

test("failed dispatch releases only its reservation and continues",async()=>{
  const released:number[]=[];
  const result=await dispatchReadingNotes("slot",async(_slot,lane)=>{if(lane===0)throw new Error("Unavailable");},async()=>[0,1],async()=>20,async()=>true,
    async lane=>{released.push(lane);});
  assert.equal(result.queued,1);assert.equal(result.expected,2);assert.deepEqual(released,[0]);
});

test("small queues fill one worker while larger queues retain four-lane capacity",async()=>{
  for (const [notes,expected] of [[1,1],[4,1],[10,1],[11,2],[30,3],[40,4]]) {
    const started:number[]=[];
    const result=await dispatchReadingNotes("slot",async(_slot,lane)=>{started.push(lane);},async()=>[0,1,2,3],
      async limit=>{assert.equal(limit,40);return notes;},async()=>true,async()=>{});
    assert.equal(result.queued,expected);
    assert.equal(started.length,expected);
  }
});

test("busy workers bound the queue lookup and are never dispatched",async()=>{
  const started:number[]=[];
  await dispatchReadingNotes("slot",async(_slot,lane)=>{started.push(lane);},async()=>[2,3],
    async limit=>{assert.equal(limit,20);return 11;},async()=>true,async()=>{});
  assert.deepEqual(started,[2,3]);
  const forbidden=async()=>{throw new Error("Busy lanes must not query or launch");};
  assert.equal((await dispatchReadingNotes("slot",forbidden,async()=>[],forbidden,forbidden,forbidden)).status,"idle");
});

test("empty queues create no workflows or worker reservations",async()=>{
  const forbidden=async()=>{throw new Error("No work must start");};
  const result=await dispatchReadingNotes("slot",forbidden,async()=>[0,1],async()=>0,forbidden,forbidden);
  assert.equal(result.status,"idle");
});
