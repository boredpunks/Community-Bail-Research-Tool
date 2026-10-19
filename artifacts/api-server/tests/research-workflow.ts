import assert from "node:assert/strict";
import { calendarOperationBlock } from "../src/lib/research-operations";
import { pacingConfig, effectiveAdaptiveSpacing } from "../src/lib/research-pacing";
import { calendarPreviewRequestAllowed, qualifyingMonetaryTotal, throttleDeadline } from "../src/lib/discovery-safety";
import { makeCalendarPreviewCriteria } from "../src/lib/calendar-criteria";
import { matchesDiscoveryFilters } from "../src/lib/discovery";
import type { DiscoveryProvenanceData } from "@workspace/db";

const source = {blockedReason:"ACCESS_DENIED", pausedUntil:null, latencyWarning:null} as any;
const denial = {method:"GET",path:"/Report/MdjDocketSheet",statusCode:401,outcome:"ACCESS_DENIED"};
assert.equal(calendarOperationBlock(source,[denial]),null);
assert.equal(source.blockedReason,"ACCESS_DENIED"); // No relabel or clearance.
assert.equal(calendarOperationBlock(source,[]),"ACCESS_DENIED");
assert.equal(calendarOperationBlock(source,[{...denial,path:"/CaseSearch"}]),"ACCESS_DENIED");
assert.equal(calendarOperationBlock(source,[denial,{...denial,outcome:"CHALLENGE",path:"/CaseSearch"}]),"ACCESS_DENIED");
assert.equal(calendarOperationBlock({...source,pausedUntil:new Date(Date.now()+60000)},[denial]),"SOURCE_COOLDOWN");
assert.equal(calendarOperationBlock({...source,blockedReason:"RESTART_IN_FLIGHT"},[denial]),"RESTART_IN_FLIGHT");
for(const path of ["/Report/MdjDocketSheet","/Report/CpDocketSheet"])
  assert.equal(calendarPreviewRequestAllowed(path,"GET"),false);
assert.equal(calendarPreviewRequestAllowed("/CaseSearch","POST"),true);
const pacing = pacingConfig({});
assert.equal(pacing.assetMs,250);
assert.equal(pacing.documentMs,3000);
assert.equal(pacingConfig({UJS_DOCUMENTED_MIN_SPACING_MS:"60000"}).assetMs,60000);
assert.equal(pacingConfig({UJS_SPACING_MS:"4000"}).navigationMs,4000);
assert.throws(()=>pacingConfig({UJS_ASSET_SPACING_MS:"0"}));
assert.throws(()=>pacingConfig({UJS_DOCUMENT_SPACING_MS:"NaN"}));
assert.equal(effectiveAdaptiveSpacing({adaptiveSpacingMs:60000,throttleCount:0,slowResponseStreak:0},1000),1000);
assert.equal(effectiveAdaptiveSpacing({adaptiveSpacingMs:120000,throttleCount:1},1000),120000);
const now = new Date();
assert.ok(throttleDeadline(now,900000,0,"3600").getTime() >= now.getTime()+3600000);
const choice = makeCalendarPreviewCriteria({courtOffice:"ANY",courtRoom:"Room supplied by user",eventType:"ANY",startDate:"2026-10-19",endDate:"2026-10-19"},"2026-10-19");
assert.equal(choice.courtRoom,"Room supplied by user");
assert.throws(()=>makeCalendarPreviewCriteria({courtOffice:"ANY",courtRoom:"ANY",eventType:"ANY",startDate:"2026-10-19",endDate:"2026-10-20"},"2026-10-19"));
// Pure numeric predicates are not synthetic docket/case fixtures.
assert.equal(qualifyingMonetaryTotal("MONETARY","TOTAL_BAIL",100000,100000,true),true);
assert.equal(qualifyingMonetaryTotal("MONETARY","TOTAL_BAIL",100000,99999,true),false);
assert.equal(qualifyingMonetaryTotal("MONETARY",null,100000,100000,true),false);
const evidence = {extractionOutcome:"EXTRACTED",postedEntryState:"NOT_SHOWN",
  entries:[{bailCategory:"MONETARY",financialBasis:"TOTAL_BAIL",amountCents:100000}]} as DiscoveryProvenanceData;
assert.equal(matchesDiscoveryFilters(evidence,{monetaryUpperBoundCents:100000,excludeShownPosted:true,inclusiveMaximum:true}),true);
assert.equal(matchesDiscoveryFilters({...evidence,postedEntryState:"SHOWN_POSTED"},{monetaryUpperBoundCents:null,excludeShownPosted:true}),false);
console.log("PASS: operation isolation, fail-closed origins, PDF boundary, configurable pacing, retained backoff and server waits, optional criteria, inclusive/posted filtering");
