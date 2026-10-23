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
process.env.KILO_CALLBACK_SECRET = 'test-kilo-secret';
process.env.GEMINI_CALLBACK_SECRET = 'test-gemini-secret';

// Load the routes
const { router: pocRouter } = require('../routes/poc');
app.use('/poc', pocRouter);

const server = app.listen(3003);

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

const CLAIMS_DIR = path.join(__dirname, '..', 'poc', 'claims');

function cleanupClaim(requestId) {
  const lockPath = path.join(CLAIMS_DIR, requestId + '.claim.lock');
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

function makeKiloReportWithClaim(requestId, task = 'test-task', status = 'success', executionClaimId = null, carrierIdentity = null) {
  const report = {
    request_id: requestId,
    agent: 'Kilo',
    status: status,
    task: task,
    changed_files: ['file1.js'],
    verification: ['test passed'],
    result: { execution_metadata: { invocation_id: 'inv-kilo-1', run_id: 'run-kilo-1' } },
    commit: 'abc123',
    push: true,
    blockers: status === 'blocked' ? ['Missing authorization'] : (status === 'failure' ? ['Implementation failed'] : [])
  };
  if (executionClaimId !== null) {
    report.result.execution_metadata.execution_claim_id = executionClaimId;
  }
  if (carrierIdentity !== null) {
    report.result.execution_metadata.carrier_identity = carrierIdentity;
  }
  return report;
}

function makeKiloReport(requestId, task = 'test-task', status = 'success', claimResult = null) {
  const executionClaimId = claimResult && claimResult.execution_claim_id;
  const carrierIdentity = claimResult && claimResult.carrier_identity;
  return makeKiloReportWithClaim(requestId, task, status, executionClaimId, carrierIdentity);
}

async function setupTask(requestId, task = 'test-task') {
    cleanup();
    await taskRegistry.createTask(makeCommand(requestId, task));
    await taskRegistry.updateTaskStatus(requestId, 'SELECTED');
    await taskRegistry.updateTaskStatus(requestId, 'PLANNED');
    await taskRegistry.updateTaskStatus(requestId, 'EXECUTING');
    const claim = await taskRegistry.claimExecutionContext(requestId, {
      carrier_id: 'github-workflow-kilo-test',
      carrier_type: 'github_workflow'
    });
    return claim;
}

async function setupTaskWithoutClaim(requestId, task = 'test-task') {
    cleanup();
    await taskRegistry.createTask(makeCommand(requestId, task));
    await taskRegistry.updateTaskStatus(requestId, 'SELECTED');
    await taskRegistry.updateTaskStatus(requestId, 'PLANNED');
    await taskRegistry.updateTaskStatus(requestId, 'EXECUTING');
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
  await runTest('Kilo Callback - missing auth header returns 401', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { request_id: 'test-1', agent: 'Kilo', status: 'success' });
    assertEqual(res.status, 401);
    assertEqual(res.body.status, 'authentication blocked');
  });

  // Test 2: Invalid auth header
  await runTest('Kilo Callback - invalid auth header returns 401', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'wrong' }
    }, { request_id: 'test-1', agent: 'Kilo', status: 'success' });
    assertEqual(res.status, 401);
    assertEqual(res.body.status, 'authentication blocked');
  });

  // Test 3: Valid auth but missing request_id
  await runTest('Kilo Callback - missing request_id returns 400', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, { agent: 'Kilo', status: 'success' });
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Missing request_id'));
  });

  // Test 4: Valid auth but malformed report (missing required fields)
  await runTest('Kilo Callback - malformed report returns 400', async () => {
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, { request_id: 'test-1', agent: 'Kilo' }); // missing status, task, etc.
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Invalid execution report'));
  });

  // Test 5: Valid auth but unknown request_id
  await runTest('Kilo Callback - unknown request_id returns 404', async () => {
    const report = makeKiloReport('unknown-request');
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 404);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Unknown request_id'));
  });

  // Test 6: Valid auth but wrong agent
  await runTest('Kilo Callback - wrong agent (Gemini) returns 400', async () => {
    setupTask('test-agent-1');
    const report = { ...makeKiloReport('test-agent-1'), agent: 'Gemini' };
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Expected Kilo report'));
  });

  // Test 7: Valid auth but repository mismatch
  await runTest('Kilo Callback - repository mismatch returns 400', async () => {
    setupTask('test-repo-1');
    const report = { ...makeKiloReport('test-repo-1'), repository: 'other/repo' };
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Repository mismatch'));
  });

  // Test 8: Valid auth but base_branch mismatch
  await runTest('Kilo Callback - base_branch mismatch returns 400', async () => {
    setupTask('test-branch-1');
    const report = { ...makeKiloReport('test-branch-1'), base_branch: 'develop' };
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 400);
    assertEqual(res.body.status, 'validation blocked');
    assert(res.body.error.includes('Base branch mismatch'));
  });

  // Test 9: Kilo success callback - triggers Gemini
  await runTest('Kilo Callback - success transitions to EXECUTING and triggers Gemini', async () => {
    const requestId = 'test-success-1';
    const claim = await setupTask(requestId);
    const report = makeKiloReport(requestId, 'test-task', 'success', claim);
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 200);
    assertEqual(res.body.status, 'Kilo completion recorded');
    assertEqual(res.body.next_action, 'trigger_builder');
    assertEqual(res.body.task_status, 'EXECUTING');
    assertEqual(res.body.kilo_status, 'success');

    // Verify task state
    const task = taskRegistry.getTask('test-success-1');
    assertEqual(task.status, 'EXECUTING');
    assertEqual(task.kilo.status, 'success');
    assertEqual(task.current_agent, 'Gemini');
    assertEqual(task.next_agent, 'Gemini');
    assertEqual(task.next_action, 'trigger_builder');
  });

  // Test 10: Kilo failure callback
  await runTest('Kilo Callback - failure transitions to FAILED', async () => {
    const requestId = 'test-failure-1';
    const claim = await setupTask(requestId);
    const report = makeKiloReport(requestId, 'test-task', 'failure', claim);
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 200);
    assertEqual(res.body.status, 'Kilo completion recorded');
    assertEqual(res.body.next_action, 'human_review');
    assertEqual(res.body.task_status, 'FAILED');
    assertEqual(res.body.kilo_status, 'failure');

    const task = taskRegistry.getTask('test-failure-1');
    assertEqual(task.status, 'FAILED');
    assertEqual(task.kilo.status, 'failure');
  });

  // Test 11: Kilo blocked callback
  await runTest('Kilo Callback - blocked transitions to BLOCKED', async () => {
    const requestId = 'test-blocked-1';
    const claim = await setupTask(requestId);
    const report = makeKiloReport(requestId, 'test-task', 'blocked', claim);
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 200);
    assertEqual(res.body.status, 'Kilo completion recorded');
    assertEqual(res.body.next_action, 'human_review');
    assertEqual(res.body.task_status, 'BLOCKED');
    assertEqual(res.body.kilo_status, 'blocked');

    const task = taskRegistry.getTask('test-blocked-1');
    assertEqual(task.status, 'BLOCKED');
    assertEqual(task.kilo.status, 'blocked');
    assertEqual(task.kilo.report.blockers.length, 1);
  });

  // Test 12: Duplicate callback (idempotency)
  await runTest('Kilo Callback - duplicate returns 409', async () => {
    const requestId = 'test-duplicate-1';
    const claim = await setupTask(requestId);
    const report = makeKiloReport(requestId, 'test-task', 'success', claim);

    // First callback
    const res1 = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res1.status, 200);

    // Second callback (duplicate)
    const res2 = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res2.status, 409);
    assertEqual(res2.body.status, 'duplicate');
    assertEqual(res2.body.duplicate, true);

    // Verify task state unchanged
    const task = taskRegistry.getTask('test-duplicate-1');
    assertEqual(task.status, 'EXECUTING');
    assertEqual(task.kilo.status, 'success');
  });

  // Test 13: Verify Kilo callback payload uses correct secret header
  await runTest('Kilo Callback - uses x-kilo-callback-secret header', async () => {
    setupTask('test-secret-1');
    const report = makeKiloReport('test-secret-1', 'test-task', 'success');

    // Try with Gemini secret (should fail)
    const res1 = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-callback-secret': 'test-gemini-secret' }
    }, report);
    assertEqual(res1.status, 401);
    assertEqual(res1.body.status, 'authentication blocked');

    // Try with POC trigger secret (should fail)
    const res2 = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-poc-trigger-secret': 'test-secret' }
    }, report);
    assertEqual(res2.status, 401);
    assertEqual(res2.body.status, 'authentication blocked');
  });

  // Test 14: Kilo callback without KILO_CALLBACK_SECRET env fails closed
  await runTest('Kilo Callback - missing env secret fails closed', async () => {
    // Temporarily remove the secret
    const originalSecret = process.env.KILO_CALLBACK_SECRET;
    delete process.env.KILO_CALLBACK_SECRET;

    setupTask('test-no-secret-1');
    const report = makeKiloReport('test-no-secret-1', 'test-task', 'success');
    const res = await makeRequest({
      hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
    }, report);
    assertEqual(res.status, 401);
    assertEqual(res.body.status, 'authentication blocked');

    // Restore secret
    process.env.KILO_CALLBACK_SECRET = originalSecret;
  });

   // Test 15: Validation before state mutation - malformed report doesn't change state
   await runTest('Kilo Callback - validation failure does not mutate state', async () => {
     setupTask('test-validation-1');
     const malformedReport = { ...makeKiloReport('test-validation-1'), status: 'invalid-status' };
     const res = await makeRequest({
       hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
       headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
     }, malformedReport);
     assertEqual(res.status, 400);
     assertEqual(res.body.status, 'validation blocked');

     // Verify task state unchanged (kilo still pending)
     const task = taskRegistry.getTask('test-validation-1');
     assertEqual(task.kilo.status, 'pending');
     assertEqual(task.status, 'EXECUTING');
   });

   // =========================================================
   // Kilo callback execution claim correlation tests
   // =========================================================
    await runTest('Kilo Callback - no execution claim on task: callback fails closed (EXECUTION_CLAIM_MISSING)', async () => {
      const requestId = 'kilo-corr-no-claim-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const report = makeKiloReportWithClaim(requestId, 'test-task', 'success', null, null);
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 403);
      assertEqual(res.body.error_code, 'EXECUTION_CLAIM_MISSING');
      cleanupClaim(requestId);
    });

    await runTest('Kilo Callback - correct execution_claim_id + carrier_identity succeeds', async () => {
      const requestId = 'kilo-corr-ok-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const claimResult = await taskRegistry.claimExecutionContext(requestId, {
        carrier_id: 'github-workflow-kilo-corr-1',
        carrier_type: 'github_workflow'
      });
      assert.strictEqual(claimResult.success, true);

      const report = makeKiloReportWithClaim(
        requestId, 'test-task', 'success',
        claimResult.execution_claim_id,
        'github-workflow-kilo-corr-1'
      );
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 200);
      assertEqual(res.body.status, 'Kilo completion recorded');
      assertEqual(res.body.next_action, 'trigger_builder');
      cleanupClaim(requestId);
    });

    await runTest('Kilo Callback - wrong execution_claim_id is rejected (fail-closed)', async () => {
      const requestId = 'kilo-corr-claim-mismatch-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const claimResult = await taskRegistry.claimExecutionContext(requestId, {
        carrier_id: 'github-workflow-kilo-corr-2',
        carrier_type: 'github_workflow'
      });
      assert.strictEqual(claimResult.success, true);

      const report = makeKiloReportWithClaim(
        requestId, 'test-task', 'success',
        'wrong-claim-id',
        'github-workflow-kilo-corr-2'
      );
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 403);
      assertEqual(res.body.error_code, 'EXECUTION_CLAIM_MISMATCH');
      cleanupClaim(requestId);
    });

    await runTest('Kilo Callback - wrong carrier_identity is rejected (fail-closed)', async () => {
      const requestId = 'kilo-corr-carrier-mismatch-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const claimResult = await taskRegistry.claimExecutionContext(requestId, {
        carrier_id: 'github-workflow-kilo-corr-3',
        carrier_type: 'github_workflow'
      });
      assert.strictEqual(claimResult.success, true);

      const report = makeKiloReportWithClaim(
        requestId, 'test-task', 'success',
        claimResult.execution_claim_id,
        'wrong-carrier-identity'
      );
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 403);
      assertEqual(res.body.error_code, 'CARRIER_IDENTITY_MISMATCH');
      cleanupClaim(requestId);
    });

    await runTest('Kilo Callback - missing execution_claim_id with authoritative claim returns 403', async () => {
      const requestId = 'kilo-missing-claim-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const claimResult = await taskRegistry.claimExecutionContext(requestId, {
        carrier_id: 'github-workflow-kilo-missing-claim',
        carrier_type: 'github_workflow'
      });
      assert.strictEqual(claimResult.success, true);

      const report = makeKiloReportWithClaim(
        requestId, 'test-task', 'success',
        null,
        'github-workflow-kilo-missing-claim'
      );
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 403);
      assertEqual(res.body.error_code, 'EXECUTION_CLAIM_MISSING');
      cleanupClaim(requestId);
    });

    await runTest('Kilo Callback - missing carrier_identity with authoritative claim returns 403', async () => {
      const requestId = 'kilo-missing-carrier-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const claimResult = await taskRegistry.claimExecutionContext(requestId, {
        carrier_id: 'github-workflow-kilo-missing-carrier',
        carrier_type: 'github_workflow'
      });
      assert.strictEqual(claimResult.success, true);

      const report = makeKiloReportWithClaim(
        requestId, 'test-task', 'success',
        claimResult.execution_claim_id,
        null
      );
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 403);
      assertEqual(res.body.error_code, 'CARRIER_IDENTITY_MISSING');
      cleanupClaim(requestId);
    });

    await runTest('Kilo Callback - no dispatch after correlation failure (task state unchanged)', async () => {
      const requestId = 'kilo-corr-no-dispatch-' + Date.now();
      await setupTaskWithoutClaim(requestId);

      const claimResult = await taskRegistry.claimExecutionContext(requestId, {
        carrier_id: 'github-workflow-kilo-no-dispatch',
        carrier_type: 'github_workflow'
      });
      assert.strictEqual(claimResult.success, true);

      const report = makeKiloReportWithClaim(
        requestId, 'test-task', 'success',
        'wrong-claim-id',
        'github-workflow-kilo-no-dispatch'
      );
      const res = await makeRequest({
        hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
      }, report);
      assertEqual(res.status, 403);
      assertEqual(res.body.error_code, 'EXECUTION_CLAIM_MISMATCH');

      const task = taskRegistry.getTask(requestId);
      assertEqual(task.kilo.status, 'pending');
      assertEqual(task.status, 'EXECUTING');
      cleanupClaim(requestId);
    });

   await runTest('Kilo Callback - survives in-memory cache reset with claim persisted in registry (restart simulation)', async () => {
     const requestId = 'kilo-rehydrate-registry-' + Date.now();
     cleanup();
     await taskRegistry.createTask(makeCommand(requestId, 'test-task'));
     await taskRegistry.updateTaskStatus(requestId, 'SELECTED');
     await taskRegistry.updateTaskStatus(requestId, 'PLANNED');
     await taskRegistry.updateTaskStatus(requestId, 'EXECUTING');

     const claimResult = await taskRegistry.claimExecutionContext(requestId, {
       carrier_id: 'github-workflow-kilo-rehydrate-reg',
       carrier_type: 'github_workflow'
     });
     assert.strictEqual(claimResult.success, true);

     taskRegistry.resetMemoryCache();
     cleanupClaim(requestId);

     const cachedTask = taskRegistry.getTask(requestId);
     assert.ok(cachedTask, 'Task should be loaded from persisted registry file after restart');

     const report = makeKiloReportWithClaim(
       requestId, 'test-task', 'success',
       claimResult.execution_claim_id,
       'github-workflow-kilo-rehydrate-reg'
     );
     const res = await makeRequest({
       hostname: 'localhost', port: 3003, path: '/poc/kilo/callback', method: 'POST',
       headers: { 'Content-Type': 'application/json', 'x-kilo-callback-secret': 'test-kilo-secret' }
     }, report);
     assertEqual(res.status, 200);
     assertEqual(res.body.status, 'Kilo completion recorded');
     assertEqual(res.body.kilo_status, 'success');
     cleanupClaim(requestId);
   });

  server.close();

  console.log(`\n=== Kilo Callback Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);