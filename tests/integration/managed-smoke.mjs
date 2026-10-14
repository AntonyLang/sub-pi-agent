import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\','/');
const workspace = process.env.PI_TEST_WORKSPACE ?? tmpdir();
const fixture = path.join(workspace, `sub-pi-agent-test-${randomUUID()}`);
const agentDir = path.join(fixture, 'pi-settings');
const managedDir = path.join(fixture, 'managed');
const token = `context-${randomUUID()}`;
const fixtureFile = path.join(fixture, 'memory.txt');
await fs.mkdir(agentDir, {recursive:true});
await fs.writeFile(fixtureFile, `context-token:${token}`);
const {Client} = await import(pathToFileURL(`${root}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`).href);
const {StdioClientTransport} = await import(pathToFileURL(`${root}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`).href);
const {SessionManager} = await import(pathToFileURL(`${root}/node_modules/@earendil-works/pi-coding-agent/dist/index.js`).href);
const report = { startedAt:new Date().toISOString(), fixture, checks:[] };
const clients = new Set();
const heldResponses = new Set();
const requests=[];
function record(name, detail={}) { report.checks.push({name,...detail}); console.log(JSON.stringify({name,...detail})); }
const flatten = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(v => v.text ?? '').join('') : '';
const server = http.createServer(async (req,res) => {
  try {
    let input='';for await (const chunk of req) input+=chunk;
    const body=JSON.parse(input);requests.push(body);
    const messages=body.messages;
    const user=messages.filter(m=>m.role==='user').at(-1);
    const task=flatten(user?.content);
    if (task==='FAIL_TASK') { res.writeHead(400, {'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'fixture upstream failure',type:'invalid_request_error'}}));return; }
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    const chunk = (delta, finish_reason=null) => res.write(`data: ${JSON.stringify({id:'chatcmpl-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:body.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
    if (task==='HOLD') { heldResponses.add(res);res.on('close',()=>heldResponses.delete(res));return; }
    if ((task==='READ_FIXTURE' || task==='SILENT_ACTIVITY') && messages.at(-1).role!=='tool') {
      chunk({role:'assistant',content:'Checking fixture.'});
      chunk({tool_calls:[{index:0,id:'call-fixture',type:'function',function:{name:'read',arguments:JSON.stringify({path:fixtureFile})}}]});
      chunk({},'tool_calls');
    } else if (task==='ASK_TARGET' && messages.at(-1).role!=='tool') {
      assert.ok(messages.some(m=>m.role==='system'&&flatten(m.content).includes('supervising agent')),'Pi must receive its appended subagent instructions');
      assert.ok(body.tools.some(t=>t.function?.name==='ask_supervisor'),'Pi must expose the handoff tool');
      chunk({role:'assistant',tool_calls:[{index:0,id:'call-question',type:'function',function:{name:'ask_supervisor',arguments:JSON.stringify({question:'Which target branch should I use?'})}}]});
      chunk({},'tool_calls');
    } else {
      let text='STORED';
      if (task==='DELAY_DONE') await new Promise(resolve=>setTimeout(resolve,700));
      if (task==='SILENT_ACTIVITY') await new Promise(resolve=>setTimeout(resolve,1000));
      if(task==='ASK_TARGET')text='Waiting for the supervisor to choose a target branch.';
      if(task==='USE_MAIN'){
        assert.ok(messages.some(m=>m.role==='assistant'&&m.tool_calls?.some(t=>t.function?.name==='ask_supervisor')),'Question tool call must survive restoration');
        assert.ok(messages.some(m=>m.role==='tool'&&flatten(m.content).includes('Question registered')),'Question tool result must survive restoration');
        text='ANSWER_ACCEPTED';
      }
      if (task==='RECALL_CONTEXT') {
        const toolText=messages.filter(m=>m.role==='tool').map(m=>flatten(m.content)).join('\n');
        assert.ok(toolText.includes(token),'SDK must restore the historical read-tool result');
        text=token;
      }
      chunk({role:'assistant',content:text});chunk({},'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch(error) { res.destroy(error); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await fs.writeFile(path.join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'local-test-only',models:['local-one','local-two'].map(id=>({id,name:id,reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}))}}}));
const settings = model=>fs.writeFile(path.join(agentDir,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:model,defaultThinkingLevel:'off'}));
await settings('local-one');
async function connect() {
  const transport=new StdioClientTransport({command:process.execPath,args:[`${root}/bin/cli.js`],cwd:root,
    env:{...process.env,PI_CODING_AGENT_DIR:agentDir,PI_AGENTS_DIR:managedDir,PI_STATUS_DIR:path.join(fixture,`status-${randomUUID()}`),PI_SESSIONS_DIR:path.join(fixture,'events')},stderr:'pipe'});
  const client=new Client({name:'managed-offline-smoke',version:'1'});
  await client.connect(transport);transport.stderr?.on('data',()=>{});
  const c={client,transport,async close(){await client.close();clients.delete(c)}};
  clients.add(c);return c;
}
async function call(c,name,args={},options={}) {
  const result=await c.client.callTool({name,arguments:args},undefined,{timeout:330000,...options});
  const text=result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if(result.isError)throw Error(text);
  const value=JSON.parse(text);
  if(name==='pi_get_result')assert.deepEqual(result.structuredContent,value,'MCP must expose the final text in both text and structured content');
  return value;
}
async function pollUntil(c,id,predicate) {
  const until=Date.now()+20000;
  while(Date.now()<until){const p=await call(c,'pi_poll_agent',{session_id:id});if(predicate(p))return p;await new Promise(r=>setTimeout(r,50));}
  throw Error('Timed out waiting for fixture task');
}
async function completed(c,agent) {
  const waited=await call(c,'pi_wait_agent',{session_id:agent.session_id,timeout_ms:10000});
  assert.equal(waited.timed_out,false);
  return call(c,'pi_get_result',agent);
}

try {
  const a=await connect();
  const tools=(await a.client.listTools()).tools;
  for(const name of ['pi_spawn_agent','pi_list_agents','pi_continue_agent','pi_release_agent','pi_get_result','pi_wait_agent'])assert.ok(tools.some(t=>t.name===name));
  assert.equal(tools.length,11);
  assert.ok(!tools.some(t=>t.name==='pi_run_task'));
  assert.ok(!tools.some(t=>t.name==='pi_delete_agent'));
  record('tool-discovery');
  const waitSchema=tools.find(t=>t.name==='pi_wait_agent').inputSchema;
  assert.equal(waitSchema.properties.timeout_ms.default,180000);
  assert.equal(waitSchema.properties.timeout_ms.maximum,300000);
  const agent=await call(a,'pi_spawn_agent',{task:'READ_FIXTURE',name:'context-check',description:'A named persistent test agent',cwd:fixture});
  const result=await completed(a,agent);
  assert.equal(result.output,'STORED');
  assert.equal(requests.length,2);record('real-SDK-tool-turn-and-final-body',{session_id:agent.session_id,output:result.output});
  await call(a,'pi_continue_agent',{session_id:agent.session_id,task:'DELAY_DONE'});
  const waitStart=Date.now();
  const waited=await call(a,'pi_wait_agent',{session_id:agent.session_id,timeout_ms:10000});
  assert.equal(waited.status,'done');assert.equal(waited.timed_out,false);
  assert.ok(Date.now()-waitStart>=200,'The real MCP request must stay pending while Pi works');
  assert.ok(!('output' in waited));assert.ok(waited.events.some(e=>e.type==='done'));
  assert.equal((await call(a,'pi_get_result',agent)).output,'STORED');
  record('wait-keeps-one-MCP-request-pending-until-final-delivery');
  await call(a,'pi_continue_agent',{session_id:agent.session_id,task:'SILENT_ACTIVITY'});
  const active=await pollUntil(a,agent.session_id,p=>p.activity?.phase==='tool_finished');
  assert.equal(active.output,'Checking fixture.');assert.equal(active.activity.tool_name,'read');
  assert.ok(!('result' in active.activity)&&!('args' in active.activity));
  await completed(a,agent);
  record('real-SDK-silent-tool-turn-reports-activity-without-raw-results');
  let b=await connect();
  await assert.rejects(()=>call(b,'pi_continue_agent',{session_id:agent.session_id,task:'RECALL_CONTEXT'}),/agent_busy/);
  record('separate-MCP-process-cannot-double-write');
  await call(a,'pi_release_agent',agent);
  assert.equal((await call(a,'pi_get_result',agent)).output,'STORED');
  await a.close();
  const listed=await call(b,'pi_list_agents',{status:'done',cwd:fixture});
  assert.equal(listed.agents.length,1);assert.equal(listed.agents[0].name,'context-check');assert.equal(listed.agents[0].loaded,false);
  const beforeRead=requests.length;
  assert.equal((await call(b,'pi_get_result',agent)).output,'STORED');assert.equal(requests.length,beforeRead);
  record('restart-and-pure-result-read-without-model');
  await settings('local-two');
  await call(b,'pi_continue_agent',{session_id:agent.session_id,task:'RECALL_CONTEXT'});
  assert.equal((await completed(b,agent)).output,token);
  assert.equal(requests.at(-1).model,'local-two');
  record('same-ID-native-context-including-tool-result-and-fresh-default-model');
  const external=SessionManager.create(fixture,path.join(fixture,'cli-sessions'));
  external.appendMessage({role:'user',content:'not created by MCP',timestamp:Date.now()});
  await assert.rejects(()=>call(b,'pi_continue_agent',{session_id:external.getSessionId(),task:'RECALL_CONTEXT'}),/agent_not_found/);
  assert.equal((await call(b,'pi_list_agents')).agents.length,1);
  record('external-Pi-session-not-discoverable-or-resumable');
  await call(b,'pi_continue_agent',{session_id:agent.session_id,task:'ASK_TARGET'});
  const questionWait=await call(b,'pi_wait_agent',{session_id:agent.session_id,timeout_ms:10000});
  assert.equal(questionWait.status,'needs_input');assert.equal(questionWait.next,'pi_poll_agent');
  assert.ok(questionWait.events.some(e=>e.type==='needs_input'));
  assert.ok(!('question' in questionWait));
  record('wait-wakes-for-question-without-consuming-body-or-reminder');
  let notice;
  for(let i=0;i<100;i++){
    notice=await call(b,'pi_list_models');
    if(notice.events?.some(e=>e.type==='needs_input'))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(notice.events?.some(e=>e.session_id===agent.session_id&&e.type==='needs_input'));
  assert.ok(!('question' in notice.events[0])&&!('output' in notice.events[0]));
  assert.ok((await call(b,'pi_list_agents')).events?.some(e=>e.type==='needs_input'));
  const early=await call(b,'pi_get_result',agent);
  assert.equal(early.ready,false);assert.equal(early.reason,'needs_input');assert.ok(!('output' in early));
  assert.ok(early.events.some(e=>e.type==='needs_input'));
  const question=await call(b,'pi_poll_agent',agent);
  assert.equal(question.status,'needs_input');assert.equal(question.question.text,'Which target branch should I use?');
  assert.equal((await call(b,'pi_list_models')).events,undefined);
  await call(b,'pi_release_agent',agent);await b.close();b=await connect();
  assert.equal((await call(b,'pi_list_agents',{status:'needs_input'})).agents.length,1);
  assert.deepEqual((await call(b,'pi_poll_agent',agent)).question,question.question);
  record('structured-question-is-not-final-delivery-and-persists-over-MCP-restart');
  await call(b,'pi_continue_agent',{session_id:agent.session_id,task:'USE_MAIN'});
  await pollUntil(b,agent.session_id,p=>p.status==='done');
  assert.ok((await call(b,'pi_list_models')).events?.some(e=>e.type==='done'));
  assert.equal((await call(b,'pi_get_result',agent)).output,'ANSWER_ACCEPTED');
  assert.equal((await call(b,'pi_list_models')).events,undefined);
  record('same-ID-answer-retains-question-tool-context-and-reading-delivery-acks-reminder');
  await call(b,'pi_continue_agent',{session_id:agent.session_id,task:'HOLD'});
  await pollUntil(b,agent.session_id,p=>p.status==='running');
  assert.equal((await call(b,'pi_poll_agent',agent)).output,'');
  assert.deepEqual(await call(b,'pi_get_result',agent),{ready:false,reason:'task_running',next:'pi_poll_agent'});
  record('early-get-result-is-not-a-progress-poll');
  const beforeWaitRequests=requests.length;
  assert.deepEqual(await call(b,'pi_wait_agent',{session_id:agent.session_id,timeout_ms:50}),{status:'running',timed_out:true,next:'pi_wait_agent'});
  assert.equal(requests.length,beforeWaitRequests);
  if(process.env.PI_WAIT_WALL_TEST==='1'){
    record('default-three-minute-wait-started');
    const wallStart=Date.now();
    const defaultWait=await call(b,'pi_wait_agent',{session_id:agent.session_id});
    const elapsedMs=Date.now()-wallStart;
    assert.deepEqual(defaultWait,{status:'running',timed_out:true,next:'pi_wait_agent'});
    assert.ok(elapsedMs>=179800&&elapsedMs<195000);
    assert.equal(requests.length,beforeWaitRequests);
    record('real-three-minute-MCP-wait-no-model-requests',{elapsedMs});
  }
  const controller=new AbortController();
  const cancelled=assert.rejects(()=>call(b,'pi_wait_agent',{session_id:agent.session_id,timeout_ms:10000},{signal:controller.signal}),/cancel wait/);
  setTimeout(()=>controller.abort(new Error('cancel wait')),100);
  await cancelled;
  assert.equal((await call(b,'pi_poll_agent',agent)).status,'running');
  record('timeout-and-protocol-cancellation-do-not-stop-Pi-or-call-model');
  await assert.rejects(()=>call(b,'pi_release_agent',agent),/agent_busy/);
  const steer=await call(b,'pi_steer_agent',{session_id:agent.session_id,message:'  preserve-original\n'});
  assert.deepEqual(steer,{ok:true,message:'  preserve-original\n',status:'queued'});
  await b.close();
  const c=await connect();
  const stopped=(await call(c,'pi_list_agents')).agents[0];
  assert.equal(stopped.status,'interrupted');assert.equal(stopped.loaded,false);
  assert.equal((await call(c,'pi_get_result',agent)).status,'interrupted');
  record('disconnect-interrupts-no-auto-replay-and-steer-echo');
  await call(c,'pi_continue_agent',{session_id:agent.session_id,task:'RECALL_CONTEXT'});
  assert.equal((await completed(c,agent)).output,token);
  await call(c,'pi_release_agent',agent);
  record('explicit-recovery-after-interruption');
  const d=await connect();
  await call(d,'pi_continue_agent',{session_id:agent.session_id,task:'HOLD'});
  await pollUntil(d,agent.session_id,p=>p.status==='running');
  const killedPid=d.transport.pid;
  process.kill(killedPid,'SIGKILL');
  await d.close();
  const e=await connect();const f=await connect();
  assert.equal((await call(e,'pi_list_agents')).agents[0].status,'interrupted');
  const competing=await Promise.allSettled([e,f].map(client=>call(client,'pi_continue_agent',{session_id:agent.session_id,task:'RECALL_CONTEXT'})));
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  const winner=competing[0].status==='fulfilled'?e:f;
  assert.equal((await completed(winner,agent)).output,token);
  record('real-process-crash-and-concurrent-stale-lease-recovery');
  await call(winner,'pi_continue_agent',{session_id:agent.session_id,task:'FAIL_TASK'});
  const failure=await completed(winner,agent);
  assert.equal(failure.status,'error');assert.match(failure.error,/fixture upstream failure/);
  record('task-error-is-visible-in-normal-MCP-result-body');
  report.ok=true;
} catch(error) {report.ok=false;report.error=error.stack??String(error);console.error(report.error);process.exitCode=1;}
finally {
  for(const c of clients)await c.close().catch(()=>{});
  for(const res of heldResponses)res.destroy();
  await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(fixture,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,report:path.join(fixture,'verification.json')}));
}
