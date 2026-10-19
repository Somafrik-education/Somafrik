import assert from "node:assert/strict";
import { test } from "node:test";
import { runStudentCardScanFlow } from "./studentCardScan";
const resolved = { card: { status: "active" }, class: { id: "cl1", classCode: "A", className: "A" }, student: { id: "st1", firstName: "Awa", lastName: "Diop", studentCode: "S01" } };
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (reason:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject}; }
function args(override:Record<string,unknown>={}) {
 const scope={generation:1,resourceScopeKey:"tenant",schoolCode:"CD-2026-0001",classId:"cl1",classCode:"A"};
 return { cardToken:"synthetic.token", scope, selectedClass:{classId:"cl1",classCode:"A"},
 author:{status:"teacher_session" as const}, attendanceDate:"2026-10-19",financeEnabled:true,isOffline:()=>false,currentScope:()=>scope,
 resolveCard:async()=>resolved,recordAttendance:async()=>resolved,readFinance:async()=>({finance:{code:"UP_TO_DATE",label:"À jour"}}),
 createIdempotencyKey:()=>"11111111-1111-4111-8111-111111111111",...override };
}
test("finance begins while attendance write is in flight, never confirms before PostgreSQL",async()=>{
 const writing=deferred<typeof resolved>();let financeStarted=false;let settled=false;
 const run=runStudentCardScanFlow(args({
  recordAttendance:()=>writing.promise,
  readFinance:async()=>{financeStarted=true;return {finance:{code:"UP_TO_DATE",label:"À jour"}};}
 })).then(x=>{settled=true;return x});
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(financeStarted,true);assert.equal(settled,false);
 writing.resolve(resolved);
 const result=await run;assert.equal(result.kind,"success");if(result.kind==="success")assert.equal(result.view.attendanceRecorded,true);
});
test("finance failure is informational; attendance still requires server confirmation",async()=>{
 const result=await runStudentCardScanFlow(args({readFinance:async()=>{throw Error("network")}}));
 assert.equal(result.kind,"success");if(result.kind==="success"){assert.equal(result.view.attendanceRecorded,true);assert.equal(result.view.financeUnavailable,true)}
 const rejected=await runStudentCardScanFlow(args({recordAttendance:async()=>{throw Error("write failed")},readFinance:async()=>{throw Error("finance failed")}}));
 assert.equal(rejected.kind,"error");
});
test("scope mismatch prevents attendance and finance requests",async()=>{
 let writes=0,finance=0;
 const result=await runStudentCardScanFlow(args({resolveCard:async()=>({...resolved,class:{...resolved.class,id:"wrong",classCode:"X"}}),recordAttendance:async()=>{writes++;return resolved},readFinance:async()=>{finance++;return resolved}}));
 assert.equal(result.kind,"class_mismatch");assert.equal(writes,0);assert.equal(finance,0);
});
test("phase timing observer is nonblocking and contains numeric durations only",async()=>{
 const phases:string[]=[];
 const result=await runStudentCardScanFlow(args({onPhaseTiming:(phase:string,duration:number)=>{assert.ok(Number.isFinite(duration));phases.push(phase)}}));
 assert.equal(result.kind,"success");assert.deepEqual(phases,["resolve","attendance","finance","total"]);
});
