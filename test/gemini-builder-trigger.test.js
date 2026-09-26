const assert = require('assert');
const { EventEmitter } = require('events');
const builderTrigger = require('../poc/gemini-builder-trigger');

let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
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

function workflowInputs() {
  return {
    request_id: 'req-1', task: 'test task', repository: 'owner/repo', base_branch: 'main',
    builder_execution_id: 'builder-1', verification: 'verify', task_mode: 'BUILDER',
    capabilities: ['read_only'], permitted_paths: ['poc/']
  };
}

function requestResponding(statusCode) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.resume = () => {};
      callback(response);
      process.nextTick(() => response.emit('end'));
    };
    return req;
  };
}

function requestFailing() {
  return () => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => process.nextTick(() => req.emit('error', new Error('Bearer sensitive-token must not leak')));
    return req;
  };
}

async function main() {
  await runTest('validateDispatchInputs - valid inputs pass without kilo_execution_id', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      repository: 'owner/repo',
      base_branch: 'main'
    };
    const result = builderTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, true);
  });

  await runTest('validateDispatchInputs - valid inputs pass with builder_execution_id', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      repository: 'owner/repo',
      base_branch: 'main',
      builder_execution_id: 'builder-123'
    };
    const result = builderTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, true);
  });

  await runTest('validateDispatchInputs - missing request_id fails', async () => {
    const inputs = {
      task: 'test task',
      repository: 'owner/repo',
      base_branch: 'main'
    };
    const result = builderTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('request_id'));
  });

  await runTest('validateDispatchInputs - missing task fails', async () => {
    const inputs = {
      request_id: 'req-1',
      repository: 'owner/repo',
      base_branch: 'main'
    };
    const result = builderTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('task'));
  });

  await runTest('validateDispatchInputs - missing repository fails', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      base_branch: 'main'
    };
    const result = builderTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('repository'));
  });

  await runTest('validateDispatchInputs - missing base_branch fails', async () => {
    const inputs = {
      request_id: 'req-1',
      task: 'test task',
      repository: 'owner/repo'
    };
    const result = builderTrigger.validateDispatchInputs(inputs);
    assertEqual(result.valid, false);
    assert(result.error.includes('base_branch'));
  });

  await runTest('dispatchGeminiBuilder - missing github token fails', async () => {
    const result = await builderTrigger.dispatchGeminiBuilder('req-1', 'task', 'owner/repo', 'main', null, 'verify', 'BUILDER', ['read_only'], []);
    assertEqual(result.success, false);
    assert(result.error.includes('Missing GitHub token'));
  });

  await runTest('dispatchGeminiBuilder - dispatches when preconditions met (mocked)', async () => {
    const result = await builderTrigger.dispatchGeminiBuilder('req-1', 'task', 'owner/repo', 'main', 'fake-token', 'verify', 'BUILDER', ['read_only', 'modify_files', 'run_tests', 'commit', 'push'], ['poc/'], 'fake-api-key');
    assertEqual(result.success, false);
    assert(result.error.includes('GitHub workflow dispatch failed') || result.error.includes('GitHub workflow dispatch network failure'));
  });

  await runTest('workflow dispatch classifies GitHub failures without retaining response bodies', async () => {
    const cases = [
      [401, 'authentication', 'github_authentication_failed'],
      [403, 'authorization', 'github_authorization_failed'],
      [404, 'workflow', 'workflow_not_found'],
      [422, 'input', 'workflow_input_rejected'],
      [500, 'github', 'github_service_failure']
    ];
    for (const [statusCode, stage, category] of cases) {
      const result = await builderTrigger.triggerGeminiBuilderWorkflow(workflowInputs(), 'fake-token', requestResponding(statusCode));
      assertEqual(result.success, false);
      assertEqual(result.status_code, statusCode);
      assertEqual(result.stage, stage);
      assertEqual(result.category, category);
      assertEqual(result.details, undefined);
      assert(!result.error.includes('fake-token'));
    }
  });

  await runTest('workflow dispatch network failures are sanitized and classified', async () => {
    const result = await builderTrigger.dispatchGeminiBuilder('req-1', 'task', 'owner/repo', 'main', 'fake-token', 'verify', 'BUILDER', ['read_only'], [], null, requestFailing());
    assertEqual(result.success, false);
    assertEqual(result.stage, 'network');
    assertEqual(result.category, 'network_failure');
    assert(!result.error.includes('sensitive-token'));
    assert(!result.error.includes('fake-token'));
  });

  await runTest('WORKFLOW_FILE is gemini-builder.yml', () => {
    assertEqual(builderTrigger.WORKFLOW_FILE, 'gemini-builder.yml');
  });

  console.log(`\n=== Gemini Builder Trigger Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);
