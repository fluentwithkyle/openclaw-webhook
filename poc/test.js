const { validate } = require('./acp-engine');
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
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B", "task": "I",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
}, 'SUCCESS');

// 2. Malformed envelope
runTest('Malformed envelope', { "protocol_version": "0.1" }, 'FAILED');

// 3. Unauthorized capability
runTest('Unauthorized capability', {
  "protocol_version": "0.1", "request_id": "test-2",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B", "task": "I",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["modify_files"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

// 4. Invalid permitted paths
runTest('Invalid permitted paths', {
  "protocol_version": "0.1", "request_id": "test-3",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B", "task": "I",
  "constraints": { "permitted_paths": ["/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

console.log("All tests passed.");
