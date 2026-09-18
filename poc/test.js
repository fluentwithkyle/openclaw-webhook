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

// 8. Security fields: absent (backward compatibility)
runTest('Security fields absent', {
  "protocol_version": "0.1", "request_id": "test-sec-1",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
}, 'SUCCESS');

// 9. Security fields: security_review_required=false, security_audit_context=null
runTest('Security fields false/null', {
  "protocol_version": "0.1", "request_id": "test-sec-2",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R",
  "security_review_required": false,
  "security_audit_context": null
}, 'SUCCESS');

// 10. Security fields: security_review_required=true, security_audit_context=object
runTest('Security fields true/object', {
  "protocol_version": "0.1", "request_id": "test-sec-3",
  "source": "Q", "target": "K", "task_type": "T", "repository": "R", "base_branch": "B",
  "task": "inspect-poc-files",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R",
  "security_review_required": true,
  "security_audit_context": {
    "touch_points": ["auth-boundary"],
    "risk_indicators": ["credential-handling"],
    "requested_focus": ["secrets-exposure"],
    "prior_audit_ref": "audit-001"
  }
}, 'SUCCESS');

// 11. VERIFY_RECONCILE mode with valid authorization and paths
runTest('VERIFY_RECONCILE mode valid', {
  "protocol_version": "0.1", "request_id": "test-vr-1",
  "source": "CHATGPT", "target": "KILO", "task_type": "T",
  "repository": "fluentwithkyle/openclaw-webhook", "base_branch": "main",
  "task": "verify-and-update-docs",
  "task_mode": "VERIFY_RECONCILE",
  "constraints": { "permitted_paths": ["docs/ai/TASK_LOG.md", "docs/ai/STATE.md", "docs/ai/CONTROL_CENTER.md"] },
  "authorization": { "capabilities": ["read_only", "modify_files", "commit", "push"] },
  "verification": "V", "reporting": "R"
}, 'SUCCESS');

// 12. VERIFY_RECONCILE mode missing required capability
runTest('VERIFY_RECONCILE mode missing push capability', {
  "protocol_version": "0.1", "request_id": "test-vr-2",
  "source": "CHATGPT", "target": "KILO", "task_type": "T",
  "repository": "fluentwithkyle/openclaw-webhook", "base_branch": "main",
  "task": "verify-and-update-docs",
  "task_mode": "VERIFY_RECONCILE",
  "constraints": { "permitted_paths": ["docs/ai/TASK_LOG.md", "docs/ai/STATE.md", "docs/ai/CONTROL_CENTER.md"] },
  "authorization": { "capabilities": ["read_only", "modify_files", "commit"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

// 13. VERIFY_RECONCILE mode unauthorized path
runTest('VERIFY_RECONCILE mode unauthorized path', {
  "protocol_version": "0.1", "request_id": "test-vr-3",
  "source": "CHATGPT", "target": "KILO", "task_type": "T",
  "repository": "fluentwithkyle/openclaw-webhook", "base_branch": "main",
  "task": "verify-and-update-docs",
  "task_mode": "VERIFY_RECONCILE",
  "constraints": { "permitted_paths": ["index.js"] },
  "authorization": { "capabilities": ["read_only", "modify_files", "commit", "push"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

// 14. FAILOVER_EXECUTE mode valid
runTest('FAILOVER_EXECUTE mode valid', {
  "protocol_version": "0.1", "request_id": "test-fe-1",
  "source": "CHATGPT", "target": "KILO", "task_type": "T",
  "repository": "fluentwithkyle/openclaw-webhook", "base_branch": "main",
  "task": "emergency-fix",
  "task_mode": "FAILOVER_EXECUTE",
  "constraints": { "permitted_paths": ["index.js", "utils/helper.js"] },
  "authorization": { "capabilities": ["read_only", "modify_files", "run_tests", "commit", "push"] },
  "verification": "V", "reporting": "R"
}, 'SUCCESS');

// 15. FAILOVER_EXECUTE mode missing run_tests
runTest('FAILOVER_EXECUTE mode missing run_tests', {
  "protocol_version": "0.1", "request_id": "test-fe-2",
  "source": "CHATGPT", "target": "KILO", "task_type": "T",
  "repository": "fluentwithkyle/openclaw-webhook", "base_branch": "main",
  "task": "emergency-fix",
  "task_mode": "FAILOVER_EXECUTE",
  "constraints": { "permitted_paths": ["index.js"] },
  "authorization": { "capabilities": ["read_only", "modify_files", "commit", "push"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

// 16. Invalid task_mode rejected
runTest('Invalid task_mode rejected', {
  "protocol_version": "0.1", "request_id": "test-bad-1",
  "source": "Q", "target": "K", "task_type": "T",
  "repository": "R", "base_branch": "B",
  "task": "test",
  "task_mode": "INVALID",
  "constraints": { "permitted_paths": ["poc/"] },
  "authorization": { "capabilities": ["read_only"] },
  "verification": "V", "reporting": "R"
}, 'BLOCKED');

console.log("All tests passed.");
