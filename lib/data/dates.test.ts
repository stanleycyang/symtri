import assert from "node:assert/strict";
import test from "node:test";
import {isCalendarDay} from "./dates";

test("snapshot dates reject impossible days and accept leap days",()=>{
  for(const value of ["2026-02-30","2026-02-29","2026-13-01","2026-00-01","2026-10-1","invalid",null]) assert.equal(isCalendarDay(value),false);
  for(const value of ["2024-02-29","2026-10-12","2026-12-31"]) assert.equal(isCalendarDay(value),true);
});
