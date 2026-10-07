const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const geminiTrigger = require('../poc/gemini-trigger');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${name} - ${err.message}`);
    return false;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let passCount = 0;
let failCount = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const validCommand = {
  protocol_version: '0.1',
  request_id: 'test-orch-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'test-task',
  constraints: { permitted_paths: ['poc/'] },
  authorization: { capabilities: ['read_only'] },
  verification: 'All tests must pass; lint must pass; no security vulnerabilities',
  reporting: 'json',
  originator: 'Kyle'
};

const validKiloReport = {
  request_id: 'test-orch-1',
  agent: 'Kilo',
  status: 'success',
  task: 'test-task',
  changed_files: ['file1.js'],
  verification: ['test passed'],
  result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
  commit: 'abc123',
  push: true,
  blockers: []
};

const validGeminiReport = {
  request_id: 'test-orch-1',
  agent: 'Gemini',
  status: 'success',
  task: 'test-task',
  changed_files: [],
  verification: ['review passed'],
  result: { execution_metadata: { invocation_id: 'inv-2', run_id: 'run-2' } },
  commit: null,
  push: false,
  blockers: []
};

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

async function setupTask() {
  cleanup();
  const created = await taskRegistry.createTask(validCommand);
  if (!created.success) throw new Error(`setupTask createTask failed: ${created.error}`);
  for (const status of ['SELECTED', 'PLANNED', 'EXECUTING']) {
    const result = await await taskRegistry.updateTaskStatus('test-orch-1', status);
    if (!result.success) throw new Error(`setupTask ${status} failed: ${result.error}`);
  }
}

test('handleKiloCompletion - valid success report', async () => {
  await setupTask();
  const result = await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'trigger_builder');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.status, 'EXECUTING');
  assertEqual(task.kilo.status, 'success');
  assertEqual(task.builder.status, 'pending');
  assertEqual(task.current_agent, 'Gemini');
  cleanup();
});

test('handleKiloCompletion - extracts execution_id from result.execution_metadata.invocation_id', async () => {
  await setupTask();
  const reportWithoutExecutionId = {
    ...validKiloReport,
    execution_id: undefined
  };
  const result = await orchestrator.handleKiloCompletion('test-orch-1', reportWithoutExecutionId);
  assertEqual(result.success, true);
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.kilo.execution_id, 'inv-1');
  cleanup();
});

test('handleKiloCompletion - failure report transitions to FAILED', async () => {
  await setupTask();
  const failureReport = { ...validKiloReport, status: 'failure' };
  const result = await orchestrator.handleKiloCompletion('test-orch-1', failureReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.status, 'FAILED');
  cleanup();
});

test('handleKiloCompletion - blocked report transitions to BLOCKED', async () => {
  await setupTask();
  const blockedReport = { ...validKiloReport, status: 'blocked' };
  const result = await orchestrator.handleKiloCompletion('test-orch-1', blockedReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.status, 'BLOCKED');
  cleanup();
});

test('handleKiloCompletion - invalid report fails validation', async () => {
  await setupTask();
  const invalidReport = { ...validKiloReport, agent: 'Invalid' };
  const result = await orchestrator.handleKiloCompletion('test-orch-1', invalidReport);
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid execution report'));
  cleanup();
});

test('handleKiloCompletion - repository mismatch fails', async () => {
  await setupTask();
  const mismatchReport = { ...validKiloReport, repository: 'other/repo' };
  const result = await orchestrator.handleKiloCompletion('test-orch-1', mismatchReport);
  assertEqual(result.success, false);
  assert(result.error.includes('Repository mismatch'));
  cleanup();
});

test('handleKiloCompletion - wrong agent fails', async () => {
  await setupTask();
  const wrongAgentReport = { ...validKiloReport, agent: 'Gemini' };
  const result = await orchestrator.handleKiloCompletion('test-orch-1', wrongAgentReport);
  assertEqual(result.success, false);
  assert(result.error.includes('Expected Kilo report'));
  cleanup();
});

test('handleKiloCompletion - idempotency prevents duplicate', async () => {
  await setupTask();
  orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
  const result = await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
  assertEqual(result.success, false);
  assert(result.error.includes('already recorded'));
  assertEqual(result.duplicate, true);
  cleanup();
});

test('handleKiloCompletion - non-existent task fails', async () => {
  cleanup();
  const result = await orchestrator.handleKiloCompletion('non-existent', validKiloReport);
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));
  cleanup();
});

test('handleGeminiCompletion - valid success report', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const result = await orchestrator.handleGeminiCompletion('test-orch-1', validGeminiReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'complete');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.status, 'VERIFIED');
  assertEqual(task.gemini.status, 'success');
  assertEqual(task.current_agent, null);
  cleanup();
});

test('handleGeminiCompletion - failure transitions to FAILED', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const failureReport = { ...validGeminiReport, status: 'failure' };
  const result = await orchestrator.handleGeminiCompletion('test-orch-1', failureReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.status, 'FAILED');
  cleanup();
});

test('handleGeminiCompletion - idempotency prevents duplicate', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  orchestrator.handleGeminiCompletion('test-orch-1', validGeminiReport);
  const result = await orchestrator.handleGeminiCompletion('test-orch-1', validGeminiReport);
  assertEqual(result.success, false);
  assert(result.error.includes('already recorded'));
  assertEqual(result.duplicate, true);
  cleanup();
});

test('handleGeminiCompletion - invalid report fails validation', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const invalidReport = { ...validGeminiReport, agent: 'Kilo' };
  const result = await orchestrator.handleGeminiCompletion('test-orch-1', invalidReport);
  assertEqual(result.success, false);
  assert(result.error.includes('Expected Gemini report'));
  cleanup();
});

test('canTriggerGemini - returns true when Kilo succeeded and Gemini pending', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const result = orchestrator.canTriggerGemini('test-orch-1');
  assertEqual(result.canTrigger, true);
  cleanup();
});

test('canTriggerGemini - returns false when Kilo not success', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'failure', execution_id: 'exec-1', report: {} });
  const result = orchestrator.canTriggerGemini('test-orch-1');
  assertEqual(result.canTrigger, false);
  assert(result.reason.includes('not success'));
  cleanup();
});

test('canTriggerGemini - returns false when Gemini already run', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  await taskRegistry.updateAgentResult('test-orch-1', 'Gemini', { status: 'success', execution_id: 'exec-2', report: {} });
  const result = orchestrator.canTriggerGemini('test-orch-1');
  assertEqual(result.canTrigger, false);
  assert(result.reason.includes('already'));
  cleanup();
});

test('canTriggerGemini - returns false when task not EXECUTING', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  await taskRegistry.updateTaskStatus('test-orch-1', 'FAILED');
  const result = orchestrator.canTriggerGemini('test-orch-1');
  assertEqual(result.canTrigger, false);
  assert(result.reason.includes('not EXECUTING'));
  cleanup();
});

test('getOrchestrationState - returns current state', async () => {
  await setupTask();
  orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
  const result = orchestrator.getOrchestrationState('test-orch-1');
  assertEqual(result.success, true);
  assertEqual(result.state.kilo_status, 'success');
  assertEqual(result.state.gemini_status, 'pending');
  assertEqual(result.state.builder_status, 'pending');
  assertEqual(result.state.next_action, 'trigger_builder');
  cleanup();
});

test('determineNextAction - returns next action', async () => {
  await setupTask();
  orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
  const result = orchestrator.determineNextAction('test-orch-1');
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'trigger_builder');
  cleanup();
});

const validBuilderReport = {
  request_id: 'test-orch-1',
  agent: 'Gemini Builder',
  status: 'success',
  task: 'test-task',
  changed_files: ['poc/new-file.js'],
  verification: ['tests passed', 'lint passed'],
  result: { execution_metadata: { invocation_id: 'inv-builder-1', run_id: 'run-builder-1' } },
  commit: 'builder-commit-sha',
  push: true,
  blockers: []
};

test('handleGeminiBuilderCompletion - valid success report', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const result = await orchestrator.handleGeminiBuilderCompletion('test-orch-1', validBuilderReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'trigger_gemini');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.builder.status, 'success');
  assertEqual(task.gemini.status, 'pending');
  assertEqual(task.status, 'EXECUTING');
  cleanup();
});

test('handleGeminiBuilderCompletion - failure transitions to FAILED', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const failureReport = { ...validBuilderReport, status: 'failure', blockers: ['Build failed'] };
  const result = await orchestrator.handleGeminiBuilderCompletion('test-orch-1', failureReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');
  const task = taskRegistry.getTask('test-orch-1');
  assertEqual(task.status, 'FAILED');
  assertEqual(task.builder.status, 'failure');
  cleanup();
});

test('handleGeminiBuilderCompletion - idempotency prevents duplicate', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  orchestrator.handleGeminiBuilderCompletion('test-orch-1', validBuilderReport);
  const result = await orchestrator.handleGeminiBuilderCompletion('test-orch-1', validBuilderReport);
  assertEqual(result.success, false);
  assert(result.error.includes('already recorded'));
  assertEqual(result.duplicate, true);
  cleanup();
});

test('handleGeminiBuilderCompletion - invalid report fails validation', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const invalidReport = { ...validBuilderReport, agent: 'Gemini' };
  const result = await orchestrator.handleGeminiBuilderCompletion('test-orch-1', invalidReport);
  assertEqual(result.success, false);
  assert(result.error.includes('Expected Gemini Builder report'));
  cleanup();
});

test('triggerGemini - propagates existing Director approval_id from TaskRegistry authorization proof', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-approval', report: {} });
  const task = taskRegistry.getTask('test-orch-1');
  task.task_mode = 'FAILOVER_EXECUTE';
  task.capabilities = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
  task.permitted_paths = ['poc/orchestrator.js'];
  task.authorization_proof = {
    approval_id: 'dir-approval-test-123'
  };

  const originalDispatch = geminiTrigger.dispatchGemini;
  let capturedApprovalId = undefined;
  geminiTrigger.dispatchGemini = async (
    requestId, taskName, repository, baseBranch, kiloExecutionId,
    githubToken, verification, taskMode, capabilities, permittedPaths, approvalId
  ) => {
    capturedApprovalId = approvalId;
    return { success: false, error: 'Mocked', stage: 'dispatch' };
  };

  try {
    await orchestrator.triggerGemini('test-orch-1', 'fake-token');
    assertEqual(capturedApprovalId, 'dir-approval-test-123');
  } finally {
    geminiTrigger.dispatchGemini = originalDispatch;
    cleanup();
  }
});

test('triggerGemini - does not invent approval_id when authorization proof is absent', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-approval', report: {} });
  const task = taskRegistry.getTask('test-orch-1');
  delete task.authorization_proof;

  const originalDispatch = geminiTrigger.dispatchGemini;
  let capturedApprovalId = 'unexpected';
  geminiTrigger.dispatchGemini = async (
    requestId, taskName, repository, baseBranch, kiloExecutionId,
    githubToken, verification, taskMode, capabilities, permittedPaths, approvalId
  ) => {
    capturedApprovalId = approvalId;
    return { success: false, error: 'Mocked', stage: 'dispatch' };
  };

  try {
    await orchestrator.triggerGemini('test-orch-1', 'fake-token');
    assertEqual(capturedApprovalId, null);
  } finally {
    geminiTrigger.dispatchGemini = originalDispatch;
    cleanup();
  }
});

test('canTriggerGeminiBuilder - returns true after Kilo success', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  const result = orchestrator.canTriggerGeminiBuilder('test-orch-1');
  assertEqual(result.canTrigger, true);
  cleanup();
});

test('canTriggerGeminiBuilder - returns true with Kilo pending (direct ACP dispatch)', async () => {
  await setupTask();
  const result = orchestrator.canTriggerGeminiBuilder('test-orch-1');
  assertEqual(result.canTrigger, true);
  cleanup();
});

test('canTriggerGeminiBuilder - returns false when Kilo not success or pending', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'failure', execution_id: 'exec-1', report: {} });
  const result = orchestrator.canTriggerGeminiBuilder('test-orch-1');
  assertEqual(result.canTrigger, false);
  cleanup();
});

test('canTriggerGeminiBuilder - returns false when Builder already run', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  await taskRegistry.updateAgentResult('test-orch-1', 'Gemini Builder', { status: 'success', execution_id: 'exec-2', report: {} });
  const result = orchestrator.canTriggerGeminiBuilder('test-orch-1');
  assertEqual(result.canTrigger, false);
  assert(result.reason.includes('already'));
  cleanup();
});

test('canTriggerGeminiBuilder - returns false when Reviewer already run', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  await taskRegistry.updateAgentResult('test-orch-1', 'Gemini', { status: 'success', execution_id: 'exec-2', report: {} });
  const result = orchestrator.canTriggerGeminiBuilder('test-orch-1');
  assertEqual(result.canTrigger, false);
  assert(result.reason.includes('already'));
  cleanup();
});

test('canTriggerGeminiBuilder - returns false when task not EXECUTING', async () => {
  await setupTask();
  await taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  await taskRegistry.updateTaskStatus('test-orch-1', 'FAILED');
  const result = orchestrator.canTriggerGeminiBuilder('test-orch-1');
  assertEqual(result.canTrigger, false);
  assert(result.reason.includes('not EXECUTING'));
  cleanup();
});

(async () => {
  for (const { name, fn } of tests) {
    if (await runTest(name, fn)) passCount++; else failCount++;
  }
  console.log(`\n=== Orchestrator Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
})();