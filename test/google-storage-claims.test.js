const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

function runTest(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log('PASS: ' + name);
        return true;
      }).catch(err => {
        console.error('FAIL: ' + name + ' - ' + err.message);
        return false;
      });
    }
    console.log('PASS: ' + name);
    return true;
  } catch (err) {
    console.error('FAIL: ' + name + ' - ' + err.message);
    return false;
  }
}

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  const result = runTest(name, fn);
  if (result && typeof result.then === 'function') {
    return result.then(r => { if (r) passCount++; else failCount++; });
  }
  if (result) passCount++; else failCount++;
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'Assertion failed') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

const validCommand = {
  protocol_version: '0.1',
  request_id: 'gs-test-1',
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

let claimStore = {};
let appsScriptCallCount = 0;
let simulateStorageError = false;
const CLAIM_STALE_MS = 15 * 60 * 1000;

function mockIsClaimStale(claimRecord) {
  if (!claimRecord || !claimRecord.claim_epoch) return true;
  return (Date.now() - Number(claimRecord.claim_epoch)) > CLAIM_STALE_MS;
}

function makeMockAppsScript() {
  return {
    isAppsScriptConfigured: function() { return true; },
    acquireClaimViaAppsScript: async function(requestId, claimIdentity) {
      appsScriptCallCount++;

      if (simulateStorageError) {
        return { success: false, status: 'error', error_code: 'STORAGE_ERROR', error: 'Simulated storage failure' };
      }

      var carrierId = claimIdentity && claimIdentity.carrier_id ? claimIdentity.carrier_id : null;
      if (!carrierId) {
        return { success: false, status: 'error', error_code: 'CLAIM_FAILED', error: 'carrier_identity is required' };
      }

      if (claimStore[requestId]) {
        return {
          success: false,
          status: 'ALREADY_CLAIMED',
          error_code: 'ALREADY_CLAIMED',
          error: 'Task already has an active execution claim',
          existing_claim: claimStore[requestId]
        };
      }

      const claim = {
        request_id: requestId,
        execution_claim_id: 'claim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
        carrier_identity: claimIdentity && claimIdentity.carrier_id ? claimIdentity.carrier_id : null,
        carrier_type: claimIdentity && claimIdentity.carrier_type ? claimIdentity.carrier_type : 'github_workflow',
        claimed_at: new Date().toISOString(),
        claim_epoch: Date.now(),
        status: 'CLAIMED'
      };
      claimStore[requestId] = claim;
      return {
        success: true,
        status: 'CLAIMED',
        error_code: 'CLAIMED',
        execution_claim_id: claim.execution_claim_id,
        carrier_identity: claim.carrier_identity,
        carrier_type: claim.carrier_type,
        claimed_at: claim.claimed_at,
        claim_epoch: claim.claim_epoch,
        backend: 'google_apps_script'
      };
    },
    getClaimFromAppsScript: async function(requestId) {
      appsScriptCallCount++;

      if (simulateStorageError) {
        return { status: 'error', error_code: 'STORAGE_ERROR', error: 'Simulated storage failure' };
      }

      const claim = claimStore[requestId];
      if (!claim) {
        return { status: 'NOT_FOUND', error_code: 'NOT_FOUND' };
      }
      return {
        status: 'CLAIMED',
        error_code: 'CLAIMED',
        claim: Object.assign({}, claim, { stale: mockIsClaimStale(claim) })
      };
    },
    releaseClaimFromAppsScript: async function(requestId, executionClaimId) {
      appsScriptCallCount++;

      if (simulateStorageError) {
        return { success: false, error_code: 'STORAGE_ERROR', error: 'Simulated storage failure' };
      }

      const claim = claimStore[requestId];
      if (!claim) {
        return { success: false, error_code: 'NOT_FOUND', error: 'No claim found' };
      }
      if (executionClaimId && claim.execution_claim_id !== executionClaimId) {
        return { success: false, error_code: 'CLAIM_MISMATCH', error: 'Execution claim ID does not match' };
      }
      delete claimStore[requestId];
      return { success: true, status: 'RELEASED', error_code: 'RELEASED' };
    },
    submitClaimOperation: function() {},
    normalizeClaimResponse: function(r) { return r; },
    triggerAppsScript: function() {}
  };
}

function setupMockedTaskRegistry() {
  const modulePath = require.resolve('../services/appsScript');
  if (require.cache[modulePath]) {
    delete require.cache[modulePath];
  }
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: makeMockAppsScript()
  };
}

const taskRegistryModulePath = require.resolve('../poc/task-registry');

function loadFreshTaskRegistry() {
  if (require.cache[taskRegistryModulePath]) {
    delete require.cache[taskRegistryModulePath];
  }
  setupMockedTaskRegistry();
  return require('../poc/task-registry');
}

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  claimStore = {};
  appsScriptCallCount = 0;
  simulateStorageError = false;
}

async function runAllTests() {
  await test('Google Storage - concurrent claim acquisition: second carrier gets ALREADY_CLAIMED', async () => {
    cleanup();
    const tr = loadFreshTaskRegistry();
    const requestId = 'gs-concurrent-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr.createTask(command);
    await tr.updateTaskStatus(requestId, 'SELECTED');
    await tr.updateTaskStatus(requestId, 'PLANNED');
    await tr.updateTaskStatus(requestId, 'EXECUTING');

    const claim1 = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claim1.success, true);
    assertEqual(claim1.error_code, 'CLAIMED');

    const claim2 = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-B',
      carrier_type: 'github_workflow'
    });
    assertEqual(claim2.success, false);
    assertEqual(claim2.error_code, 'ALREADY_CLAIMED');
    assertEqual(claim2.existing_claim.carrier_identity, 'carrier-A');
    assertEqual(claim2.existing_claim.execution_claim_id, claim1.execution_claim_id);

    cleanup();
  });

  await test('Google Storage - duplicate request_id on same carrier returns ALREADY_CLAIMED', async () => {
    cleanup();
    const tr = loadFreshTaskRegistry();
    const requestId = 'gs-duplicate-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr.createTask(command);
    await tr.updateTaskStatus(requestId, 'SELECTED');
    await tr.updateTaskStatus(requestId, 'PLANNED');
    await tr.updateTaskStatus(requestId, 'EXECUTING');

    const claim1 = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claim1.success, true);

    const claim2 = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claim2.success, false);
    assertEqual(claim2.error_code, 'ALREADY_CLAIMED');

    cleanup();
  });

  await test('Google Storage - storage error fails closed (no local fallback)', async () => {
    cleanup();
    simulateStorageError = true;
    const tr = loadFreshTaskRegistry();
    const requestId = 'gs-storage-error-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr.createTask(command);
    await tr.updateTaskStatus(requestId, 'SELECTED');
    await tr.updateTaskStatus(requestId, 'PLANNED');
    await tr.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });

    assertEqual(claimResult.success, false);
    assertEqual(claimResult.error_code, 'STORAGE_ERROR');

    assertEqual(claimStore[requestId], undefined, 'Claim must NOT be persisted locally on storage error');

    simulateStorageError = false;
    cleanup();
  });

  await test('Google Storage - release claim succeeds and clears durable storage', async () => {
    cleanup();
    const tr = loadFreshTaskRegistry();
    const requestId = 'gs-release-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr.createTask(command);
    await tr.updateTaskStatus(requestId, 'SELECTED');
    await tr.updateTaskStatus(requestId, 'PLANNED');
    await tr.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claimResult.success, true);

    const releaseResult = await tr.releaseExecutionClaim(requestId, claimResult.execution_claim_id);
    assertEqual(releaseResult.success, true);
    assertEqual(releaseResult.error_code, 'RELEASED');
    assertEqual(claimStore[requestId], undefined);

    cleanup();
  });

  await test('Google Storage - release with mismatched execution_claim_id returns CLAIM_MISMATCH', async () => {
    cleanup();
    const tr = loadFreshTaskRegistry();
    const requestId = 'gs-mismatch-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr.createTask(command);
    await tr.updateTaskStatus(requestId, 'SELECTED');
    await tr.updateTaskStatus(requestId, 'PLANNED');
    await tr.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claimResult.success, true);

    const releaseResult = await tr.releaseExecutionClaim(requestId, 'claim-mismatched-id');
    assertEqual(releaseResult.success, false);
    assertEqual(releaseResult.error_code, 'CLAIM_MISMATCH');

    cleanup();
  });

  await test('Google Storage - recovery after process restart finds claim in Google Storage', async () => {
    cleanup();
    const tr1 = loadFreshTaskRegistry();
    const requestId = 'gs-recovery-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr1.createTask(command);
    await tr1.updateTaskStatus(requestId, 'SELECTED');
    await tr1.updateTaskStatus(requestId, 'PLANNED');
    await tr1.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr1.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claimResult.success, true);

    const executionClaimId = claimResult.execution_claim_id;
    const carrierIdentity = claimResult.carrier_identity;

    assertEqual(claimStore[requestId].execution_claim_id, executionClaimId);

    const tr2 = loadFreshTaskRegistry();
    tr2.resetMemoryCache();
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);

    const recoveredClaim = await tr2.getExecutionClaimFromAnywhere(requestId);
    assertEqual(recoveredClaim !== null, true, 'Claim should be recovered from Google Storage after restart');
    assertEqual(recoveredClaim.execution_claim_id, executionClaimId);
    assertEqual(recoveredClaim.carrier_identity, carrierIdentity);
    assertEqual(recoveredClaim.status, 'CLAIMED');

    cleanup();
  });

  await test('Google Storage - carrier_identity is rejected if not provided', async () => {
    cleanup();
    const tr = loadFreshTaskRegistry();
    const requestId = 'gs-no-identity-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr.createTask(command);
    await tr.updateTaskStatus(requestId, 'SELECTED');
    await tr.updateTaskStatus(requestId, 'PLANNED');
    await tr.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr.claimExecutionContext(requestId, {
      carrier_id: null,
      carrier_type: 'github_workflow'
    });

    assertEqual(claimResult.success, false);
     assertEqual(claimResult.error_code, 'CLAIM_FAILED');

     cleanup();
   });

  await test('Google Storage - rehydrateTaskFromCallback validates carrier_identity against durable claim', async () => {
    cleanup();
    const tr1 = loadFreshTaskRegistry();
    const requestId = 'gs-rehydrate-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr1.createTask(command);
    await tr1.updateTaskStatus(requestId, 'SELECTED');
    await tr1.updateTaskStatus(requestId, 'PLANNED');
    await tr1.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr1.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claimResult.success, true);

    const executionClaimId = claimResult.execution_claim_id;
    const carrierIdentity = claimResult.carrier_identity;

    const tr2 = loadFreshTaskRegistry();
    tr2.resetMemoryCache();
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);

    const callbackReport = {
      originator: 'Kyle',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task: 'test-task',
      result: {
        execution_metadata: {
          execution_claim_id: executionClaimId,
          carrier_identity: carrierIdentity
        }
      }
    };

    const rehydrateResult = await tr2.rehydrateTaskFromCallback(requestId, callbackReport);
    assertEqual(rehydrateResult.success, true);
    assertEqual(rehydrateResult.rehydrated, true);

    cleanup();
  });

  await test('Google Storage - rehydrateTaskFromCallback rejects carrier_identity mismatch', async () => {
    cleanup();
    const tr1 = loadFreshTaskRegistry();
    const requestId = 'gs-rehydrate-mismatch-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr1.createTask(command);
    await tr1.updateTaskStatus(requestId, 'SELECTED');
    await tr1.updateTaskStatus(requestId, 'PLANNED');
    await tr1.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr1.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claimResult.success, true);

    const tr2 = loadFreshTaskRegistry();
    tr2.resetMemoryCache();
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);

    const callbackReport = {
      originator: 'Kyle',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task: 'test-task',
      result: {
        execution_metadata: {
          execution_claim_id: claimResult.execution_claim_id,
          carrier_identity: 'carrier-B'
        }
      }
    };

    const rehydrateResult = await tr2.rehydrateTaskFromCallback(requestId, callbackReport);
    assertEqual(rehydrateResult.success, false);
    assertEqual(rehydrateResult.error_code, 'CARRIER_IDENTITY_MISMATCH');

    cleanup();
  });

  await test('Google Storage - rehydrateTaskFromCallback rejects execution_claim_id mismatch', async () => {
    cleanup();
    const tr1 = loadFreshTaskRegistry();
    const requestId = 'gs-rehydrate-claim-mismatch-1';
    const command = { ...validCommand, request_id: requestId, task_mode: 'FAILOVER_EXECUTE' };

    await tr1.createTask(command);
    await tr1.updateTaskStatus(requestId, 'SELECTED');
    await tr1.updateTaskStatus(requestId, 'PLANNED');
    await tr1.updateTaskStatus(requestId, 'EXECUTING');

    const claimResult = await tr1.claimExecutionContext(requestId, {
      carrier_id: 'carrier-A',
      carrier_type: 'github_workflow'
    });
    assertEqual(claimResult.success, true);

    const tr2 = loadFreshTaskRegistry();
    tr2.resetMemoryCache();
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);

    const callbackReport = {
      originator: 'Kyle',
      repository: 'fluentwithkyle/openclaw-webhook',
      base_branch: 'main',
      task: 'test-task',
      result: {
        execution_metadata: {
          execution_claim_id: 'claim-bogus-id',
          carrier_identity: 'carrier-A'
        }
      }
    };

    const rehydrateResult = await tr2.rehydrateTaskFromCallback(requestId, callbackReport);
    assertEqual(rehydrateResult.success, false);
    assertEqual(rehydrateResult.error_code, 'EXECUTION_CLAIM_MISMATCH');

    cleanup();
  });

  console.log('\n=== Google Storage Claims Tests: ' + passCount + ' passed, ' + failCount + ' failed ===');
  if (failCount > 0) process.exit(1);
}

runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
