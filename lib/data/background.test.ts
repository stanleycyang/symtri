import assert from "node:assert/strict";
import test from "node:test";
import { fetchWikipedia,fetchWorldBank,backgroundSubjectFor } from "./background";
import { evidenceHash } from "./enrichment";
import type { SignalEvent } from "./model";

test("background selection follows an explicit subject before a broad map label",()=>{
  const topics=[{topicId:"space",subtopicId:"space-astronomy",relevance:1}];
  assert.equal(backgroundSubjectFor({title:"Valleys below Greenland ice",summary:"NASA observations",topics}),"Glaciology");
  assert.equal(backgroundSubjectFor({title:"Mars-local compute for exploration",summary:"Orbiter missions",topics:[{topicId:"hardware",subtopicId:"hardware-semiconductors",relevance:1}]}),"Mars");
  assert.equal(backgroundSubjectFor({title:"Exoplanet atmospheres",summary:"A new observation",topics}),"Exoplanet");
  assert.equal(backgroundSubjectFor({title:"A telescope mission",summary:"NASA observations",topics}),"Astronomy");
});

test("Wikipedia backgrounds preserve revision and reuse attribution",async()=>{
  const note=await fetchWikipedia("Fusion power",async url=>{
    assert.ok(url.includes("exintro=1"));
    return {text:JSON.stringify({query:{rightsinfo:{text:"CC BY-SA 4.0"},pages:[{title:"Fusion power",pageid:13,extract:"Fusion power uses energy released by combining atomic nuclei.",revisions:[{revid:29}]}]}})};
  });
  assert.equal(note.revision,29);assert.ok(note.url.includes("oldid=29"));assert.equal(note.license,"CC BY-SA 4.0");
  await assert.rejects(fetchWikipedia("Missing",async()=>({text:JSON.stringify({query:{pages:[{title:"Missing",extract:"Unversioned text"}]}})})));
});
test("World Bank context retains latest reported period and ignores missing or unrelated values",async()=>{
  const notes=await fetchWorldBank("renewable",async url=>{
    assert.ok(url.includes("EG.ELC.RNEW.ZS"));
    return {text:JSON.stringify([{},[
      {date:"2026",value:null,countryiso3code:"WLD",country:{value:"World"},indicator:{id:"EG.ELC.RNEW.ZS"}},
      {date:"2025",value:32.12,countryiso3code:"WLD",country:{value:"World"},indicator:{id:"EG.ELC.RNEW.ZS"}},
      {date:"2024",value:30,countryiso3code:"WLD",country:{value:"World"},indicator:{id:"EG.ELC.RNEW.ZS"}},
      {date:"2025",value:999,countryiso3code:"USA",country:{value:"United States"},indicator:{id:"different"}},
      {date:null,value:55},null,
    ]])};
  });
  assert.equal(notes.length,1);assert.equal(notes[0].value,32.12);assert.equal(notes[0].period,"2025");assert.equal(notes[0].license,"CC BY 4.0");
});
test("reading-note input identity changes with evidence but ignores retrieval time",()=>{
  const event={title:"A study",summary:"Abstract",evidence:{text:"The retained paper text.",kind:"abstract",url:"https://example.org",attribution:"Author",license:null,retrievedAt:"2026-09-01"}} as SignalEvent;
  assert.equal(evidenceHash(event),evidenceHash({...event,evidence:{...event.evidence!,retrievedAt:"2026-09-02"}}));
  assert.notEqual(evidenceHash(event),evidenceHash({...event,evidence:{...event.evidence!,text:"Changed findings"}}));
});
