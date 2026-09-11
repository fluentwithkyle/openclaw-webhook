const { validate, execute, normalizePath } = require('./acp-engine');
const assert = require('assert');

function runTest(name, command, expectedStatus) {
    const result = validate(command);
    if (result.status === expectedStatus) {
        console.log(`PASS: ${name}`);
    } else {
        console.error(`FAIL: ${name}. Expected ${expectedStatus}, got ${result.status}. Error: ${result.error}`);
        process.exit(1);
    }
}

// 1. Valid command
runTest('Valid command', {
  "protocol_version": "0.1",
  "request_id": "test-1",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
}, 'SUCCESS');

// 2. Malformed envelope
runTest('Malformed envelope', { "protocol_version": "0.1" }, 'FAILED');

// 3. Unauthorized capability
runTest('Unauthorized capability', {
  "protocol_version": "0.1", "request_id": "test-2",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["modify_files"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

// 4. Invalid permitted paths
runTest('Invalid permitted paths', {
  "protocol_version": "0.1", "request_id": "test-3",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

// 5. Path normalization tests
assert.strictEqual(normalizePath('poc'), 'poc/');
assert.strictEqual(normalizePath('./poc'), 'poc/');
assert.strictEqual(normalizePath('poc/'), 'poc/');
assert.strictEqual(normalizePath('./poc/'), 'poc/');
assert.strictEqual(normalizePath('/'), null);
assert.strictEqual(normalizePath('../poc'), null);
console.log('PASS: Path normalization tests');

// 6. Test successful execution (scoped)
const validCommand = {
  "protocol_version": "0.1",
  "request_id": "test-exec",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["./poc"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
};
const execResult = execute(validCommand);
assert.strictEqual(execResult.status, 'SUCCESS');
assert.ok(execResult.result.includes('poc/acp-engine.js'));
console.log('PASS: Successful execution test');

// 7. Test blocked execution (fail closed)
const invalidCommand = {
  "protocol_version": "0.1",
  "request_id": "test-blocked",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
};
const blockedResult = execute(invalidCommand);
assert.strictEqual(blockedResult.status, 'BLOCKED');
console.log('PASS: Blocked execution test (fail closed)');

console.log("All tests passed.");
