const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const {
  verifyConfiguration,
  isConfigurationAuthoritativelyVerified,
  CONFIG_VERIFICATION_STATES
} = require('../poc/schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
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

function assertNotStrictEqual(actual, expected, msg) {
  if (actual === expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected not ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const baseExecCommand = {
  protocol_version: '0.1',
  request_id: 'test-lineage-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'test-task',
  task_mode: 'FAILOVER_EXECUTE',
  constraints: { permitted_paths: ['poc/'] },
  authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
  verification: 'verification',
  reporting: 'json',
  originator: 'Kyle',
  activation_syntax: '@kilo',
  activation_surface: 'github_issue_comment'
};

function execCommand(overrides) {
  return Object.assign({}, baseExecCommand, overrides);
}

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

function setupPending(id) {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: id }));
  return id;
}

function setupActive(id) {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: id }));
  taskRegistry.updateTaskStatus(id, 'SELECTED');
  taskRegistry.updateTaskStatus(id, 'PLANNED');
  taskRegistry.updateTaskStatus(id, 'EXECUTING');
  return id;
}

function setupCompleted(id) {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: id }));
  taskRegistry.updateTaskStatus(id, 'SELECTED');
  taskRegistry.updateTaskStatus(id, 'PLANNED');
  taskRegistry.updateTaskStatus(id, 'EXECUTING');
  taskRegistry.addEvidence(id, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus(id, 'VERIFIED');
  taskRegistry.updateTaskStatus(id, 'COMPLETE');
  return id;
}

// ===========================================================================
// LINEAGE: Durable Lineage Enforcement
// ===========================================================================

test('L1: exact duplicate request_id is rejected', () => {
  setupPending('dup-parent');
  const result = taskRegistry.createTask(execCommand({ request_id: 'dup-parent' }));
  assertEqual(result.success, false);
  assertEqual(result.duplicate, true);
  cleanup();
});

test('L2: unrelated active root task is creatable (no parent needed)', () => {
  setupActive('active-root-1');
  const result = taskRegistry.createTask(execCommand({ request_id: 'unrelated-root' }));
  assertEqual(result.success, true);
  assertEqual(result.entry.request_id, 'unrelated-root');
  assertEqual(result.entry.parent_request_id, null);
  cleanup();
});

test('L3: legitimate explicit child of completed parent is accepted', () => {
  setupCompleted('completed-parent');
  const result = taskRegistry.createTask(
    execCommand({ request_id: 'legit-child', parent_request_id: 'completed-parent' })
  );
  assertEqual(result.success, true);
  assertEqual(result.entry.parent_request_id, 'completed-parent');
  cleanup();
});

test('L4: silent replacement with fake parent_request_id is blocked', () => {
  setupActive('active-task-1');
  const result = taskRegistry.createTask(
    execCommand({
      request_id: 'shadow-task',
      parent_request_id: 'nonexistent-parent-id'
    })
  );
  assertEqual(result.success, false);
  assert(result.error.includes('does not exist') || result.error.includes('lineage'));
  cleanup();
});

test('L5: legitimate supersession creates replacement with proper lineage', () => {
  setupActive('supersede-target');
  const result = taskRegistry.supersedeTask('supersede-target', 'needs re-run');
  assertEqual(result.success, true);
  assert(result.new_request_id);
  const original = taskRegistry.getTask('supersede-target');
  assertEqual(original.lineage.superseded_by, result.new_request_id);
  assertEqual(result.new_entry.parent_request_id, 'supersede-target');
  const current = taskRegistry.resolveCurrentLineage('supersede-target');
  assertEqual(current, result.new_request_id);
  cleanup();
});

test('L6: multi-generation supersession resolves through full chain', () => {
  setupActive('gen-a');
  const sup1 = taskRegistry.supersedeTask('gen-a', 'first supersede');
  assertEqual(sup1.success, true);
  const sup2 = taskRegistry.supersedeTask(sup1.new_request_id, 'second supersede');
  assertEqual(sup2.success, true);

  assertEqual(taskRegistry.resolveCurrentLineage('gen-a'), sup2.new_request_id);
  assertEqual(taskRegistry.resolveCurrentLineage(sup1.new_request_id), sup2.new_request_id);
  assertEqual(taskRegistry.resolveCurrentLineage(sup2.new_request_id), sup2.new_request_id);
  cleanup();
});

test('L7: recovery through supersession redirects to final replacement', () => {
  setupActive('gen-a-2');
  const sup1 = taskRegistry.supersedeTask('gen-a-2', 'first supersede');
  const sup2 = taskRegistry.supersedeTask(sup1.new_request_id, 'second supersede');

  const attempt = taskRegistry.rehydrateTask({ ...execCommand({ request_id: 'gen-a-2' }) });
  assertEqual(attempt.success, true);
  assertEqual(attempt.lineage_current, sup2.new_request_id);
  assertEqual(attempt.entry.request_id, sup2.new_request_id);

  const original = taskRegistry.getTask('gen-a-2');
  assertEqual(original.lineage.superseded_by, sup1.new_request_id);
  assertEqual(original.status, 'EXECUTING');
  cleanup();
});

test('L8: cancelled-task recovery is rejected', () => {
  setupActive('cancelled-task-1');
  taskRegistry.cancelTask('cancelled-task-1', 'manual cancel');
  const result = taskRegistry.rehydrateTask(execCommand({ request_id: 'cancelled-task-1' }));
  assertEqual(result.success, false);
  assert(result.error.includes('cancelled'));
  cleanup();
});

test('L9: conflicting active lineage (second active child) fails closed', () => {
  setupCompleted('shared-parent-1');
  const first = taskRegistry.createTask(
    execCommand({ request_id: 'child-a-1', parent_request_id: 'shared-parent-1' })
  );
  assertEqual(first.success, true);
  taskRegistry.updateTaskStatus('child-a-1', 'EXECUTING');

  const second = taskRegistry.createTask(
    execCommand({ request_id: 'child-b-1', parent_request_id: 'shared-parent-1' })
  );
  assertEqual(second.success, false);
  assert(second.error.includes('Conflicting active lineage'));
  cleanup();
});

test('L10: ambiguous relationship (non-existent parent) fails closed', () => {
  setupPending('existing-task-1');
  const result = taskRegistry.createTask(
    execCommand({
      request_id: 'ambiguous-task-1',
      parent_request_id: 'does-not-exist-anywhere'
    })
  );
  assertEqual(result.success, false);
  assert(result.error.includes('does not exist') || result.error.includes('lineage'));
  cleanup();
});

// ===========================================================================
// CONFIGURATION PROVENANCE: Authoritative Configuration Verification
// ===========================================================================

const FAKE_ENV_KEY = 'ACP_FAKE_BYPASS_' + Date.now();
const REAL_ENV_KEY = 'ACP_REAL_TEST_' + Date.now();

test('C1: fabricated VERIFIED result cannot create VERIFIED', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-1' }));
  taskRegistry.recordConfigVerification('config-task-1', 'repository', {
    state: 'VERIFIED',
    verified: true,
    source: 'caller_assertion'
  }, 'wrong-repo');

  const state = taskRegistry.getConfigVerificationState('config-task-1', 'repository');
  assertNotStrictEqual(state, 'VERIFIED');
  cleanup();
});

test('C2: fabricated source = runtime_env does not bypass authoritative check', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-2' }));
  taskRegistry.recordConfigVerification('config-task-2', FAKE_ENV_KEY, {
    state: 'VERIFIED',
    verified: true,
    source: 'runtime_env'
  }, 'fake-value', { [FAKE_ENV_KEY]: 'fake-value' });

  const rec = taskRegistry.getConfigVerificationState('config-task-2', FAKE_ENV_KEY);
  assertNotStrictEqual(rec, 'VERIFIED');
  cleanup();
});

test('C3: fabricated source = task_registry does not bypass authoritative check', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-3' }));
  taskRegistry.recordConfigVerification('config-task-3', 'repository', {
    state: 'VERIFIED',
    verified: true,
    source: 'task_registry'
  }, 'wrong-repo');

  const rec = taskRegistry.getConfigVerificationState('config-task-3', 'repository');
  assertNotStrictEqual(rec, 'VERIFIED');
  cleanup();
});

test('C4: fabricated caller env (via recordConfigVerification) cannot create VERIFIED', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-4' }));
  taskRegistry.recordConfigVerification('config-task-4', FAKE_ENV_KEY, {
    state: 'VERIFIED',
    verified: true,
    source: 'runtime_env'
  }, 'fake-value', { [FAKE_ENV_KEY]: 'fake-value' });

  const task = taskRegistry.getTask('config-task-4');
  const rec = task.config_verification && task.config_verification[FAKE_ENV_KEY];
  assert(rec);
  assertNotStrictEqual(rec.state, 'VERIFIED');
  cleanup();
});

test('C5: verifyConfig ignores caller-supplied env, uses process.env', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-5' }));
  const r = taskRegistry.verifyConfig('config-task-5', FAKE_ENV_KEY, {
    env: { [FAKE_ENV_KEY]: 'fake-value' },
    claimed: 'fake-value'
  });
  assertNotStrictEqual(r.state, 'VERIFIED');
  assertEqual(r.verified, false);
  cleanup();
});

test('C6: real process.env verification returns VERIFIED', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-6' }));
  process.env[REAL_ENV_KEY] = 'real-secret-value';
  const r = taskRegistry.verifyConfig('config-task-6', REAL_ENV_KEY, {});
  assertEqual(r.state, 'VERIFIED');
  assertEqual(r.verified, true);
  assertEqual(r.source, 'runtime_env');

  const task = taskRegistry.getTask('config-task-6');
  const rec = task.config_verification[REAL_ENV_KEY];
  assertEqual(rec.state, 'VERIFIED');
  delete process.env[REAL_ENV_KEY];
  cleanup();
});

test('C7: real canonical TaskRegistry verification returns VERIFIED when claim matches', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-7' }));
  const entry = taskRegistry.getTask('config-task-7');
  const r = verifyConfiguration('repository', { claimed: 'fluentwithkyle/openclaw-webhook', task: entry });
  assertEqual(r.state, 'VERIFIED');
  assertEqual(r.verified, true);
  assertEqual(r.source, 'task_registry');
  cleanup();
});

test('C8: task_registry target verification uses current_agent (not invented task.target)', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-8' }));
  const entry = taskRegistry.getTask('config-task-8');
  assertEqual(entry.current_agent, 'Kilo');
  const r = verifyConfiguration('target', { claimed: 'Kilo', task: entry });
  assertEqual(r.state, 'VERIFIED');
  assertEqual(r.source, 'task_registry');
  cleanup();
});

test('C9: mismatched task_registry claim is not VERIFIED', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-9' }));
  const entry = taskRegistry.getTask('config-task-9');
  const r = verifyConfiguration('repository', { claimed: 'wrong/repo', task: entry });
  assertNotStrictEqual(r.state, 'VERIFIED');
  assertEqual(r.verified, false);
  cleanup();
});

test('C10: unavailable configuration returns UNKNOWN', () => {
  const r = verifyConfiguration('NONEXISTENT_CONFIG_KEY_12345', {});
  assertEqual(r.state, 'UNKNOWN');
  assertEqual(r.verified, false);
  assertEqual(r.source, null);
});

test('C11: required UNKNOWN configuration blocks execution prerequisite', () => {
  setupPending('config-task-11');
  taskRegistry.recordConfigVerification('config-task-11', 'MISSING_PROVIDER_KEY',
    verifyConfiguration('MISSING_PROVIDER_KEY', { claimed: null }));
  const required = taskRegistry.requireConfigVerified('config-task-11', 'MISSING_PROVIDER_KEY');
  assertEqual(required.success, false);
  assertEqual(required.config_state, 'UNKNOWN');
  cleanup();
});

test('C12: no secret values stored in config verification records', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-12' }));
  const SECRET = 'super-secret-value-abc123';
  process.env[REAL_ENV_KEY] = SECRET;

  taskRegistry.verifyConfig('config-task-12', REAL_ENV_KEY, {});
  const task = taskRegistry.getTask('config-task-12');
  assert(!JSON.stringify(task).includes(SECRET));
  delete process.env[REAL_ENV_KEY];
  cleanup();
});

test('C13: PROPOSED configuration cannot satisfy execution prerequisite', () => {
  cleanup();
  taskRegistry.createTask(execCommand({ request_id: 'config-task-13' }));
  taskRegistry.recordConfigVerification('config-task-13', 'PROPOSED_TARGET',
    verifyConfiguration('PROPOSED_TARGET', { claimed: 'docs-only-value' }));
  const required = taskRegistry.requireConfigVerified('config-task-13', 'PROPOSED_TARGET');
  assertEqual(required.success, false);
  assertNotStrictEqual(required.config_state, 'VERIFIED');
  cleanup();
});

console.log(`\n=== Reliability Enforcement Final Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
