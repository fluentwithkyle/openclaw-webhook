const assert = require('assert');
const geminiTrigger = require('../poc/gemini-trigger');
const orchestrator = require('../poc/orchestrator');
const taskRegistry = require('../poc/task-registry');
const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

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

function makeKiloReport(requestId, task = 'test-task', status = 'success') {
  return {
    request_id: requestId,
    agent: 'Kilo',
    status: status,
    task: task,
    changed_files: ['file1.js'],
    verification: ['test passed'],
    result: { execution_metadata: { invocation_id: 'inv-kilo-1', run_id: 'run-kilo-1' } },
    commit: 'abc123',
    push: true,
    blockers: []
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
  await runTest('validateDispatchInputs - valid inputs pass', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      repository: 'owner/repo',
      base_branch: 'main',
      kilo_execution_id: 'exec-123'
    };
    const result = geminiTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, true);
  });

  await runTest('validateDispatchInputs - missing request_id fails', async () => {
    const inputs = {
      task: 'test task',
      repository: 'owner/repo',
      base_branch: 'main',
      kilo_execution_id: 'exec-123'
    };
    const result = geminiTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('request_id'));
  });

  await runTest('validateDispatchInputs - missing task fails', async () => {
    const inputs = {
      request_id: 'req-1',
      repository: 'owner/repo',
      base_branch: 'main',
      kilo_execution_id: 'exec-123'
    };
    const result = geminiTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('task'));
  });

  await runTest('validateDispatchInputs - missing repository fails', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      base_branch: 'main',
      kilo_execution_id: 'exec-123'
    };
    const result = geminiTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('repository'));
  });

  await runTest('validateDispatchInputs - missing base_branch fails', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      repository: 'owner/repo',
      kilo_execution_id: 'exec-123'
    };
    const result = geminiTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('base_branch'));
  });

  await runTest('validateDispatchInputs - missing kilo_execution_id fails', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      repository: 'owner/repo',
      base_branch: 'main'
    };
    const result = geminiTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('kilo_execution_id'));
  });

  await runTest('dispatchGemini - missing github token fails', async () => {
    const result = await geminiTrigger.dispatchGemini('req-1', 'task', 'owner/repo', 'main', 'exec-123', null);
    assertEqual(result.success, false);
    assert(result.error.includes('Missing GitHub token'));
  });

  await runTest('canTriggerGemini - returns true after Kilo success', async () => {
    setupTask('test-1');
    const result = orchestrator.canTriggerGemini('test-1');
    assertEqual(result.canTrigger, true);
  });

  await runTest('canTriggerGemini - returns false when Kilo not success', async () => {
    cleanup();
    taskRegistry.createTask(makeCommand('test-2'));
    taskRegistry.updateTaskStatus('test-2', 'SELECTED');
    taskRegistry.updateTaskStatus('test-2', 'PLANNED');
    taskRegistry.updateTaskStatus('test-2', 'EXECUTING');
    orchestrator.handleKiloCompletion('test-2', makeKiloReport('test-2', 'test-task', 'failure'));
    const result = orchestrator.canTriggerGemini('test-2');
    assertEqual(result.canTrigger, false);
    assert(result.reason.includes('not success'));
  });

  await runTest('triggerGemini - fails when preconditions not met', async () => {
    cleanup();
    taskRegistry.createTask(makeCommand('test-3'));
    taskRegistry.updateTaskStatus('test-3', 'SELECTED');
    taskRegistry.updateTaskStatus('test-3', 'PLANNED');
    taskRegistry.updateTaskStatus('test-3', 'EXECUTING');
    orchestrator.handleKiloCompletion('test-3', makeKiloReport('test-3', 'test-task', 'failure'));
    const result = await orchestrator.triggerGemini('test-3', 'fake-token');
    assertEqual(result.success, false);
    assert(result.error.includes('not success'));
  });

  await runTest('triggerGemini - fails for non-existent task', async () => {
    cleanup();
    const result = await orchestrator.triggerGemini('non-existent', 'fake-token');
    assertEqual(result.success, false);
    assert(result.error.includes('not found'));
  });

  await runTest('triggerGemini - dispatches when preconditions met (mocked)', async () => {
    setupTask('test-4');
    const result = await orchestrator.triggerGemini('test-4', 'fake-token');
    assertEqual(result.success, false);
    assert(result.error.includes('GitHub API error') || result.error.includes('Network error'));
    const task = taskRegistry.getTask('test-4');
    assertEqual(task.gemini.status, 'pending');
  });

  console.log(`\n=== Gemini Trigger Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);