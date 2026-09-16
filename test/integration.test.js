const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const { validateACPCommand, validateExecutionReport, createInitialTaskRegistryEntry } = require('../poc/schemas/acp-schema');

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

async function test(name, fn) {
  const result = await runTest(name, fn);
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
  verification: 'All tests must pass; lint must pass; no security vulnerabilities',
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

async function main() {
  await test('Full orchestration flow: PENDING -> SELECTED -> PLANNED -> EXECUTING -> VERIFIED -> COMPLETE', async () => {
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

  await test('Orchestration with Kilo failure -> FAILED -> human_review', async () => {
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

  await test('Orchestration with Kilo blocked -> BLOCKED -> human_review', async () => {
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

  await test('Orchestration with Gemini failure -> FAILED -> human_review', async () => {
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

  await test('Orchestration with Gemini blocked -> BLOCKED -> human_review', async () => {
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

  await test('Correlation preserved across full flow', async () => {
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

  await test('Malformed report rejected safely', async () => {
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

  await test('Unknown request_id rejected', async () => {
    cleanup();

    let result = orchestrator.handleKiloCompletion('unknown-request', kiloReport);
    assertEqual(result.success, false);
    assert(result.error.includes('not found'));

    result = orchestrator.handleGeminiCompletion('unknown-request', geminiReport);
    assertEqual(result.success, false);
    assert(result.error.includes('not found'));

    cleanup();
  });

  await test('Invalid state transition rejected', async () => {
    cleanup();

    taskRegistry.createTask(validCommand);
    // Try to go from PENDING directly to COMPLETE
    let result = taskRegistry.updateTaskStatus('integration-test-1', 'COMPLETE');
    assertEqual(result.success, false);
    assert(result.error.includes('Invalid state transition'));

    cleanup();
  });

  await test('Authorization boundary preserved - reports are evidence not authorization', async () => {
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

  await test('Automatic Gemini trigger after Kilo success - orchestrator.triggerGemini called', async () => {
    cleanup();

    const geminiTrigger = require('../poc/gemini-trigger');

    // Create command with the correct request_id
    const cmd = { ...validCommand, request_id: 'auto-trigger-1' };
    taskRegistry.createTask(cmd);
    taskRegistry.updateTaskStatus('auto-trigger-1', 'SELECTED');
    taskRegistry.updateTaskStatus('auto-trigger-1', 'PLANNED');
    taskRegistry.updateTaskStatus('auto-trigger-1', 'EXECUTING');

    // Handle Kilo completion - this sets next_action to 'trigger_gemini'
    const kiloResult = orchestrator.handleKiloCompletion('auto-trigger-1', { ...kiloReport, request_id: 'auto-trigger-1' });
    assertEqual(kiloResult.success, true);
    assertEqual(kiloResult.next_action, 'trigger_gemini');

    // Verify canTriggerGemini returns true
    const canTrigger = orchestrator.canTriggerGemini('auto-trigger-1');
    assertEqual(canTrigger.canTrigger, true);

    // Mock the dispatchGemini to return success so task state gets updated
    const originalDispatch = geminiTrigger.dispatchGemini;
    geminiTrigger.dispatchGemini = async () => {
      return { success: true, message: 'Workflow dispatch accepted', status_code: 204 };
    };

    try {
      // Call triggerGemini directly (simulating what the callback/polling would do)
      const triggerResult = await orchestrator.triggerGemini('auto-trigger-1', 'fake-token');
      assertEqual(triggerResult.success, true);

      // Verify task state was updated to 'running' for Gemini
      const task = taskRegistry.getTask('auto-trigger-1');
      assertEqual(task.gemini.status, 'running');
      assertEqual(task.next_action, 'waiting_gemini_callback');
    } finally {
      geminiTrigger.dispatchGemini = originalDispatch;
    }

    cleanup();
  });

  console.log(`\n=== Integration Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);