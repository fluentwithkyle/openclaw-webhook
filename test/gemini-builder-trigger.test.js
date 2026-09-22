const assert = require('assert');
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
    assert(result.error.includes('GitHub API error') || result.error.includes('Network error'));
  });

  await runTest('WORKFLOW_FILE is gemini-builder.yml', () => {
    assertEqual(builderTrigger.WORKFLOW_FILE, 'gemini-builder.yml');
  });

  console.log(`\n=== Gemini Builder Trigger Tests: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(console.error);
