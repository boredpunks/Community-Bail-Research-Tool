// Offline transaction tests: no database, HTTP client, or court requests.
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mocks = {
  "@workspace/db": `
    export let state = {};
    export function reset(value) { state = structuredClone(value); }
    export const discoveryJobsTable = { name: "jobs" };
    export const discoverySourceTable = { name: "source" };
    export const db = {
      async transaction(callback) {
        const original = structuredClone(state);
        const tx = {
          async execute() {},
          select() {
            let table;
            const query = {
              from(value) { table = value; return query; },
              where() { return query; },
              for() { return query; },
              then(resolve, reject) {
                const rows = table.name === "jobs"
                  ? state.jobs.filter(job => ["QUEUED", "RUNNING"].includes(job.status))
                  : [{ blocked: state.blocked }];
                return Promise.resolve(rows).then(resolve, reject);
              }
            };
            return query;
          },
          insert() {
            return { values(value) {
              return { async returning() {
                const job = { ...value, id: "new-job", status: "QUEUED" };
                state.jobs.push(job);
                return [job];
              }};
            }};
          }
        };
        try { return await callback(tx); }
        catch (error) { state = original; throw error; }
      }
    };`,
  "drizzle-orm": `export const and=()=>null, eq=()=>null, inArray=()=>null, sql=()=>null;`,
  "./calendar-criteria": `export const actualDate=()=>true,easternToday=()=> "2026-10-29",validCalendarPreviewCriteria=()=>true;`,
  "./discovery": `export const discoveryPolicy={maxRecordCap:100,maxRequestCap:100}; export const jobSummary=async job=>({id:job.id});`,
  "./discovery-source-status": `export const sourceAdmissionBlock=async()=>null;`,
  "./research-operations": `export const calendarAdmission=async(tx,source)=>source?.blocked ? "blocked" : null;`,
};
const dir = await mkdtemp(path.join(tmpdir(), "search-replacement-"));
try {
  const outfile = path.join(dir, "test.mjs");
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import assert from "node:assert/strict";
        import { launchDiscovery } from "./src/lib/discovery-launch.ts";
        import { state, reset } from "@workspace/db";
        const criteria = { eventType:"Bail Hearing" };
        const original = {
          jobs:[{id:"old-job",ownerId:"owner",criteria,status:"RUNNING"}],
          searchStatus:"running", blocked:false, candidates:["saved-candidate"]
        };
        const replace = async () => {
          state.jobs.find(job=>job.id==="old-job").status="PAUSED";
          state.searchStatus="paused";
        };
        reset(original);
        let linked;
        const success=await launchDiscovery(criteria,"owner",["owner"],async(tx,job)=>{linked=job.id;},replace);
        assert.equal(success.status,201);
        assert.equal(linked,"new-job");
        assert.equal(state.jobs[0].status,"PAUSED");
        assert.deepEqual(state.candidates,["saved-candidate"]);
        console.log("PASS replacement creates a fresh job and preserves candidates");

        reset({...original,blocked:true});
        const blockedOriginal=structuredClone(state);
        const blocked=await launchDiscovery(criteria,"owner",["owner"],async()=>{},replace);
        assert.equal(blocked.status,409);
        assert.deepEqual(state,blockedOriginal);
        console.log("PASS source denial rolls back the replacement");

        reset({...original,jobs:[...original.jobs,{id:"other",ownerId:"other",criteria:{different:true},status:"RUNNING"}]});
        const concurrentOriginal=structuredClone(state);
        const conflict=await launchDiscovery(criteria,"owner",["owner","other"],async()=>{},replace);
        assert.equal(conflict.status,409);
        assert.deepEqual(state,concurrentOriginal);
        console.log("PASS another active session cannot be replaced");

        reset(original);
        await assert.rejects(()=>launchDiscovery(criteria,"owner",["owner"],async()=>{throw Error("insert failed");},replace),/insert failed/);
        assert.deepEqual(state,original);
        console.log("PASS search insertion failure preserves previous search");

        reset(original);
        const duplicate=await launchDiscovery(criteria,"owner",["owner"]);
        assert.equal(duplicate.payload.id,"old-job");
        assert.equal(state.jobs.length,1);
        console.log("PASS ordinary discovery duplicate behavior is unchanged");
      `,
    },
    outfile, bundle: true, platform: "node", format: "esm",
    plugins: [{
      name: "offline-source-boundary",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (mocks[args.path]) return { path: args.path, namespace: "mock" };
        });
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
      },
    }],
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
