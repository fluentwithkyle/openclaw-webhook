const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

function runTest(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`PASS: ${name}`);
        return true;
      }).catch(err => {
        console.error(`FAIL: ${name} - ${err.message}`);
        return false;
      });
    }
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

function test(name, fn) {
  const result = runTest(name, fn);
  if (result && typeof result.then === 'function') {
    return result.then(r => { if (r) passCount++; else failCount++; });
  }
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

async function runAllTests() {
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

  await test('createTask - persists validated workflow stage without inferring it from task text', async () => {
    cleanup();
    const staged = await taskRegistry.createTask({ ...validCommand, request_id: 'workflow-stage-1', task: 'This text claims reconciliation', workflow_stage: 'verification' });
    assertEqual(staged.success, true);
    assertEqual(staged.entry.workflow_stage, 'verification');
    const untrustedText = await taskRegistry.createTask({ ...validCommand, request_id: 'workflow-stage-2', task: 'This text claims verification' });
    assertEqual(untrustedText.success, true);
    assertEqual(untrustedText.entry.workflow_stage, null);
    const malformed = await taskRegistry.createTask({ ...validCommand, request_id: 'workflow-stage-3', workflow_stage: 'untrusted-stage' });
    assertEqual(malformed.success, false);
    assert(malformed.error.includes('Invalid workflow_stage'));
    taskRegistry.loadFromFile();
    assertEqual(taskRegistry.getTask('workflow-stage-1').workflow_stage, 'verification');
    cleanup();
  });

  await test('createTask - preserves valid lineage and rejects nonexistent or cancelled parents', async () => {
    cleanup();
    const parent = { ...validCommand, request_id: 'deepseek-runtime-parent', target: 'Gemini Builder' };
    assertEqual((await taskRegistry.createTask(parent)).success, true);
    await taskRegistry.updateTaskStatus(parent.request_id, 'SELECTED');
    await taskRegistry.updateTaskStatus(parent.request_id, 'PLANNED');
    await taskRegistry.updateTaskStatus(parent.request_id, 'EXECUTING');
    await taskRegistry.updateTaskStatus(parent.request_id, 'FAILED');

    const child = { ...validCommand, request_id: 'deepseek-runtime-child', target: 'Gemini Builder', parent_request_id: parent.request_id };
    const childResult = await taskRegistry.createTask(child);
    assertEqual(childResult.success, true);
    assertEqual(childResult.entry.parent_request_id, parent.request_id);

    const missingResult = await taskRegistry.createTask({ ...validCommand, request_id: 'deepseek-runtime-missing-child', parent_request_id: 'deepseek-runtime-missing' });
    assertEqual(missingResult.success, false);
    assert(missingResult.error.includes('does not exist'));

    const cancelled = { ...validCommand, request_id: 'deepseek-runtime-cancelled-parent' };
    await taskRegistry.createTask(cancelled);
    await taskRegistry.cancelTask(cancelled.request_id, 'cancelled');
    const cancelledResult = await taskRegistry.createTask({ ...validCommand, request_id: 'deepseek-runtime-cancelled-child', parent_request_id: cancelled.request_id });
    assertEqual(cancelledResult.success, false);
    assert(cancelledResult.error.includes('cancelled'));
    cleanup();
  });

  await test('getTask - retrieves existing task', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    const task = taskRegistry.getTask('test-reg-1');
    assert(task !== null);
    assertEqual(task.request_id, 'test-reg-1');
    cleanup();
  });

  await test('getTask - returns null for non-existent task', async () => {
    cleanup();
    const task = taskRegistry.getTask('non-existent');
    assertEqual(task, null);
    cleanup();
  });

  await test('updateTaskStatus - valid transition', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    const result = await taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
    assertEqual(result.success, true);
    assertEqual(result.entry.status, 'SELECTED');
    cleanup();
  });

  await test('updateTaskStatus - invalid transition fails', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    const result = await taskRegistry.updateTaskStatus('test-reg-1', 'COMPLETE');
    assertEqual(result.success, false);
    assert(result.error.includes('Invalid state transition'));
    cleanup();
  });

  await test('updateTaskStatus - non-existent task fails', async () => {
    cleanup();
    const result = await taskRegistry.updateTaskStatus('non-existent', 'SELECTED');
    assertEqual(result.success, false);
    assert(result.error.includes('not found'));
    cleanup();
  });

  await test('updateAgentResult - Kilo success', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    await taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
    const result = await taskRegistry.updateAgentResult('test-reg-1', 'Kilo', {
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

  await test('updateAgentResult - Gemini success', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    await taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
    await taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-123', report: {} });
    const result = await taskRegistry.updateAgentResult('test-reg-1', 'Gemini', {
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

  await test('updateAgentResult - Gemini Builder success', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    await taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
    await taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-123', report: {} });
    const result = await taskRegistry.updateAgentResult('test-reg-1', 'Gemini Builder', {
      status: 'success',
      execution_id: 'exec-builder-1',
      report: { agent: 'Gemini Builder', status: 'success' }
    });
    assertEqual(result.success, true);
    assertEqual(result.entry.builder.status, 'success');
    assertEqual(result.entry.builder.execution_id, 'exec-builder-1');
    cleanup();
  });

  await test('updateAgentResult - unknown agent fails', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    const result = await taskRegistry.updateAgentResult('test-reg-1', 'Unknown', { status: 'success' });
    assertEqual(result.success, false);
    assert(result.error.includes('Unknown agent'));
    cleanup();
  });

  await test('updateAgentResult - Kilo preserves provider IDs', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    await taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
    await taskRegistry.updateTaskStatus('test-reg-1', 'PLANNED');
    await taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');

    const task = taskRegistry.getTask('test-reg-1');
    task.kilo.provider_session_id = 'session-abc';
    task.kilo.provider_message_id = 'message-def';
    task.kilo.provider_invocation_id = 'invocation-ghi';
    taskRegistry.persistCache();

    const result = await taskRegistry.updateAgentResult('test-reg-1', 'Kilo', {
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

  await test('setNextAction - updates next_action', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    const result = await taskRegistry.setNextAction('test-reg-1', 'trigger_gemini');
    assertEqual(result.success, true);
    assertEqual(result.entry.next_action, 'trigger_gemini');
    cleanup();
  });

  await test('getAllTasks - returns all tasks', async () => {
    cleanup();
    await taskRegistry.createTask({ ...validCommand, request_id: 'task-1' });
    await taskRegistry.createTask({ ...validCommand, request_id: 'task-2' });
    const tasks = taskRegistry.getAllTasks();
    assertEqual(tasks.length, 2);
    cleanup();
  });

  await test('getTasksByStatus - filters by status', async () => {
    cleanup();
    await taskRegistry.createTask({ ...validCommand, request_id: 'task-1' });
    await taskRegistry.createTask({ ...validCommand, request_id: 'task-2' });
    await taskRegistry.updateTaskStatus('task-1', 'SELECTED');
    const pending = taskRegistry.getTasksByStatus('PENDING');
    const selected = taskRegistry.getTasksByStatus('SELECTED');
    assertEqual(pending.length, 1);
    assertEqual(selected.length, 1);
    cleanup();
  });

  await test('deleteTask - removes task', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    const result = await taskRegistry.deleteTask('test-reg-1');
    assertEqual(result.success, true);
    assertEqual(taskRegistry.getTask('test-reg-1'), null);
    cleanup();
  });

  await test('deleteTask - non-existent returns false', async () => {
    cleanup();
    const result = await taskRegistry.deleteTask('non-existent');
    assertEqual(result.success, false);
    cleanup();
  });

  await test('Persistence - survives reload', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    await taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
    taskRegistry.loadFromFile();
    const task = taskRegistry.getTask('test-reg-1');
    assert(task !== null);
    assertEqual(task.status, 'SELECTED');
    cleanup();
  });

  await test('Atomic write - backup file used', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    assert(fs.existsSync(REGISTRY_FILE));
    const content = fs.readFileSync(REGISTRY_FILE, 'utf8');
    assert(content.includes('test-reg-1'));
    cleanup();
  });

  await test('computePayloadFingerprint - deterministic for same command', async () => {
    cleanup();
    const fp1 = taskRegistry.computePayloadFingerprint(validCommand);
    const fp2 = taskRegistry.computePayloadFingerprint({ ...validCommand });
    assertEqual(fp1, fp2, 'Fingerprint should be deterministic');
    cleanup();
  });

  await test('computePayloadFingerprint - differs for different task', async () => {
    cleanup();
    const fp1 = taskRegistry.computePayloadFingerprint(validCommand);
    const fp2 = taskRegistry.computePayloadFingerprint({ ...validCommand, task: 'different-task' });
    if (fp1 === fp2) {
      throw new Error('Fingerprint should differ for different task');
    }
    cleanup();
  });

  await test('computePayloadFingerprint - capability order does not matter', async () => {
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

  await test('computePayloadFingerprint - permitted_paths order does not matter', async () => {
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

  await test('createTask - stores replay_fingerprint on entry', async () => {
    cleanup();
    const result = await taskRegistry.createTask(validCommand);
    assertEqual(result.success, true);
    assert(result.entry.replay_fingerprint !== undefined, 'Entry should have replay_fingerprint');
    assertEqual(
      result.entry.replay_fingerprint,
      taskRegistry.computePayloadFingerprint(validCommand),
      'Stored fingerprint should match computed fingerprint'
    );
    cleanup();
  });

  await test('replayTask - identical payload returns replay success', async () => {
    cleanup();
    const result = await taskRegistry.createTask(validCommand);
    assertEqual(result.success, true);

    const replay = await taskRegistry.replayTask(validCommand);
    assertEqual(replay.success, true);
    assertEqual(replay.replay, true);
    assertEqual(replay.existing, true);
    assertEqual(replay.entry.request_id, 'test-reg-1');
    assertEqual(replay.task_terminated, false);
    cleanup();
  });

  await test('replayTask - modified payload fails closed with REPLAY_PAYLOAD_MISMATCH', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);

    const modified = { ...validCommand, task: 'different-task' };
    const replay = await taskRegistry.replayTask(modified);
    assertEqual(replay.success, false);
    assertEqual(replay.error_code, 'REPLAY_PAYLOAD_MISMATCH');
    assertEqual(replay.existing_request_id, 'test-reg-1');
    cleanup();
  });

  await test('replayTask - modified capabilities fails closed', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);

    const modified = { ...validCommand, authorization: { capabilities: ['read_only', 'modify_files'] } };
    const replay = await taskRegistry.replayTask(modified);
    assertEqual(replay.success, false);
    assertEqual(replay.error_code, 'REPLAY_PAYLOAD_MISMATCH');
    cleanup();
  });

  await test('replayTask - missing task returns rehydrate flag when no existing task', async () => {
    cleanup();
    const replay = await taskRegistry.replayTask(validCommand);
    assertEqual(replay.success, false);
    assertEqual(replay.error_code, 'NO_EXISTING_TASK');
    assertEqual(replay.rehydrate, true);
    cleanup();
  });

  await test('replayTask - missing request_id fails closed', async () => {
    cleanup();
    const replay = await taskRegistry.replayTask({ ...validCommand, request_id: undefined });
    assertEqual(replay.success, false);
    assertEqual(replay.error_code, 'MISSING_REQUEST_ID');
    cleanup();
  });

  await test('replayTask - terminated task returns success with task_terminated flag', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    await taskRegistry.updateTaskStatus('test-reg-1', 'SELECTED');
    await taskRegistry.updateTaskStatus('test-reg-1', 'PLANNED');
    await taskRegistry.updateTaskStatus('test-reg-1', 'EXECUTING');
    await taskRegistry.updateAgentResult('test-reg-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
    await taskRegistry.addEvidence('test-reg-1', 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' });
    await taskRegistry.updateTaskStatus('test-reg-1', 'VERIFIED');
    await taskRegistry.updateTaskStatus('test-reg-1', 'COMPLETE');

    const replay = await taskRegistry.replayTask(validCommand);
    assertEqual(replay.success, true);
    assertEqual(replay.replay, true);
    assertEqual(replay.task_terminated, true);
    assertEqual(replay.message, 'Replay matched existing terminated task; no new execution initiated');
    cleanup();
  });

  await test('replayTask - persists fingerprint across reload', async () => {
    cleanup();
    await taskRegistry.createTask(validCommand);
    taskRegistry.loadFromFile();
    const replay = await taskRegistry.replayTask(validCommand);
    assertEqual(replay.success, true);
    assertEqual(replay.replay, true);
    cleanup();
  });

  await test('buildExecutionDescriptor - includes carrier_identity and carrier_type from execution claim', async () => {
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

  await test('buildExecutionDescriptor - returns null when taskEntry is missing', async () => {
    const descriptor = taskRegistry.buildExecutionDescriptor('req-1', null, 'claim-1');
    assertEqual(descriptor, null);
  });

  await test('buildExecutionDescriptor - null carrier fields when no execution claim', async () => {
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

  await test('buildExecutionDescriptor - preserves task_name as canonical identifier', async () => {
    const entry = {
        task: 'test-task',
        task_name: 'TASK-KILO-ACP-TASK-IDENTITY-PROPAGATION-REGRESSION-FIX-001',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task_mode: 'FAILOVER_EXECUTE',
        capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
        permitted_paths: ['poc/'],
        verification: 'tests must pass',
        workflow_stage: null,
        current_agent: 'Kilo',
        execution_claim: {
            execution_claim_id: 'claim-1',
            carrier_identity: 'github-workflow-123-1',
            carrier_type: 'github_workflow'
        }
    };
    const descriptor = taskRegistry.buildExecutionDescriptor('req-1', entry, 'claim-1');
    assertEqual(descriptor.task_name, 'TASK-KILO-ACP-TASK-IDENTITY-PROPAGATION-REGRESSION-FIX-001',
        'Execution descriptor must carry task_name from task entry');
  });

  await test('buildExecutionDescriptor - task_name is null when absent from task entry', async () => {
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
    assertEqual(descriptor.task_name, null,
        'task_name must be null in descriptor when absent from task entry');
  });

  console.log(`\n=== TaskRegistry Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});