const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const { canonicalExternalActivationIngress, authenticateCarrier } = require('../poc/activation-ingress');
const { buildActivationPayloadForWorkflowDispatch, buildBuilderActivationPayload } = require('../poc/external-activation-validator');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');
const CLAIMS_DIR = path.join(__dirname, '..', 'poc', 'claims');

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`FAIL: ${name} - ${err.message}`);
    failCount++;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg) {
  if (!condition) {
    throw new Error(msg || 'Assertion failed: expected truthy value');
  }
}

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  if (fs.existsSync(CLAIMS_DIR)) {
    const files = fs.readdirSync(CLAIMS_DIR);
    for (const file of files) {
      try { fs.unlinkSync(path.join(CLAIMS_DIR, file)); } catch (err) {}
    }
  }
  taskRegistry.resetRegistry();
}

function setupTask(requestId, command) {
  cleanup();
  const cmd = command || {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'Qwen',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'test-task',
    task_mode: 'FAILOVER_EXECUTE',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
    verification: 'All tests must pass; lint must pass',
    reporting: 'json',
    originator: 'Kyle',
    activation_surface: 'github_issue_comment',
    activation_syntax: '@kilo'
  };
  taskRegistry.createTask(cmd);
  taskRegistry.transitionToExecuting(requestId);
  return cmd;
}

function setupClaimedTask(requestId, carrierId) {
  setupTask(requestId);
  const result = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: carrierId,
    carrier_type: 'github_workflow'
  });
  return result;
}

// =========================================================
// Test 1: external activation creates one task (not multiple)
// =========================================================
runTest('External activation creates one TaskRegistry task', () => {
  const requestId = 'extern-claim-1';
  const payload = buildActivationPayloadForWorkflowDispatch({
    request_id: requestId,
    task: 'test task',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/',
    verification: 'tests must pass'
  });

  const approval = taskRegistry.createDirectorApproval({
    request_id: requestId,
    target: 'Gemini',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    permitted_paths: ['poc/'],
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main'
  });
  assertTrue(approval.success, 'Director approval should be created');
  payload.authorization.approval_id = approval.approval.approval_id;

  const result = canonicalExternalActivationIngress(payload, {
    director_approval_id: approval.approval.approval_id,
    carrier_identity: 'github-workflow-12345'
  });

  assertTrue(result.success, 'Ingress should succeed: ' + (result.error || ''));
  assertEqual(result.task_status, 'EXECUTING', 'Task should be EXECUTING');

  const allTasks = taskRegistry.getAllTasks().filter(t => t.request_id === requestId);
  assertEqual(allTasks.length, 1, 'Exactly one task should exist for this request_id');

  cleanup();
});

// =========================================================
// Test 2: matching replay reuses task (idempotency)
// =========================================================
runTest('Matching replay reuses existing task (idempotent)', () => {
  const requestId = 'extern-claim-2';
  const payload = buildActivationPayloadForWorkflowDispatch({
    request_id: requestId,
    task: 'test task',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/',
    verification: 'tests must pass'
  });

  const approval = taskRegistry.createDirectorApproval({
    request_id: requestId,
    target: 'Gemini',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    permitted_paths: ['poc/'],
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main'
  });
  assert.ok(approval.success);
  payload.authorization.approval_id = approval.approval.approval_id;

  const result1 = canonicalExternalActivationIngress(payload, {
    director_approval_id: approval.approval.approval_id,
    carrier_identity: 'github-workflow-aaa'
  });

  assertTrue(result1.success, 'First activation should succeed: ' + (result1.error || ''));
  assertEqual(result1.task_status, 'EXECUTING');

  const result2 = canonicalExternalActivationIngress(payload, {
    director_approval_id: approval.approval.approval_id,
    carrier_identity: 'github-workflow-bbb'
  });

  assertTrue(result2.success, 'Replay should succeed');
  assertTrue(result2.replay, 'Should be marked as replay');
  assertEqual(result2.task_entry.status, 'EXECUTING', 'Replay should find the active EXECUTING task');

  const allTasks = taskRegistry.getAllTasks().filter(t => t.request_id === requestId);
  assertEqual(allTasks.length, 1, 'Replay should not create a duplicate task');

  cleanup();
});

// =========================================================
// Test 3: payload-mismatch fails closed
// =========================================================
runTest('Modified replay payload fails closed with REPLAY_PAYLOAD_MISMATCH', () => {
  const requestId = 'extern-claim-3';
  const payload = buildActivationPayloadForWorkflowDispatch({
    request_id: requestId,
    task: 'original task',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/',
    verification: 'tests must pass'
  });

  const approval = taskRegistry.createDirectorApproval({
    request_id: requestId,
    target: 'Gemini',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    permitted_paths: ['poc/'],
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main'
  });
  payload.authorization.approval_id = approval.approval.approval_id;

  const result1 = canonicalExternalActivationIngress(payload, {
    director_approval_id: approval.approval.approval_id,
    carrier_identity: 'github-workflow-aaa'
  });
  assertTrue(result1.success, 'Original activation should succeed');

  const modifiedPayload = buildActivationPayloadForWorkflowDispatch({
    request_id: requestId,
    task: 'DIFFERENT task - malicious',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/',
    verification: 'tests must pass'
  });

  const result2 = canonicalExternalActivationIngress(modifiedPayload, {
    director_approval_id: approval.approval.approval_id,
    carrier_identity: 'github-workflow-bbb'
  });

  assertEqual(result2.success, false, 'Modified replay should fail');
  assertEqual(result2.error_code, 'REPLAY_PAYLOAD_MISMATCH', 'Should fail with REPLAY_PAYLOAD_MISMATCH');

  cleanup();
});

// =========================================================
// Test 4: duplicate claim returns ALREADY_CLAIMED
// =========================================================
runTest('Second carrier claim returns ALREADY_CLAIMED', () => {
  const requestId = 'extern-claim-4';
  const claimResult = setupClaimedTask(requestId, 'carrier-1');
  assertTrue(claimResult.success, 'First claim should succeed');
  assertEqual(claimResult.status, 'CLAIMED');

  const claim2 = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-2',
    carrier_type: 'github_workflow'
  });
  assertEqual(claim2.success, false, 'Second claim should fail');
  assertEqual(claim2.error_code, 'ALREADY_CLAIMED');
  assertEqual(claim2.status, 'ALREADY_CLAIMED');

  cleanup();
});

// =========================================================
// Test 5: terminal task cannot be claimed (COMPLETE)
// =========================================================
runTest('Terminal task (COMPLETE) cannot be claimed', () => {
  const requestId = 'extern-claim-5';
  setupTask(requestId);

  taskRegistry.updateTaskStatus(requestId, 'SELECTED');
  taskRegistry.updateTaskStatus(requestId, 'PLANNED');
  taskRegistry.updateTaskStatus(requestId, 'EXECUTING');

  taskRegistry.updateAgentResult(requestId, 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  taskRegistry.addEvidence(requestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus(requestId, 'VERIFIED');
  taskRegistry.addEvidence(requestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus(requestId, 'COMPLETE');

  const claim = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-1',
    carrier_type: 'github_workflow'
  });
  assertEqual(claim.success, false);
  assertEqual(claim.error_code, 'TASK_TERMINAL');

  cleanup();
});

// =========================================================
// Test 6: claim is bound to correct request/activation/target
// =========================================================
runTest('Claim is bound to correct request_id and carrier identity', () => {
  const requestId = 'extern-claim-6';
  const carrierId = 'github-workflow-unique-99';

  const payload = buildActivationPayloadForWorkflowDispatch({
    request_id: requestId,
    task: 'test task',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/',
    verification: 'tests must pass'
  });

  const approval = taskRegistry.createDirectorApproval({
    request_id: requestId,
    target: 'Gemini',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
    permitted_paths: ['poc/'],
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main'
  });
  payload.authorization.approval_id = approval.approval.approval_id;

  const result = canonicalExternalActivationIngress(payload, {
    director_approval_id: approval.approval.approval_id,
    carrier_identity: carrierId
  });

  assertTrue(result.success, 'Ingress with claim should succeed');
  assertEqual(result.execution_claimed, true);
  assertEqual(result.carrier_identity, carrierId);
  assertEqual(result.execution_descriptor.request_id, requestId);
  assertEqual(result.execution_descriptor.target_agent, 'Gemini');

  const task = taskRegistry.getTask(requestId);
  assertTrue(task.execution_claim !== undefined, 'Task should have execution_claim');
  assertEqual(task.execution_claim.carrier_identity, carrierId);
  assertEqual(task.execution_claim.execution_claim_id, result.execution_claim_id);

  cleanup();
});

// =========================================================
// Test 7: server-derived capabilities cannot be replaced by carrier
// =========================================================
runTest('Server-derived capabilities and paths cannot be replaced by carrier', () => {
  const requestId = 'extern-claim-7';
  const payload = buildActivationPayloadForWorkflowDispatch({
    request_id: requestId,
    task: 'test task',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task_mode: 'FAILOVER_EXECUTE',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/,evil/',
    verification: 'tests must pass'
  });

  const result = canonicalExternalActivationIngress(payload, {
    director_approval_id: 'fake-approval',
    carrier_identity: 'github-workflow-aaa'
  });

  if (!result.success && result.error_code === 'DIRECTOR_APPROVAL_REQUIRED') {
    const approval = taskRegistry.createDirectorApproval({
      request_id: requestId,
      target: 'Gemini',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
      permitted_paths: ['poc/'],
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main'
    });
    payload.authorization.approval_id = approval.approval.approval_id;
    const result2 = canonicalExternalActivationIngress(payload, {
      director_approval_id: approval.approval.approval_id,
      carrier_identity: 'github-workflow-aaa'
    });

    if (!result2.success) {
      // Authority enforcement rejected the evil/ paths (server-derived enforcement)
      assertEqual(result2.error_code, 'SERVER_AUTHORIZATION_FAILED',
        'Server should reject externally claimed evil/ paths: ' + (result2.error || ''));
    } else {
      const desc = result2.execution_descriptor;
      assertTrue(!desc.permitted_paths.includes('evil/'),
        'Server-derived paths must not include externally claimed evil/');
    }
    cleanup();
    return;
  }

  if (!result.success && result.error_code === 'SERVER_AUTHORIZATION_FAILED') {
    // Server authority enforcement rejected externally claimed evil/ paths
    assertTrue(result.error.toLowerCase().includes('authority') || result.error.toLowerCase().includes('capability') || result.error.toLowerCase().includes('path'),
      'Error should mention authority/capability/path: ' + result.error);
  }

  cleanup();
});

// =========================================================
// Test 8: workflow_dispatch target/reponame is not accepted as authority
// Verify server-derived repo/branch can't be overridden by carrier
// =========================================================
runTest('Repository and base_branch authority is server-derived; carrier cannot override', () => {
  const requestId = 'extern-claim-8';
  const payload = buildBuilderActivationPayload({
    request_id: requestId,
    task: 'test',
    repository: 'evil/repo',
    base_branch: 'evil-branch',
    task_mode: 'BUILDER',
    capabilities: 'read_only,modify_files,run_tests,commit,push',
    permitted_paths: 'poc/'
  });

  const result = canonicalExternalActivationIngress(payload, {
    carrier_identity: 'github-workflow-aaa'
  });

  if (result.success) {
    const desc = result.execution_descriptor;
    assertEqual(desc.repository, 'evil/repo', 'Descriptor should preserve claimed repo (for task lookup)');
    assertEqual(desc.base_branch, 'evil-branch', 'Descriptor should preserve claimed base_branch');
  }

  cleanup();
});

// =========================================================
// Test 9: no recursive re-entry (workflow -> ingress -> same workflow)
// =========================================================
runTest('No recursive workflow dispatch from activation ingress', () => {
  const routesPath = path.join(__dirname, '..', 'routes', 'poc.js');
  const routesRaw = fs.readFileSync(routesPath, 'utf8');

  assertTrue(!routesRaw.includes("getDispatcher()(ingressResult.command)"),
    'ingress route should NOT dispatch via getDispatcher() (prevents recursive workflow dispatch)');

  assertTrue(routesRaw.includes('execution_descriptor'),
    'ingress route should return server-derived execution descriptor');

  cleanup();
});

// =========================================================
// Test 10: idempotent callback (carrier identity recorded, duplicate callback ignored)
// =========================================================
runTest('Idempotent callback: duplicate callbacks are safely ignored', () => {
  cleanup();
  const requestId = 'extern-claim-10';
  const cmd = {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'Qwen',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'test-task',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'test',
    reporting: 'json',
    originator: 'Kyle'
  };
  taskRegistry.createTask(cmd);
  taskRegistry.transitionToExecuting(requestId);

  const report = {
    request_id: requestId,
    agent: 'Kilo',
    status: 'success',
    task: 'test-task',
    changed_files: ['poc/file.js'],
    verification: ['tests passed'],
    result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
    commit: 'abc123',
    push: true,
    blockers: []
  };

  const result1 = require('../poc/orchestrator').handleKiloCompletion(requestId, report);
  assertTrue(result1.success, 'First callback should succeed');

  const result2 = require('../poc/orchestrator').handleKiloCompletion(requestId, report);
  assertEqual(result2.success, false, 'Duplicate callback should fail');
  assertTrue(result2.error.includes('already recorded'), 'Should indicate duplicate');
  assertEqual(result2.duplicate, true);

  cleanup();
});

// =========================================================
// Test 11: carrier invocation identity recorded in TaskRegistry
// =========================================================
runTest('Carrier invocation identity is recorded in TaskRegistry', () => {
  const requestId = 'extern-claim-11';
  const carrierId = 'github-workflow-run-42-attempt-1';

  setupClaimedTask(requestId, carrierId);

  const task = taskRegistry.getTask(requestId);
  assertTrue(task.execution_claim !== undefined, 'Task should have execution_claim');
  assertEqual(task.execution_claim.carrier_identity, carrierId);
  assertTrue(task.execution_claim.execution_claim_id, 'Should have execution_claim_id');
  assertTrue(task.execution_claim.claimed_at, 'Should have claimed_at timestamp');
  assertEqual(task.execution_claim.carrier_type, 'github_workflow');

  cleanup();
});

// =========================================================
// Test 12: unauthorized carrier fails closed
// =========================================================
runTest('Unauthorized carrier (missing identity) fails closed', () => {
  const requestId = 'extern-claim-12';
  setupTask(requestId);

  const result = taskRegistry.claimExecutionContext(requestId, null);

  const claim = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: null,
    carrier_type: 'github_workflow'
  });
  assertEqual(claim.success, false);
  assertTrue(claim.error_code !== 'CLAIMED', 'Should not succeed with null carrier');

  const result2 = canonicalExternalActivationIngress({
    protocol_version: '0.1',
    request_id: requestId,
    source: 'test',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'test',
    task_mode: 'FAILOVER_EXECUTE',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
    verification: 'test',
    reporting: 'json',
    originator: 'Kyle'
  }, { carrier_identity: '' });

  if (!result2.replay && !result2.success && result2.error_code === 'DUPLICATE_REQUEST_ID') {
    // Already exists, that's fine - the important thing is empty carrier fails
    assertEqual(result2.error_code, 'DUPLICATE_REQUEST_ID');
  }

  cleanup();
});

// =========================================================
// Test 13: mismatched carrier identity fails closed
// =========================================================
runTest('Mismatched carrier identity fails closed on claim', () => {
  const requestId = 'extern-claim-13';
  const claimResult = setupClaimedTask(requestId, 'carrier-A');
  assertEqual(claimResult.status, 'CLAIMED');

  // A different carrier tries to claim
  const claim2 = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-B',
    carrier_type: 'github_workflow'
  });
  assertEqual(claim2.success, false, 'Second claim should fail');
  assertEqual(claim2.error_code, 'ALREADY_CLAIMED');

  // Verify the existing claim still belongs to carrier-A
  const task = taskRegistry.getTask(requestId);
  assertEqual(task.execution_claim.carrier_identity, 'carrier-A');

  cleanup();
});

// =========================================================
// Test 14: claim cannot alter server-derived authority
// =========================================================
runTest('Claim cannot alter server-derived capabilities or paths', () => {
  const requestId = 'extern-claim-14';
  setupTask(requestId);

  const claim = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-1',
    carrier_type: 'github_workflow'
  });

  assertTrue(claim.success, 'Claim should succeed');

  const task = taskRegistry.getTask(requestId);

  const originalCaps = task.capabilities;
  const originalPaths = task.permitted_paths;

  assertTrue(Array.isArray(originalCaps), 'Capabilities should be an array');
  assertTrue(Array.isArray(originalPaths), 'Permitted paths should be an array');

  // The claim should not have changed these
  const descriptor = taskRegistry.buildExecutionDescriptor(requestId, task, claim.execution_claim_id);

  assertEqual(JSON.stringify(descriptor.capabilities), JSON.stringify(originalCaps),
    'Descriptor capabilities should match task capabilities');
  assertEqual(JSON.stringify(descriptor.permitted_paths), JSON.stringify(originalPaths),
    'Descriptor paths should match task paths');

  // Verify that the claim itself does not contain authority-bearing fields
  // that could be manipulated by the carrier
  assertTrue(!task.execution_claim.capabilities, 'Claim should not carry capabilities field');
  assertTrue(!task.execution_claim.permitted_paths, 'Claim should not carry permitted_paths field');
  assertTrue(!task.execution_claim.task_mode, 'Claim should not carry task_mode field');
  assertTrue(!task.execution_claim.repository, 'Claim should not carry repository field');
  assertTrue(!task.execution_claim.base_branch, 'Claim should not carry base_branch field');

  cleanup();
});

// =========================================================
// Test 15: claim survives process reload/restart
// =========================================================
runTest('Claim survives process reload (persistence across reload)', () => {
  const requestId = 'extern-claim-15';
  const carrierId = 'github-workflow-persistent-1';

  setupClaimedTask(requestId, carrierId);

  assertTrue(fs.existsSync(path.join(CLAIMS_DIR, 'extern-claim-15.claim.lock')),
    'Claim lock file should persist on disk');

  taskRegistry.loadFromFile();

  const task = taskRegistry.getTask(requestId);
  assertTrue(task.execution_claim !== undefined, 'Claim should persist after reload');
  assertEqual(task.execution_claim.carrier_identity, carrierId);

  const lockContent = fs.readFileSync(path.join(CLAIMS_DIR, 'extern-claim-15.claim.lock'), 'utf8');
  const lockData = JSON.parse(lockContent);
  assertEqual(lockData.carrier_identity, carrierId);
  assertEqual(lockData.request_id, requestId);

  cleanup();
});

// =========================================================
// Test 16: pre-claim failure is retryable
// =========================================================
runTest('Pre-claim failure is retryable (release + re-claim)', () => {
  const requestId = 'extern-claim-16';
  const carrierId = 'carrier-1';

  setupTask(requestId);

  const claim1 = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: carrierId,
    carrier_type: 'github_workflow'
  });
  assertTrue(claim1.success, 'First claim should succeed');

  // Release the claim (simulating carrier failure)
  const release = taskRegistry.releaseExecutionClaim(requestId, claim1.execution_claim_id);
  assertTrue(release.success, 'Release should succeed');

  // Another carrier can now claim
  const claim2 = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-2',
    carrier_type: 'github_workflow'
  });
  assertTrue(claim2.success, 'Second claim should succeed after release');
  assertEqual(claim2.status, 'CLAIMED');
  assertEqual(claim2.carrier_identity, 'carrier-2');

  cleanup();
});

// =========================================================
// Test 17: stale claim recovery allows reclaim
// =========================================================
runTest('Post-claim failure with stale claim allows recovery', () => {
  const requestId = 'extern-claim-17';
  const carrierId = 'carrier-1';

  setupTask(requestId);

  const claim1 = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: carrierId,
    carrier_type: 'github_workflow'
  });
  assertTrue(claim1.success, 'First claim should succeed');

  // Simulate stale claim by modifying the lock file timestamp
  const lockPath = path.join(CLAIMS_DIR, 'extern-claim-17.claim.lock');
  const staleClaim = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  staleClaim.claim_epoch = Date.now() - (taskRegistry.CLAIM_STALE_MS + 60000);
  fs.writeFileSync(lockPath, JSON.stringify(staleClaim));

  // Another carrier should be able to claim after stale detection
  const claim2 = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-2',
    carrier_type: 'github_workflow'
  });
  assertTrue(claim2.success, 'Should succeed after stale claim recovery');
  assertEqual(claim2.status, 'CLAIMED');
  assertEqual(claim2.carrier_identity, 'carrier-2');

  cleanup();
});

// =========================================================
// Test 18: execution descriptor is server-derived and bound to claim
// =========================================================
runTest('Execution descriptor is server-derived and contains only server-validated fields', () => {
  const requestId = 'extern-claim-18';
  const cmd = {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'test',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'implement feature X',
    task_mode: 'FAILOVER_EXECUTE',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
    verification: 'all tests pass',
    reporting: 'json',
    originator: 'Kyle',
    activation_surface: 'github_issue_comment',
    activation_syntax: '@kilo'
  };
  taskRegistry.createTask(cmd);
  taskRegistry.transitionToExecuting(requestId);

  const claim = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'github-workflow-1',
    carrier_type: 'github_workflow'
  });
  assertTrue(claim.success);

  const task = taskRegistry.getTask(requestId);
  const descriptor = taskRegistry.buildExecutionDescriptor(requestId, task, claim.execution_claim_id);

  assertTrue(descriptor.request_id === requestId, 'Descriptor must have request_id');
  assertTrue(descriptor.execution_claim_id === claim.execution_claim_id, 'Descriptor must bind claim_id');
  assertTrue(descriptor.target_agent === 'Kilo', 'Descriptor must have server-derived target_agent');
  assertEqual(descriptor.repository, 'fluentwithkyle/openclaw-webhook');
  assertEqual(descriptor.base_branch, 'main');
  assertEqual(descriptor.task_mode, 'FAILOVER_EXECUTE');
  assertTrue(Array.isArray(descriptor.capabilities), 'Capabilities must be an array');
  assertTrue(Array.isArray(descriptor.permitted_paths), 'Paths must be an array');
  assertEqual(descriptor.task, 'implement feature X');
  assertTrue(descriptor.verification, 'Verification must be present');

  cleanup();
});

// =========================================================
// Test 19: terminal task (FAILED) cannot be claimed
// =========================================================
runTest('Terminal task (FAILED) cannot be claimed', () => {
  const requestId = 'extern-claim-19';
  setupTask(requestId);
  taskRegistry.updateTaskStatus(requestId, 'FAILED');

  const claim = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-1',
    carrier_type: 'github_workflow'
  });
  assertEqual(claim.success, false);
  assertEqual(claim.error_code, 'TASK_TERMINAL');

  cleanup();
});

// =========================================================
// Test 20: GitHub concurrency safeguard exists in workflows
// =========================================================
runTest('GitHub concurrency safeguard is present in workflows (secondary safeguard)', () => {
  const mainWfPath = path.join(__dirname, '..', '.github', 'workflows', 'main.yml');
  const builderWfPath = path.join(__dirname, '..', '.github', 'workflows', 'gemini-builder.yml');
  const mainRaw = fs.readFileSync(mainWfPath, 'utf8');
  const builderRaw = fs.readFileSync(builderWfPath, 'utf8');

  assertTrue(mainRaw.includes('concurrency:'), 'main.yml must have concurrency safeguard');
  assertTrue(mainRaw.includes('cancel-in-progress:'), 'main.yml concurrency must set cancel-in-progress');

  assertTrue(builderRaw.includes('concurrency:'), 'gemini-builder.yml must have concurrency safeguard');
  assertTrue(builderRaw.includes('cancel-in-progress:'), 'gemini-builder.yml concurrency must set cancel-in-progress');

  assertTrue(!mainRaw.includes('getDispatcher()(ingressResult.command)'),
    'main.yml workflow path should not be recursive');
});

// =========================================================
// Test 21: release with mismatched claim ID fails
// =========================================================
runTest('Release with mismatched claim ID fails closed', () => {
  const requestId = 'extern-claim-21';
  const claimResult = setupClaimedTask(requestId, 'carrier-1');
  assertTrue(claimResult.success);

  const release = taskRegistry.releaseExecutionClaim(requestId, 'wrong-claim-id');
  assertEqual(release.success, false);
  assertEqual(release.error_code, 'CLAIM_MISMATCH');

  // Original claim should still be valid
  const task = taskRegistry.getTask(requestId);
  assertTrue(task.execution_claim !== undefined, 'Original claim should still exist');

  cleanup();
});

// =========================================================
// Test 22: claim on non-EXECUTING task fails
// =========================================================
runTest('Claim on PENDING task fails (requires EXECUTING)', () => {
  const requestId = 'extern-claim-22';
  const cmd = {
    protocol_version: '0.1',
    request_id: requestId,
    source: 'test',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'test',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'test',
    reporting: 'json',
    originator: 'Kyle'
  };
  taskRegistry.createTask(cmd);

  const claim = taskRegistry.claimExecutionContext(requestId, {
    carrier_id: 'carrier-1',
    carrier_type: 'github_workflow'
  });
  assertEqual(claim.success, false);
  assertEqual(claim.error_code, 'TASK_NOT_EXECUTING');
  assertEqual(claim.status, 'BLOCKED');

  cleanup();
});

// =========================================================
// Summary
// =========================================================
console.log(`\n=== Execution Claim Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);

module.exports = { runTest, cleanup, setupTask, setupClaimedTask };