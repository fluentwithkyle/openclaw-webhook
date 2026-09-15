const assert = require('assert');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const { validateExecutionReport } = require('../poc/schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

// Start test server
const app = express();
app.use(express.json());

// Set environment for auth
process.env.ACP_POC_TRIGGER_SECRET = 'test-secret';
process.env.GEMINI_CALLBACK_SECRET = 'test-gemini-secret';

// Load the routes
const { router: pocRouter } = require('../routes/poc');
app.use('/poc', pocRouter);

const server = app.listen(3002);

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let passCount = 0;
let failCount = 0;

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

function makeCommand(requestId, task = 'test-task') {
  return {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'Qwen',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: task,
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'test',
    reporting: 'json',
    originator: 'Kyle'
  };
}

function makeKiloReport(requestId, task = 'test-task') {
  return {
    request_id: requestId,
    agent: 'Kilo',
    status: 'success',
    task: task,
    changed_files: ['file1.js'],
    verification: ['test passed'],
    result: { execution_metadata: { invocation_id: 'inv-kilo-1', run_id: 'run-kilo-1' } },
    commit: 'abc123',
    push: true,
    blockers: []
  };
}

function makeGeminiReport(requestId, task = 'test-task', status = 'success') {
  return {
    request_id: requestId,
    agent: 'Gemini',
    status: status,
    task: task,
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    changed_files: [],
    verification: ['review passed'],
    result: { execution_metadata: { invocation_id: 'inv-gemini-1', run_id: 'run-gemini-1' } },
    commit: null,
    push: false,
    blockers: status === 'blocked' ? ['Needs human decision'] : (status === 'failure' ? ['Architecture concerns'] : [])
  };
}

function setupTask(requestId, task = 'test-task') {
  cleanup();
  taskRegistry.createTask(makeCommand(requestId, task));
  taskRegistry.updateTaskStatus(requestId, 'SELECTED');
  taskRegistry.updateTaskStatus(requestId, 'PLANNED');
  taskRegistry.updateTaskStatus(requestId, 'EXECUTING');
  orchestrator.handleKiloCompletion(requestId, makeKiloReport(requestId, task));
}

async function makeRequest(options, data = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL: ${name} - ${err.message}`);
    failCount++;
  }
}

async function main() {
  // Test 1: Missing auth header
  await runTest('Callback - missing auth header returns 401', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { request_id: 'test-1', agent: 'Gemini', status: 'success' });
    assertEqual(res.status, 401);
    assertEqual(res.body.status, 'authentication blocked');
  });

  // Test 2: Invalid auth header
  await runTest('Callback - invalid auth header returns 401', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'wrong' }
    }, { request_id: 'test-1', agent: 'Gemini', status: 'success' });
    assertEqual(res.status, 401);
    assertEqual(res.body.status, 'authentication blocked');
  });

  // Test 3: Valid auth but missing request_id
  await runTest('Callback - missing request_id returns 400', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, { agent: 'Gemini', status: 'success' });
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Missing request_id'));
  });

  // Test 4: Valid auth but malformed report (missing required fields)
  await runTest('Callback - malformed report returns 400', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, { request_id: 'test-1', agent: 'Gemini', repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main' }); // missing status, task, etc.
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Invalid execution report'));
  });

  // Test 5: Valid auth but unknown request_id
  await runTest('Callback - unknown request_id returns 404', async () => {
    const report = makeGeminiReport('unknown-request');
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 404);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Unknown request_id'));
  });

  // Test 6: Valid auth but wrong agent
  await runTest('Callback - wrong agent (Kilo) returns 400', async () => {
    setupTask('test-agent-1');
    const report = { ...makeGeminiReport('test-agent-1'), agent: 'Kilo' };
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Expected Gemini report'));
  });

  // Test 7: Valid auth but repository mismatch
  await runTest('Callback - repository mismatch returns 400', async () => {
    setupTask('test-repo-1');
    const report = { ...makeGeminiReport('test-repo-1'), repository: 'other/repo' };
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Repository mismatch'));
  });

  // Test 8: Valid auth but base_branch mismatch
  await runTest('Callback - base_branch mismatch returns 400', async () => {
    setupTask('test-branch-1');
    const report = { ...makeGeminiReport('test-branch-1'), base_branch: 'develop' };
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Base branch mismatch'));
  });

  // Test 9: Missing repository field
  await runTest('Callback - missing repository returns 400', async () => {
    setupTask('test-missing-repo-1');
    const report = { ...makeGeminiReport('test-missing-repo-1') };
    delete report.repository;
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Missing required field: repository'));
  });

  // Test 10: Missing base_branch field
  await runTest('Callback - missing base_branch returns 400', async () => {
    setupTask('test-missing-branch-1');
    const report = { ...makeGeminiReport('test-missing-branch-1') };
    delete report.base_branch;
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Missing required field: base_branch'));
  });

  // Test 11: Gemini success callback
  await runTest('Callback - Gemini success transitions to VERIFIED', async () => {
    setupTask('test-success-1');
    const report = makeGeminiReport('test-success-1', 'test-task', 'success');
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 200);
    assertEqual(res.body.status, 'Gemini completion recorded');
    assertEqual(res.body.next_action, 'complete');
    assertEqual(res.body.task_status, 'VERIFIED');
    assertEqual(res.body.gemini_status, 'success');

    // Verify task state
    const task = taskRegistry.getTask('test-success-1');
    assertEqual(task.status, 'VERIFIED');
    assertEqual(task.gemini.status, 'success');
  });

  // Test 10: Gemini failure callback
  await runTest('Callback - Gemini failure transitions to FAILED', async () => {
    setupTask('test-failure-1');
    const report = makeGeminiReport('test-failure-1', 'test-task', 'failure');
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 200);
    assertEqual(res.body.status, 'Gemini completion recorded');
    assertEqual(res.body.next_action, 'human_review');
    assertEqual(res.body.task_status, 'FAILED');
    assertEqual(res.body.gemini_status, 'failure');

    const task = taskRegistry.getTask('test-failure-1');
    assertEqual(task.status, 'FAILED');
    assertEqual(task.gemini.status, 'failure');
  });

  // Test 11: Gemini blocked callback
  await runTest('Callback - Gemini blocked transitions to BLOCKED', async () => {
    setupTask('test-blocked-1');
    const report = makeGeminiReport('test-blocked-1', 'test-task', 'blocked');
    const res = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res.status, 200);
    assertEqual(res.body.status, 'Gemini completion recorded');
    assertEqual(res.body.next_action, 'human_review');
    assertEqual(res.body.task_status, 'BLOCKED');
    assertEqual(res.body.gemini_status, 'blocked');

    const task = taskRegistry.getTask('test-blocked-1');
    assertEqual(task.status, 'BLOCKED');
    assertEqual(task.gemini.status, 'blocked');
    assertEqual(task.gemini.report.blockers.length, 1);
  });

  // Test 12: Duplicate callback (idempotency)
  await runTest('Callback - duplicate returns 409', async () => {
    setupTask('test-duplicate-1');
    const report = makeGeminiReport('test-duplicate-1', 'test-task', 'success');

    // First callback
    const res1 = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res1.status, 200);

    // Second callback (duplicate)
    const res2 = await makeRequest({
      hostname: 'localhost', port: 3002, path: '/poc/gemini/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res2.status, 409);
    assertEqual(res2.body.status, 'duplicate');
    assertEqual(res2.body.duplicate, true);

    // Verify task state unchanged
    const task = taskRegistry.getTask('test-duplicate-1');
    assertEqual(task.status, 'VERIFIED');
    assertEqual(task.gemini.status, 'success');
  });

  // Test 13: Verify existing @gemini-cli advisory path still works (no callback sent)
  await runTest('Workflow - issue_comment path does not require callback secret', async () => {
    // This is a structural test - we verify the workflow YAML has the right condition
    // The actual workflow test would be in GitHub Actions, but we can check the YAML structure
    const yaml = fs.readFileSync('.github/workflows/main.yml', 'utf8');
    assert(yaml.includes('issue_comment'));
    assert(yaml.includes('workflow_dispatch'));
    assert(yaml.includes('orchestration_context'));
    assert(yaml.includes('ORCHESTRATION_REQUEST_ID'));
  });

  // Test 14: Verify workflow_dispatch inputs are present
  await runTest('Workflow - workflow_dispatch has required inputs', async () => {
    const yaml = fs.readFileSync('.github/workflows/main.yml', 'utf8');
    assert(yaml.includes('request_id:'));
    assert(yaml.includes('task:'));
    assert(yaml.includes('repository:'));
    assert(yaml.includes('base_branch:'));
    assert(yaml.includes('kilo_execution_id:'));
    assert(yaml.includes('required: true'));
  });

  // Test 17: Verify callback payload construction in workflow
  await runTest('Workflow - callback payload includes required ACP fields', async () => {
    const yaml = fs.readFileSync('.github/workflows/main.yml', 'utf8');
    assert(yaml.includes('callback_payload'));
    assert(yaml.includes('invocation_id'));
    assert(yaml.includes('run_id'));
    assert(yaml.includes('x-gemini-callback-secret'));
    assert(yaml.includes('RENDER_GEMINI_CALLBACK_URL'));
    assert(yaml.includes('GEMINI_CALLBACK_SECRET'));
    assert(yaml.includes('repository:'));
    assert(yaml.includes('base_branch:'));
    assert(yaml.includes('gemini_output'));
    assert(yaml.includes('continue-on-error: true'));
    assert(yaml.includes('steps.gemini_run.outcome'));
  });

  server.close();

  console.log(`\n=== Gemini Callback Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);