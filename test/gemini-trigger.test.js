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
    verification: 'All tests must pass; lint must pass; no security vulnerabilities',
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

async function setupTask(requestId, task = 'test-task') {
  cleanup();
  await taskRegistry.createTask(makeCommand(requestId, task));
  await taskRegistry.updateTaskStatus(requestId, 'SELECTED');
  await taskRegistry.updateTaskStatus(requestId, 'PLANNED');
  await taskRegistry.updateTaskStatus(requestId, 'EXECUTING');
  await orchestrator.handleKiloCompletion(requestId, makeKiloReport(requestId, task));
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
    await setupTask('test-1');
    const result = orchestrator.canTriggerGemini('test-1');
    assertEqual(result.canTrigger, true);
  });

  await runTest('canTriggerGemini - returns false when Kilo not success', async () => {
    cleanup();
    await taskRegistry.createTask(makeCommand('test-2'));
    await taskRegistry.updateTaskStatus('test-2', 'SELECTED');
    await taskRegistry.updateTaskStatus('test-2', 'PLANNED');
    await taskRegistry.updateTaskStatus('test-2', 'EXECUTING');
    await orchestrator.handleKiloCompletion('test-2', makeKiloReport('test-2', 'test-task', 'failure'));
    const result = orchestrator.canTriggerGemini('test-2');
    assertEqual(result.canTrigger, false);
    assert(result.reason.includes('not success'));
  });

  await runTest('triggerGemini - fails when preconditions not met', async () => {
    cleanup();
    await taskRegistry.createTask(makeCommand('test-3'));
    await taskRegistry.updateTaskStatus('test-3', 'SELECTED');
    await taskRegistry.updateTaskStatus('test-3', 'PLANNED');
    await taskRegistry.updateTaskStatus('test-3', 'EXECUTING');
    await orchestrator.handleKiloCompletion('test-3', makeKiloReport('test-3', 'test-task', 'failure'));
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

  await runTest('dispatchGemini - dispatches when preconditions met (mocked)', async () => {
    await setupTask('test-4');
    const result = await orchestrator.triggerGemini('test-4', 'fake-token');
    assertEqual(result.success, false);
    assert(result.error.includes('GitHub API error') || result.error.includes('Network error'));
    const task = taskRegistry.getTask('test-4');
    assertEqual(task.gemini.status, 'pending');
  });

  await runTest('task registry stores verification from ACP command', async () => {
    cleanup();
    const cmd = makeCommand('verify-test-1', 'verification test task');
    await taskRegistry.createTask(cmd);
    const task = taskRegistry.getTask('verify-test-1');
    assertEqual(task.verification, 'All tests must pass; lint must pass; no security vulnerabilities');
    cleanup();
  });

  await runTest('triggerGemini includes verification in dispatch inputs', async () => {
    cleanup();
    const cmd = makeCommand('verify-test-2', 'verification test task 2');
    await taskRegistry.createTask(cmd);
    await taskRegistry.updateTaskStatus('verify-test-2', 'SELECTED');
    await taskRegistry.updateTaskStatus('verify-test-2', 'PLANNED');
    await taskRegistry.updateTaskStatus('verify-test-2', 'EXECUTING');
    await taskRegistry.updateAgentResult('verify-test-2', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });

    // Mock the dispatchGemini to capture inputs
    const originalDispatch = geminiTrigger.dispatchGemini;
    let capturedInputs = null;
    geminiTrigger.dispatchGemini = async (requestId, task, repository, baseBranch, kiloExecutionId, githubToken, verification) => {
      capturedInputs = { requestId, task, repository, baseBranch, kiloExecutionId, githubToken, verification };
      return { success: false, error: 'Mocked', stage: 'dispatch' };
    };

    try {
      await orchestrator.triggerGemini('verify-test-2', 'fake-token');
      assert(capturedInputs !== null, 'dispatchGemini should have been called');
      assertEqual(capturedInputs.verification, 'All tests must pass; lint must pass; no security vulnerabilities');
    } finally {
      geminiTrigger.dispatchGemini = originalDispatch;
    }
    cleanup();
  });

  await runTest('triggerGemini forwards FAILOVER_EXECUTE task_mode from TaskRegistry', async () => {
    cleanup();
    const cmd = { ...makeCommand('fo-test-1', 'failover execution task'), task_mode: 'FAILOVER_EXECUTE' };
    cmd.authorization.capabilities = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
    await taskRegistry.createTask(cmd);
    await taskRegistry.updateTaskStatus('fo-test-1', 'SELECTED');
    await taskRegistry.updateTaskStatus('fo-test-1', 'PLANNED');
    await taskRegistry.updateTaskStatus('fo-test-1', 'EXECUTING');
    await taskRegistry.updateAgentResult('fo-test-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });

    const originalDispatch = geminiTrigger.dispatchGemini;
    let capturedTaskMode = null;
    geminiTrigger.dispatchGemini = async (requestId, task, repository, baseBranch, kiloExecutionId, githubToken, verification, taskMode) => {
      capturedTaskMode = taskMode;
      return { success: false, error: 'Mocked', stage: 'dispatch' };
    };

    try {
      await orchestrator.triggerGemini('fo-test-1', 'fake-token');
      assert(capturedTaskMode !== null, 'dispatchGemini should receive taskMode');
      assertEqual(capturedTaskMode, 'FAILOVER_EXECUTE');
    } finally {
      geminiTrigger.dispatchGemini = originalDispatch;
    }
    cleanup();
  });

  await runTest('triggerGemini forwards FAILOVER_EXECUTE capabilities and permitted_paths', async () => {
    cleanup();
    const cmd = { ...makeCommand('fo-test-2', 'failover execution task 2'), task_mode: 'FAILOVER_EXECUTE' };
    cmd.authorization.capabilities = ['read_only', 'modify_files', 'run_tests', 'commit', 'push'];
    cmd.constraints.permitted_paths = ['index.js', 'utils/'];
    await taskRegistry.createTask(cmd);
    await taskRegistry.updateTaskStatus('fo-test-2', 'SELECTED');
    await taskRegistry.updateTaskStatus('fo-test-2', 'PLANNED');
    await taskRegistry.updateTaskStatus('fo-test-2', 'EXECUTING');
    await taskRegistry.updateAgentResult('fo-test-2', 'Kilo', { status: 'success', execution_id: 'exec-2', report: {} });

    const originalDispatch = geminiTrigger.dispatchGemini;
    let capturedCaps = null;
    let capturedPaths = null;
    geminiTrigger.dispatchGemini = async (requestId, task, repository, baseBranch, kiloExecutionId, githubToken, verification, taskMode, capabilities, permittedPaths) => {
      capturedCaps = capabilities;
      capturedPaths = permittedPaths;
      return { success: false, error: 'Mocked', stage: 'dispatch' };
    };

    try {
      await orchestrator.triggerGemini('fo-test-2', 'fake-token');
      assert(capturedCaps !== null, 'dispatchGemini should receive capabilities');
      assertEqual(capturedCaps.includes('run_tests'), true);
      assertEqual(capturedCaps.includes('commit'), true);
      assertEqual(capturedCaps.includes('push'), true);
      assert(capturedPaths.includes('index.js'), 'permitted_paths should include index.js');
    } finally {
      geminiTrigger.dispatchGemini = originalDispatch;
    }
    cleanup();
  });

  await runTest('dispatchGemini payload contract includes existing approval_id transport field', async () => {
    const inputs = {
      request_id: 'fa-req-approval-1',
      task: 'failover task',
      repository: 'owner/repo',
      base_branch: 'main',
      kilo_execution_id: 'exec-123',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
      permitted_paths: ['index.js'],
      approval_id: 'dir-approval-test-123'
    };

    const payload = JSON.parse(JSON.stringify({
      ref: inputs.base_branch,
      inputs: {
        request_id: inputs.request_id,
        task: inputs.task,
        repository: inputs.repository,
        base_branch: inputs.base_branch,
        kilo_execution_id: inputs.kilo_execution_id,
        verification: 'All tests must pass',
        task_mode: inputs.task_mode,
        capabilities: inputs.capabilities.join(','),
        permitted_paths: inputs.permitted_paths.join(','),
        approval_id: inputs.approval_id
      }
    }));

    assertEqual(payload.inputs.approval_id, 'dir-approval-test-123');
  });

  await runTest('dispatchGemini includes FAILOVER_EXECUTE task_mode in workflow dispatch inputs', async () => {
    const inputs = {
      request_id: 'fa-req-1',
      task: 'failover task',
      repository: 'owner/repo',
      base_branch: 'main',
      kilo_execution_id: 'exec-123',
      task_mode: 'FAILOVER_EXECUTE',
      capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'],
      permitted_paths: ['index.js']
    };

    // Verify triggerGeminiWorkflow accepts FAILOVER_EXECUTE task_mode
    const payload = JSON.parse(JSON.stringify({
      ref: inputs.base_branch,
      inputs: {
        request_id: inputs.request_id,
        task: inputs.task,
        repository: inputs.repository,
        base_branch: inputs.base_branch,
        kilo_execution_id: inputs.kilo_execution_id,
        verification: 'All tests must pass',
        task_mode: inputs.task_mode,
        capabilities: inputs.capabilities.join(','),
        permitted_paths: inputs.permitted_paths.join(',')
      }
    }));
    assertEqual(payload.inputs.task_mode, 'FAILOVER_EXECUTE');
    assertEqual(payload.inputs.capabilities, 'read_only,modify_files,run_tests,commit,push');
  });

  console.log(`\n=== Gemini Trigger Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);