const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');

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

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'Deep assertion failed'}: expected ${e}, got ${a}`);
  }
}

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  const result = await runTest(name, fn);
  if (result) passCount++; else failCount++;
}

const validCommand = {
  protocol_version: '0.1',
  request_id: 'test-reg-1',
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

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

await test('createTask - creates new task successfully', async () => {
  cleanup();
  const result = await taskRegistry.createTask(validCommand);
  assertEqual(result.success, true);
  assertEqual(result.entry.request_id, 'test-reg-1');
  assertEqual(result.entry.status, 'PENDING');
  assertEqual(result.entry.kilo.status, 'pending');
  assertEqual(result.entry.gemini.status, 'pending');
  cleanup();
});

await test('createTask - duplicate request_id returns error', async () => {
  cleanup();
  await taskRegistry.createTask(validCommand);
  const result = await taskRegistry.createTask(validCommand);
  assertEqual(result.success, false);
  assertEqual(result.duplicate, true);
  assert(result.error.includes('Duplicate'));
  cleanup();
});

await test('createTask - Gemini Builder target sets current_agent to Gemini Builder', async () => {
  cleanup();
  const builderCommand = { ...validCommand, request_id: 'builder-task-1', target: 'Gemini Builder' };
  const result = await taskRegistry.createTask(builderCommand);
  assertEqual(result.success, true);
  assertEqual(result.entry.current_agent, 'Gemini Builder');
  assertEqual(result.entry.next_agent, 'Gemini');
  cleanup();
});

test('createTask - persists validated workflow stage without inferring it from task text', () => {
  cleanup();
  const staged = taskRegistry.createTask({ ...validCommand, request_id: 'workflow-stage-1', task: 'This text claims reconciliation', workflow_stage: 'verification' });
  assertEqual(staged.success, true);
  assertEqual(staged.entry.workflow_stage, 'verification');
  const untrustedText = taskRegistry.createTask({ ...validCommand, request_id: 'workflow-stage-2', task: 'This text claims verification' });
  assertEqual(untrustedText.success, true);
  assertEqual(untrustedText.entry.workflow_stage, null);
  const malformed = taskRegistry.createTask({ ...validCommand, request_id: 'workflow-stage-3', workflow_stage: 'untrusted-stage' });
  assertEqual(malformed.success, false);
  assert(malformed.error.includes('Invalid workflow_stage'));
  taskRegistry.loadFromFile();
  assertEqual(taskRegistry.getTask('workflow-stage-1').workflow_stage, 'verification');
  cleanup();
});

test('createTask - preserves valid lineage and rejects nonexistent or cancelled parents', () => {
  cleanup();
  const parent = { ...validCommand, request_id: 'deepseek-runtime-parent', target: 'Gemini Builder' };
  assertEqual(taskRegistry.createTask(parent).success, true);
  taskRegistry.updateTaskStatus(parent.request_id, 'SELECTED');
  taskRegistry.updateTaskStatus(parent.request_id, 'PLANNED');
  taskRegistry.updateTaskStatus(parent.request_id, 'EXECUTING');
  taskRegistry.updateTaskStatus(parent.request_id, 'FAILED');

  const child = { ...validCommand, request_id: 'deepseek-runtime-child', target: 'Gemini Builder', parent_request_id: parent.request_id };
  const childResult = taskRegistry.createTask(child);
  assertEqual(childResult.success, true);
  assertEqual(childResult.entry.parent_request_id, parent.request_id);

  const missingResult = taskRegistry.createTask({ ...validCommand, request_id: 'deepseek-runtime-missing-child', parent_request_id: 'deepseek-runtime-missing' });
  assertEqual(missingResult.success, false);
  assert(missingResult.error.includes('does not exist'));

  const cancelled = { ...validCommand, request_id: 'deepseek-runtime-cancelled-parent' };
  taskRegistry.createTask(cancelled);
  taskRegistry.cancelTask(cancelled.request_id, 'cancelled');
  const cancelledResult = taskRegistry.createTask({ ...validCommand, request_id: 'deepseek-runtime-cancelled-child', parent_request_id: cancelled.request_id });
  assertEqual(cancelledResult.success, false);
  assert(cancelledResult.error.includes('cancelled'));
  cleanup();
});

test('getTask - retrieves existing task', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const task = taskRegistry.getTask('test-reg-1');
  assert(task !== null);
  assertEqual(task.request_id, 'test-reg-1');
  cleanup();
});

test('getTask - returns null for non-existent task', () => {
  cleanup();
  const task = taskRegistry.getTask('non-existent');
  assertEqual(task, null);
  cleanup();
});

test('updateTaskStatus - valid transition', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
  assertEqual(result.success, true);
  assertEqual(result.entry.status, 'SELECTED');
  cleanup();
});

test('updateTaskStatus - invalid transition fails', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.updateTaskStatus('test-reg-1', 'COMPLETE');
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid state transition'));
  cleanup();
});

test('updateTaskStatus - non-existent task fails', () => {
  cleanup();
  const result = taskRegistry.updateTaskStatus('non-existent', 'SELECTED');
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));
  cleanup();
});

test('updateAgentResult - Kilo success', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-123',
    report: validCommand
  });
  assertEqual(result.success, true);
  assertEqual(result.entry.kilo.status, 'success');
  assertEqual(result.entry.kilo.execution_id, 'exec-123');
  assertEqual(result.entry.current_agent, 'Gemini');
  cleanup();
});

test('updateAgentResult - Gemini success', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
  taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-123', report: {} });
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Gemini', {
    status: 'success',
    execution_id: 'exec-456',
    report: {}
  });
  assertEqual(result.success, true);
  assertEqual(result.entry.gemini.status, 'success');
  assertEqual(result.entry.gemini.execution_id, 'exec-456');
  assertEqual(result.entry.current_agent, null);
  cleanup();
});

test('updateAgentResult - Gemini Builder success', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
  taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-123', report: {} });
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Gemini Builder', {
    status: 'success',
    execution_id: 'exec-builder-1',
    report: { agent: 'Gemini Builder', status: 'success' }
  });
  assertEqual(result.success, true);
  assertEqual(result.entry.builder.status, 'success');
  assertEqual(result.entry.builder.execution_id, 'exec-builder-1');
  cleanup();
});

test('updateAgentResult - unknown agent fails', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Unknown', { status: 'success' });
  assertEqual(result.success, false);
  assert(result.error.includes('Unknown agent'));
  cleanup();
});

test('updateAgentResult - Kilo preserves provider IDs', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
  taskRegistry.updateTaskStatus('test-reg-1', 'PLANNED');
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');

  // Simulate provider IDs set by dispatch route
  const task = taskRegistry.getTask('test-reg-1');
  task.kilo.provider_session_id = 'session-abc';
  task.kilo.provider_message_id = 'message-def';
  task.kilo.provider_invocation_id = 'invocation-ghi';
  taskRegistry.persistCache();

  // Now record Kilo completion
  const result = taskRegistry.updateAgentResult('test-reg-1', 'Kilo', {
    status: 'success',
    execution_id: 'exec-123',
    report: { request_id: 'test-reg-1', agent: 'Kilo', status: 'success', result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } } }
  });
  assertEqual(result.success, true);
  assertEqual(result.entry.kilo.status, 'success');
  assertEqual(result.entry.kilo.execution_id, 'exec-123');
  assertEqual(result.entry.kilo.provider_session_id, 'session-abc');
  assertEqual(result.entry.kilo.provider_message_id, 'message-def');
  assertEqual(result.entry.kilo.provider_invocation_id, 'invocation-ghi');
  cleanup();
});

test('setNextAction - updates next_action', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.setNextAction('test-reg-1', 'trigger_gemini');
  assertEqual(result.success, true);
  assertEqual(result.entry.next_action, 'trigger_gemini');
  cleanup();
});

test('getAllTasks - returns all tasks', () => {
  cleanup();
  taskRegistry.createTask({ ...validCommand, request_id: 'task-1' });
  taskRegistry.createTask({ ...validCommand, request_id: 'task-2' });
  const tasks = taskRegistry.getAllTasks();
  assertEqual(tasks.length, 2);
  cleanup();
});

test('getTasksByStatus - filters by status', () => {
  cleanup();
  taskRegistry.createTask({ ...validCommand, request_id: 'task-1' });
  taskRegistry.createTask({ ...validCommand, request_id: 'task-2' });
  taskRegistry.updateTaskStatus('task-1', 'SELECTED');
  const pending = taskRegistry.getTasksByStatus('PENDING');
  const selected = taskRegistry.getTasksByStatus('SELECTED');
  assertEqual(pending.length, 1);
  assertEqual(selected.length, 1);
  cleanup();
});

test('deleteTask - removes task', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  const result = taskRegistry.deleteTask('test-reg-1');
  assertEqual(result.success, true);
  assertEqual(taskRegistry.getTask('test-reg-1'), null);
  cleanup();
});

test('deleteTask - non-existent returns false', () => {
  cleanup();
  const result = taskRegistry.deleteTask('non-existent');
  assertEqual(result.success, false);
  cleanup();
});

test('Persistence - survives reload', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
  taskRegistry.loadFromFile();
  const task = taskRegistry.getTask('test-reg-1');
  assert(task !== null);
  assertEqual(task.status, 'SELECTED');
  cleanup();
});

test('Atomic write - backup file used', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  assert(fs.existsSync(REGISTRY_FILE));
  const content = fs.readFileSync(REGISTRY_FILE, 'utf8');
  assert(content.includes('test-reg-1'));
  cleanup();
});

test('computePayloadFingerprint - deterministic for same command', () => {
  cleanup();
  const fp1 = taskRegistry.computePayloadFingerprint(validCommand);
  const fp2 = taskRegistry.computePayloadFingerprint({ ...validCommand });
  assertEqual(fp1, fp2, 'Fingerprint should be deterministic');
  cleanup();
});

test('computePayloadFingerprint - differs for different task', () => {
  cleanup();
  const fp1 = taskRegistry.computePayloadFingerprint(validCommand);
  const fp2 = taskRegistry.computePayloadFingerprint({ ...validCommand, task: 'different-task' });
  assertNotEqual(fp1, fp2, 'Fingerprint should differ for different task');
  cleanup();
});

test('computePayloadFingerprint - capability order does not matter', () => {
  cleanup();
  const cmd1 = { ...validCommand, authorization: { capabilities: ['read_only', 'modify_files'] } };
  const cmd2 = { ...validCommand, authorization: { capabilities: ['modify_files', 'read_only'] } };
  assertEqual(
    taskRegistry.computePayloadFingerprint(cmd1),
    taskRegistry.computePayloadFingerprint(cmd2),
    'Fingerprint should be order-independent for capabilities'
  );
  cleanup();
});

test('computePayloadFingerprint - permitted_paths order does not matter', () => {
  cleanup();
  const cmd1 = { ...validCommand, constraints: { permitted_paths: ['poc/', 'test/'] } };
  const cmd2 = { ...validCommand, constraints: { permitted_paths: ['test/', 'poc/'] } };
  assertEqual(
    taskRegistry.computePayloadFingerprint(cmd1),
    taskRegistry.computePayloadFingerprint(cmd2),
    'Fingerprint should be order-independent for permitted_paths'
  );
  cleanup();
});

test('createTask - stores replay_fingerprint on entry', () => {
  cleanup();
  const result = taskRegistry.createTask(validCommand);
  assertEqual(result.success, true);
  assert(result.entry.replay_fingerprint !== undefined, 'Entry should have replay_fingerprint');
  assertEqual(
    result.entry.replay_fingerprint,
    taskRegistry.computePayloadFingerprint(validCommand),
    'Stored fingerprint should match computed fingerprint'
  );
  cleanup();
});

test('replayTask - identical payload returns replay success', () => {
  cleanup();
  const result = taskRegistry.createTask(validCommand);
  assertEqual(result.success, true);

  const replay = taskRegistry.replayTask(validCommand);
  assertEqual(replay.success, true);
  assertEqual(replay.replay, true);
  assertEqual(replay.existing, true);
  assertEqual(replay.entry.request_id, 'test-reg-1');
  assertEqual(replay.task_terminated, false);
  cleanup();
});

test('replayTask - modified payload fails closed with REPLAY_PAYLOAD_MISMATCH', () => {
  cleanup();
  taskRegistry.createTask(validCommand);

  const modified = { ...validCommand, task: 'different-task' };
  const replay = taskRegistry.replayTask(modified);
  assertEqual(replay.success, false);
  assertEqual(replay.error_code, 'REPLAY_PAYLOAD_MISMATCH');
  assertEqual(replay.existing_request_id, 'test-reg-1');
  cleanup();
});

test('replayTask - modified capabilities fails closed', () => {
  cleanup();
  taskRegistry.createTask(validCommand);

  const modified = { ...validCommand, authorization: { capabilities: ['read_only', 'modify_files'] } };
  const replay = taskRegistry.replayTask(modified);
  assertEqual(replay.success, false);
  assertEqual(replay.error_code, 'REPLAY_PAYLOAD_MISMATCH');
  cleanup();
});

test('replayTask - missing task returns rehydrate flag when no existing task', () => {
  cleanup();
  const replay = taskRegistry.replayTask(validCommand);
  assertEqual(replay.success, false);
  assertEqual(replay.error_code, 'NO_EXISTING_TASK');
  assertEqual(replay.rehydrate, true);
  cleanup();
});

test('replayTask - missing request_id fails closed', () => {
  cleanup();
  const replay = taskRegistry.replayTask({ ...validCommand, request_id: undefined });
  assertEqual(replay.success, false);
  assertEqual(replay.error_code, 'MISSING_REQUEST_ID');
  cleanup();
});

test('replayTask - terminated task returns success with task_terminated flag', () => {
  cleanup();
  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
  taskRegistry.updateTaskStatus('test-reg-1', 'PLANNED');
  taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
  taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
  taskRegistry.addEvidence('test-reg-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
  taskRegistry.updateTaskStatus('test-reg-1', 'VERIFIED');
  taskRegistry.updateTaskStatus('test-reg-1', 'COMPLETE');

  var replay = taskRegistry.replayTask(validCommand);
  assertEqual(replay.success, true);
  assertEqual(replay.replay, true);
  assertEqual(replay.task_terminated, true);
  assertEqual(replay.message, 'Replay matched existing terminated task; no new execution initiated');
  cleanup();
});

test('replayTask - persists fingerprint across reload', () => {
    cleanup();
    taskRegistry.createTask(validCommand);
    taskRegistry.loadFromFile();
    var replay = taskRegistry.replayTask(validCommand);
    assertEqual(replay.success, true);
    assertEqual(replay.replay, true);
    cleanup();
});

test('buildExecutionDescriptor - includes carrier_identity and carrier_type from execution claim', () => {
    cleanup();
    const entry = {
        task: 'test-task',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'BUILDER',
        capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
        permitted_paths: ['poc/'],
        verification: 'tests pass',
        workflow_stage: null,
        current_agent: 'Gemini Builder',
        execution_claim: {
            execution_claim_id: 'claim-1',
            carrier_identity: 'github-workflow-123-1',
            carrier_type: 'github_workflow'
        }
    };
    const descriptor = taskRegistry.buildExecutionDescriptor('req-1', entry, 'claim-1');
    assertEqual(descriptor.request_id, 'req-1');
    assertEqual(descriptor.execution_claim_id, 'claim-1');
    assertEqual(descriptor.carrier_identity, 'github-workflow-123-1');
    assertEqual(descriptor.carrier_type, 'github_workflow');
    assertEqual(descriptor.task, 'test-task');
    assertEqual(descriptor.repository, 'fluentwithkyle/openclaw-webhook');
    assertEqual(descriptor.base_branch, 'main');
    assertEqual(descriptor.task_mode, 'BUILDER');
    assertEqual(descriptor.target_agent, 'Gemini Builder');
    cleanup();
});

test('buildExecutionDescriptor - returns null when taskEntry is missing', () => {
    const descriptor = taskRegistry.buildExecutionDescriptor('req-1', null, 'claim-1');
    assertEqual(descriptor, null);
});

test('buildExecutionDescriptor - null carrier fields when no execution claim', () => {
    const entry = {
        task: 'test-task',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'REVIEW',
        capabilities: ['read_only'],
        permitted_paths: ['poc/'],
        verification: 'review',
        workflow_stage: null,
        current_agent: 'Gemini'
    };
    const descriptor = taskRegistry.buildExecutionDescriptor('req-1', entry, null);
    assertEqual(descriptor.carrier_identity, null);
    assertEqual(descriptor.carrier_type, null);
    assertEqual(descriptor.execution_claim_id, null);
});

function assertNotEqual(actual, expected, msg) {
  if (actual === expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected not ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log(`\n=== TaskRegistry Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
