const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

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

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  const result = runTest(name, fn);
  if (result) passCount++; else failCount++;
}

// Test the jq-based JSON construction with various problematic inputs
function buildCallbackPayload(inputs) {
  const {
    request_id = 'test-req-1',
    task = 'test task',
    status = 'success',
    gemini_output = '',
    invocation_id = 'gemini-123-1',
    run_id = '123'
  } = inputs;

  const blockers = '[]';
  const changed_files = '[]';
  const verification = '["advisory review completed"]';

  const jqScript = `
    {
      request_id: $request_id,
      agent: $agent,
      status: $status,
      task: $task,
      changed_files: $changed_files,
      verification: $verification,
      result: {
        execution_metadata: {
          invocation_id: $invocation_id,
          run_id: $run_id
        },
        gemini_output: $gemini_output
      },
      commit: $commit,
      push: $push,
      blockers: $blockers
    }
  `;

  const result = spawnSync('jq', [
    '-n',
    '--arg', 'request_id', request_id,
    '--arg', 'agent', 'Gemini',
    '--arg', 'status', status,
    '--arg', 'task', task,
    '--argjson', 'changed_files', changed_files,
    '--argjson', 'verification', verification,
    '--arg', 'invocation_id', invocation_id,
    '--arg', 'run_id', run_id,
    '--arg', 'gemini_output', gemini_output,
    '--argjson', 'commit', 'null',
    '--argjson', 'push', 'false',
    '--argjson', 'blockers', blockers,
    jqScript
  ], { encoding: 'utf8' });

  if (result.error) {
    throw new Error(`jq execution failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`jq exited with code ${result.status}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function parseJsonOrFail(jsonStr, context) {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`${context}: Invalid JSON - ${e.message}\nOutput: ${jsonStr}`);
  }
}

function testJsonSerialization(name, inputs, validateFn) {
  test(name, () => {
    const output = buildCallbackPayload(inputs);
    const parsed = parseJsonOrFail(output, name);
    
    // Validate required ACP fields
    assertEqual(parsed.request_id, inputs.request_id, 'request_id preserved');
    assertEqual(parsed.agent, 'Gemini', 'agent is Gemini');
    assertEqual(parsed.status, inputs.status, 'status preserved');
    assertEqual(parsed.task, inputs.task, 'task preserved');
    assert(Array.isArray(parsed.changed_files), 'changed_files is array');
    assert(Array.isArray(parsed.verification), 'verification is array');
    assert(parsed.result, 'result object exists');
    assert(parsed.result.execution_metadata, 'execution_metadata exists');
    assertEqual(parsed.result.execution_metadata.invocation_id, inputs.invocation_id, 'invocation_id preserved');
    assertEqual(parsed.result.execution_metadata.run_id, inputs.run_id, 'run_id preserved');
    assert(parsed.result.gemini_output !== undefined, 'gemini_output exists');
    assertEqual(parsed.commit, null, 'commit is null');
    assertEqual(parsed.push, false, 'push is false');
    assert(Array.isArray(parsed.blockers), 'blockers is array');
    
    // Custom validation
    if (validateFn) {
      validateFn(parsed);
    }
  });
}

console.log('=== JSON Serialization Regression Tests ===\n');

// Test 1: Basic valid payload
testJsonSerialization(
  'Basic payload with simple values',
  { request_id: 'req-1', task: 'simple task', gemini_output: 'simple output' },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, 'simple output');
  }
);

// Test 2: Double quotes in gemini_output
testJsonSerialization(
  'Double quotes in gemini_output',
  { 
    request_id: 'req-2', 
    task: 'task with "quotes"', 
    gemini_output: 'He said "Hello World" and left' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, 'He said "Hello World" and left');
    assertEqual(parsed.task, 'task with "quotes"');
  }
);

// Test 3: Single quotes in gemini_output
testJsonSerialization(
  'Single quotes in gemini_output',
  { 
    request_id: 'req-3', 
    task: "task with 'single' quotes", 
    gemini_output: "It's a 'test' case" 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, "It's a 'test' case");
    assertEqual(parsed.task, "task with 'single' quotes");
  }
);

// Test 4: Backslashes in gemini_output
testJsonSerialization(
  'Backslashes in gemini_output',
  { 
    request_id: 'req-4', 
    task: 'path\\to\\file', 
    gemini_output: 'C:\\Users\\Test\\file.txt with \\n and \\t' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, 'C:\\Users\\Test\\file.txt with \\n and \\t');
    assertEqual(parsed.task, 'path\\to\\file');
  }
);

// Test 5: Newlines in gemini_output
testJsonSerialization(
  'Newlines in gemini_output',
  { 
    request_id: 'req-5', 
    task: 'multi\nline\ntask', 
    gemini_output: 'Line 1\nLine 2\nLine 3' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, 'Line 1\nLine 2\nLine 3');
    assertEqual(parsed.task, 'multi\nline\ntask');
  }
);

// Test 6: Tabs in gemini_output
testJsonSerialization(
  'Tabs in gemini_output',
  { 
    request_id: 'req-6', 
    task: 'tab\ttask', 
    gemini_output: 'Col1\tCol2\tCol3' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, 'Col1\tCol2\tCol3');
    assertEqual(parsed.task, 'tab\ttask');
  }
);

// Test 7: JSON-like content in gemini_output
testJsonSerialization(
  'JSON-like content in gemini_output',
  { 
    request_id: 'req-7', 
    task: 'test', 
    gemini_output: '{"key": "value", "nested": {"a": 1}}' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, '{"key": "value", "nested": {"a": 1}}');
  }
);

// Test 8: Mixed special characters
testJsonSerialization(
  'Mixed special characters in gemini_output',
  { 
    request_id: 'req-8', 
    task: 'complex\ttask\nwith"quotes\'and\\backslashes', 
    gemini_output: 'Mixed: "double" \'single\' \\backslash \n newline \t tab {"json": true}' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, 'Mixed: "double" \'single\' \\backslash \n newline \t tab {"json": true}');
    assertEqual(parsed.task, 'complex\ttask\nwith"quotes\'and\\backslashes');
  }
);

// Test 9: Empty gemini_output
testJsonSerialization(
  'Empty gemini_output',
  { 
    request_id: 'req-9', 
    task: 'test', 
    gemini_output: '' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, '');
  }
);

// Test 10: Very long gemini_output
testJsonSerialization(
  'Long gemini_output (10KB)',
  { 
    request_id: 'req-10', 
    task: 'test', 
    gemini_output: 'x'.repeat(10000) 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output.length, 10000);
    assertEqual(parsed.result.gemini_output, 'x'.repeat(10000));
  }
);

// Test 11: Unicode characters
testJsonSerialization(
  'Unicode characters in gemini_output',
  { 
    request_id: 'req-11', 
    task: '测试任务', 
    gemini_output: '🎉 Unicode: café, naïve, résumé, 中文, 日本語, 한국어' 
  },
  (parsed) => {
    assertEqual(parsed.result.gemini_output, '🎉 Unicode: café, naïve, résumé, 中文, 日本語, 한국어');
    assertEqual(parsed.task, '测试任务');
  }
);

// Test 12: Control characters (null, etc.) - should be handled by jq
testJsonSerialization(
  'Null character in gemini_output (jq escapes)',
  { 
    request_id: 'req-12', 
    task: 'test', 
    gemini_output: 'before\u0000after' 
  },
  (parsed) => {
    // jq will escape the null character
    assert(parsed.result.gemini_output.includes('\\u0000') || parsed.result.gemini_output.includes('\u0000'));
  }
);

// Test 13: Verify workflow YAML uses jq for callback payload
test('Workflow YAML uses jq for JSON-safe callback construction', () => {
  const yaml = fs.readFileSync('.github/workflows/main.yml', 'utf8');
  
  // Verify jq is used
  assert(yaml.includes('jq -n'), 'jq -n is used for JSON construction');
  
  // Verify --arg is used for string values (JSON-safe)
  assert(yaml.includes('--arg request_id'), '--arg for request_id');
  assert(yaml.includes('--arg agent'), '--arg for agent');
  assert(yaml.includes('--arg status'), '--arg for status');
  assert(yaml.includes('--arg task'), '--arg for task');
  assert(yaml.includes('--arg invocation_id'), '--arg for invocation_id');
  assert(yaml.includes('--arg run_id'), '--arg for run_id');
  assert(yaml.includes('--arg gemini_output'), '--arg for gemini_output');
  
  // Verify --argjson is used for JSON values
  assert(yaml.includes('--argjson changed_files'), '--argjson for changed_files');
  assert(yaml.includes('--argjson verification'), '--argjson for verification');
  assert(yaml.includes('--argjson commit'), '--argjson for commit');
  assert(yaml.includes('--argjson push'), '--argjson for push');
  assert(yaml.includes('--argjson blockers'), '--argjson for blockers');
  
  // Verify old heredoc approach is NOT used
  assert(!yaml.includes('cat > callback_payload.json <<EOF'), 'Old heredoc approach removed');
  assert(!yaml.includes('"request_id": "$REQUEST_ID"'), 'Old variable interpolation removed');
  assert(!yaml.includes('"task": "$TASK"'), 'Old variable interpolation removed');
  assert(!yaml.includes('"gemini_output": "$GEMINI_OUTPUT"'), 'Old variable interpolation removed');
  
  // Verify required ACP fields are in the jq template
  assert(yaml.includes('request_id: $request_id'), 'request_id in jq template');
  assert(yaml.includes('agent: $agent'), 'agent in jq template');
  assert(yaml.includes('status: $status'), 'status in jq template');
  assert(yaml.includes('task: $task'), 'task in jq template');
  assert(yaml.includes('changed_files: $changed_files'), 'changed_files in jq template');
  assert(yaml.includes('verification: $verification'), 'verification in jq template');
  assert(yaml.includes('invocation_id: $invocation_id'), 'invocation_id in jq template');
  assert(yaml.includes('run_id: $run_id'), 'run_id in jq template');
  assert(yaml.includes('gemini_output: $gemini_output'), 'gemini_output in jq template');
  assert(yaml.includes('commit: $commit'), 'commit in jq template');
  assert(yaml.includes('push: $push'), 'push in jq template');
  assert(yaml.includes('blockers: $blockers'), 'blockers in jq template');
  
  // Verify authentication and correlation preserved
  assert(yaml.includes('x-gemini-callback-secret'), 'Callback secret header preserved');
  assert(yaml.includes('RENDER_GEMINI_CALLBACK_URL'), 'Callback URL preserved');
  assert(yaml.includes('GEMINI_CALLBACK_SECRET'), 'Callback secret env var preserved');
});

// Test 14: Verify existing callback behavior preserved (fail-closed, auth, duplicate)
test('Workflow YAML preserves existing callback behavior', () => {
  const yaml = fs.readFileSync('.github/workflows/main.yml', 'utf8');
  
  // Fail-closed: missing URL/secret skips callback
  assert(yaml.includes('if [ -z "$CALLBACK_URL" ] || [ -z "$CALLBACK_SECRET" ]'), 'Fail-closed config check preserved');
  assert(yaml.includes('skipping callback'), 'Skip callback message preserved');
  assert(yaml.includes('callback_sent=false'), 'callback_sent=false on skip preserved');
  
  // Callback HTTP failure fails workflow
  assert(yaml.includes('exit 1'), 'Exit on callback failure preserved');
  assert(yaml.includes('Callback failed with HTTP'), 'Error message on failure preserved');
  
  // Authentication header
  assert(yaml.includes('x-gemini-callback-secret: $CALLBACK_SECRET'), 'Auth header preserved');
  
  // Content-Type
  assert(yaml.includes('Content-Type: application/json'), 'Content-Type header preserved');
});

console.log(`\n=== JSON Serialization Tests: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);