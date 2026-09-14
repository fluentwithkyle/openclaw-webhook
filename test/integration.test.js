const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const { validateACPCommand, validateExecutionReport, createInitialTaskRegistryEntry } = require('../poc/schemas/acp-schema');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

function runTest(name, fn) {
  try {
    fn();
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

function test(name, fn) {
  const result = runTest(name, fn);
  if (result) passCount++; else failCount++;
}

const validCommand = {
  protocol_version: '0.1',
  request_id: 'integration-test-1',
  source: 'Qwen',
  target: 'Kilo',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'full-orchestration-test',
  constraints: { permitted_paths: ['poc/'] },
  authorization: { capabilities: ['read_only'] },
  verification: 'test',
  reporting: 'json',
  originator: 'Kyle'
};

const kiloReport = {
  request_id: 'integration-test-1',
  agent: 'Kilo',
  status: 'success',
  task: 'full-orchestration-test',
  changed_files: ['poc/new-file.js'],
  verification: ['unit tests passed', 'lint passed'],
  result: { implementation: 'complete', execution_metadata: { invocation_id: 'inv-int-1', run_id: 'run-int-1' } },
  commit: 'abc123def',
  push: true,
  blockers: []
};

const geminiReport = {
  request_id: 'integration-test-1',
  agent: 'Gemini',
  status: 'success',
  task: 'full-orchestration-test',
  changed_files: [],
  verification: ['architecture review passed', 'security review passed'],
  result: { review: 'approved', notes: 'Ready for deployment', execution_metadata: { invocation_id: 'inv-int-2', run_id: 'run-int-2' } },
  commit: null,
  push: false,
  blockers: []
};

function cleanup() {
  if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  taskRegistry.resetRegistry();
}

test('Full orchestration flow: PENDING -> SELECTED -> PLANNED -> EXECUTING -> VERIFIED -> COMPLETE', () => {
  cleanup();

  // 1. Create task (PENDING)
  let result = taskRegistry.createTask(validCommand);
  assertEqual(result.success, true);
  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'PENDING');
  assertEqual(task.current_agent, 'Kilo');
  assertEqual(task.next_agent, 'Gemini');

  // 2. Transition to SELECTED
  result = taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  assertEqual(result.success, true);
  task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'SELECTED');

  // 3. Transition to PLANNED
  result = taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  assertEqual(result.success, true);
  task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'PLANNED');

  // 4. Transition to EXECUTING
  result = taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');
  assertEqual(result.success, true);
  task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'EXECUTING');

  // 5. Kilo completion -> triggers Gemini
  result = orchestrator.handleKiloCompletion('integration-test-1', kiloReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'trigger_gemini');
  task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'EXECUTING');
  assertEqual(task.kilo.status, 'success');
  assertEqual(task.current_agent, 'Gemini');

  // 6. Verify Gemini can be triggered
  let canTrigger = orchestrator.canTriggerGemini('integration-test-1');
  assertEqual(canTrigger.canTrigger, true);

  // 7. Gemini completion -> VERIFIED
  result = orchestrator.handleGeminiCompletion('integration-test-1', geminiReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'complete');
  task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'VERIFIED');
  assertEqual(task.gemini.status, 'success');
  assertEqual(task.current_agent, null);

  // 8. Final transition to COMPLETE
  result = taskRegistry.updateTaskStatus('integration-test-1', 'COMPLETE');
  assertEqual(result.success, true);
  task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'COMPLETE');

  cleanup();
});

test('Orchestration with Kilo failure -> FAILED -> human_review', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');

  const failureReport = { ...kiloReport, status: 'failure' };
  let result = orchestrator.handleKiloCompletion('integration-test-1', failureReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');

  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'FAILED');
  assertEqual(task.kilo.status, 'failure');
  assertEqual(task.next_action, 'human_review');

  cleanup();
});

test('Orchestration with Kilo blocked -> BLOCKED -> human_review', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');

  const blockedReport = { ...kiloReport, status: 'blocked', blockers: ['Missing authorization'] };
  let result = orchestrator.handleKiloCompletion('integration-test-1', blockedReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');

  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'BLOCKED');
  assertEqual(task.kilo.status, 'blocked');
  assertEqual(task.kilo.report.blockers.length, 1);

  cleanup();
});

test('Orchestration with Gemini failure -> FAILED -> human_review', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');
  taskRegistry.updateAgentResult('integration-test-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });

  const failureReport = { ...geminiReport, status: 'failure', blockers: ['Architecture concerns'] };
  let result = orchestrator.handleGeminiCompletion('integration-test-1', failureReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');

  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'FAILED');
  assertEqual(task.gemini.status, 'failure');

  cleanup();
});

test('Orchestration with Gemini blocked -> BLOCKED -> human_review', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');
  taskRegistry.updateAgentResult('integration-test-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });

  const blockedReport = { ...geminiReport, status: 'blocked', blockers: ['Needs human decision'] };
  let result = orchestrator.handleGeminiCompletion('integration-test-1', blockedReport);
  assertEqual(result.success, true);
  assertEqual(result.next_action, 'human_review');

  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.status, 'BLOCKED');
  assertEqual(task.gemini.status, 'blocked');

  cleanup();
});

test('Correlation preserved across full flow', () => {
  cleanup();

  const customCommand = { ...validCommand, request_id: 'correlation-test-42', parent_request_id: 'parent-123' };
  taskRegistry.createTask(customCommand);
  taskRegistry.updateTaskStatus('correlation-test-42', 'SELECTED');
  taskRegistry.updateTaskStatus('correlation-test-42', 'PLANNED');
  taskRegistry.updateTaskStatus('correlation-test-42', 'EXECUTING');

  orchestrator.handleKiloCompletion('correlation-test-42', { ...kiloReport, request_id: 'correlation-test-42' });
  orchestrator.handleGeminiCompletion('correlation-test-42', { ...geminiReport, request_id: 'correlation-test-42' });

  let task = taskRegistry.getTask('correlation-test-42');
  assertEqual(task.request_id, 'correlation-test-42');
  assertEqual(task.parent_request_id, 'parent-123');
  assertEqual(task.kilo.report.request_id, 'correlation-test-42');
  assertEqual(task.gemini.report.request_id, 'correlation-test-42');

  cleanup();
});

test('Malformed report rejected safely', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');

  const malformedReport = { request_id: 'integration-test-1' }; // missing required fields
  let result = orchestrator.handleKiloCompletion('integration-test-1', malformedReport);
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid execution report'));

  // Task state should be unchanged
  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.kilo.status, 'pending');

  cleanup();
});

test('Unknown request_id rejected', () => {
  cleanup();

  let result = orchestrator.handleKiloCompletion('unknown-request', kiloReport);
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));

  result = orchestrator.handleGeminiCompletion('unknown-request', geminiReport);
  assertEqual(result.success, false);
  assert(result.error.includes('not found'));

  cleanup();
});

test('Invalid state transition rejected', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  // Try to go from PENDING directly to COMPLETE
  let result = taskRegistry.updateTaskStatus('integration-test-1', 'COMPLETE');
  assertEqual(result.success, false);
  assert(result.error.includes('Invalid state transition'));

  cleanup();
});

test('Authorization boundary preserved - reports are evidence not authorization', () => {
  cleanup();

  taskRegistry.createTask(validCommand);
  taskRegistry.updateTaskStatus('integration-test-1', 'SELECTED');
  taskRegistry.updateTaskStatus('integration-test-1', 'PLANNED');
  taskRegistry.updateTaskStatus('integration-test-1', 'EXECUTING');

  // Report with commit/push=true but no authorization in ACP command for it
  const reportWithPush = { ...kiloReport, commit: 'new-commit', push: true };
  let result = orchestrator.handleKiloCompletion('integration-test-1', reportWithPush);
  assertEqual(result.success, true);

  // The orchestrator records the report but does NOT grant commit/push authority
  // Authority comes from ACP command, not from execution report
  let task = taskRegistry.getTask('integration-test-1');
  assertEqual(task.kilo.report.commit, 'new-commit');
  assertEqual(task.kilo.report.push, true);

  cleanup();
});

console.log(`\n=== Integration Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);