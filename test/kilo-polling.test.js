const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');
const kiloPolling = require('../poc/kilo-polling');
const mockKiloProvider = require('../poc/mock-kilo-provider');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

let passCount = 0;
let failCount = 0;

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`PASS: ${name}`);
        passCount++;
        return true;
    } catch (err) {
        console.error(`FAIL: ${name} - ${err.message}`);
        failCount++;
        return false;
    }
}

function cleanup() {
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    taskRegistry.resetRegistry();
    mockKiloProvider.clearAllMockStatuses();
    kiloPolling.stopPolling();
}

const validCommand = {
    protocol_version: '0.1',
    request_id: 'poll-test-1',
    source: 'Qwen',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'poll-test-task',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'All tests must pass',
    reporting: 'json',
    originator: 'Kyle'
};

function setupTask(requestId) {
    cleanup();
    taskRegistry.createTask({ ...validCommand, request_id: requestId });
    taskRegistry.updateTaskStatus(requestId, 'SELECTED');
    taskRegistry.updateTaskStatus(requestId, 'PLANNED');
    taskRegistry.updateTaskStatus(requestId, 'EXECUTING');
}

async function main() {
    kiloPolling.setProviderClient(mockKiloProvider);

    await runTest('pollKiloCompletion - returns error when task not found', async () => {
        cleanup();
        const result = await kiloPolling.pollKiloCompletion('non-existent');
        assertEqual(result.success, false);
        assert(result.error.includes('Task not found'));
    });

    await runTest('pollKiloCompletion - returns terminal success when Kilo already completed', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-2');
        taskRegistry.updateAgentResult('poll-test-2', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        const result = await kiloPolling.pollKiloCompletion('poll-test-2');
        assertEqual(result.success, true);
        assertEqual(result.terminal, true);
        assertEqual(result.status, 'success');
    });

    await runTest('pollKiloCompletion - returns error when no provider client', async () => {
        cleanup();
        kiloPolling.setProviderClient(null);
        setupTask('poll-test-3');
        const result = await kiloPolling.pollKiloCompletion('poll-test-3');
        assertEqual(result.success, false);
        assert(result.error.includes('No provider client configured'));
    });

    await runTest('pollKiloCompletion - returns in_progress when provider returns in_progress', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-4');
        mockKiloProvider.setMockStatus('poll-test-4', 'in_progress');
        const result = await kiloPolling.pollKiloCompletion('poll-test-4');
        assertEqual(result.success, true);
        assertEqual(result.status, 'in_progress');
    });

    await runTest('pollAndProcess - processes success completion', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-5');
        mockKiloProvider.setMockStatus('poll-test-5', 'success', {
            task: 'poll-test-task',
            changed_files: ['file1.js'],
            verification: ['test passed'],
            result: { implementation: 'complete' },
            commit: 'abc123',
            push: true,
            blockers: []
        });
        const result = await kiloPolling.pollAndProcess('poll-test-5');
        assertEqual(result.success, true);
        assertEqual(result.terminal, true);
        assertEqual(result.next_action, 'trigger_builder');
        const task = taskRegistry.getTask('poll-test-5');
        assertEqual(task.kilo.status, 'success');
    });

    await runTest('pollAndProcess - processes failure completion', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-6');
        mockKiloProvider.setMockStatus('poll-test-6', 'failure', {
            task: 'poll-test-task',
            changed_files: [],
            verification: [],
            result: { error: 'failed' },
            commit: null,
            push: false,
            blockers: ['Implementation failed']
        });
        const result = await kiloPolling.pollAndProcess('poll-test-6');
        assertEqual(result.success, true);
        assertEqual(result.terminal, true);
        assertEqual(result.next_action, 'human_review');
        const task = taskRegistry.getTask('poll-test-6');
        assertEqual(task.status, 'FAILED');
        assertEqual(task.kilo.status, 'failure');
    });

    await runTest('pollAndProcess - processes blocked completion', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-7');
        mockKiloProvider.setMockStatus('poll-test-7', 'blocked', {
            task: 'poll-test-task',
            changed_files: [],
            verification: [],
            result: {},
            commit: null,
            push: false,
            blockers: ['Missing authorization']
        });
        const result = await kiloPolling.pollAndProcess('poll-test-7');
        assertEqual(result.success, true);
        assertEqual(result.terminal, true);
        assertEqual(result.next_action, 'human_review');
        const task = taskRegistry.getTask('poll-test-7');
        assertEqual(task.status, 'BLOCKED');
        assertEqual(task.kilo.status, 'blocked');
    });

    await runTest('pollAndProcess - idempotency returns same result for duplicate calls', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-8');
        mockKiloProvider.setMockStatus('poll-test-8', 'success', {
            task: 'poll-test-task',
            changed_files: ['file1.js'],
            verification: ['test passed'],
            result: { implementation: 'complete' },
            commit: 'abc123',
            push: true,
            blockers: []
        });
        const result1 = await kiloPolling.pollAndProcess('poll-test-8');
        assertEqual(result1.success, true);
        assertEqual(result1.terminal, true);
        const result2 = await kiloPolling.pollAndProcess('poll-test-8');
        assertEqual(result2.success, true);
        assertEqual(result2.terminal, true);
        assertEqual(result2.status, 'success');
    });

    await runTest('pollAndProcess - uses provider identifiers from task registry', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-9');
        const task = taskRegistry.getTask('poll-test-9');
        task.kilo.provider_session_id = 'session-123';
        task.kilo.provider_message_id = 'message-456';
        task.kilo.provider_invocation_id = 'invocation-789';
        taskRegistry.persistCache();

        mockKiloProvider.setMockStatus('poll-test-9', 'success', {
            task: 'poll-test-task',
            changed_files: ['file1.js'],
            verification: ['test passed'],
            result: { implementation: 'complete' },
            commit: 'abc123',
            push: true,
            blockers: []
        });
        const result = await kiloPolling.pollAndProcess('poll-test-9');
        assertEqual(result.success, true);
        const updatedTask = taskRegistry.getTask('poll-test-9');
        assertEqual(updatedTask.kilo.report.result.execution_metadata.invocation_id, 'invocation-789');
        assertEqual(updatedTask.kilo.report.result.execution_metadata.run_id, 'session-123');
    });

    await runTest('startPolling - starts and stops correctly', async () => {
        cleanup();
        kiloPolling.setProviderClient(mockKiloProvider);
        setupTask('poll-test-10');
        mockKiloProvider.setMockStatus('poll-test-10', 'success', {
            task: 'poll-test-task',
            changed_files: ['file1.js'],
            verification: ['test passed'],
            result: { implementation: 'complete' },
            commit: 'abc123',
            push: true,
            blockers: []
        });
        const startResult = await kiloPolling.startPolling({ intervalMs: 100, maxRetries: 2 });
        assertEqual(startResult.success, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        const task = taskRegistry.getTask('poll-test-10');
        assertEqual(task.kilo.status, 'success');
        kiloPolling.stopPolling();
    });

    console.log(`\n=== Kilo Polling Tests: ${passCount} passed, ${failCount} failed ===`);
    kiloPolling.stopPolling();
    if (failCount > 0) process.exit(1);
}

main().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});