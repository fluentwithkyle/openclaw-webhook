const assert = require('assert');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

function runTest(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(() => {
                console.log(`PASS: ${name}`);
                return true;
            }).catch(err => {
                console.error(`FAIL: ${name} - ${err.message}`);
                return false;
            });
        }
        console.log(`PASS: ${name}`);
        return Promise.resolve(true);
    } catch (err) {
        console.error(`FAIL: ${name} - ${err.message}`);
        return Promise.resolve(false);
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
    request_id: 'test-orch-1',
    source: 'Qwen',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'test-task',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'test',
    reporting: 'json',
    originator: 'Kyle'
};

const validKiloReport = {
    request_id: 'test-orch-1',
    agent: 'Kilo',
    status: 'success',
    task: 'test-task',
    changed_files: ['file1.js'],
    verification: ['test passed'],
    result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
    commit: 'abc123',
    push: true,
    blockers: []
};

const validGeminiReport = {
    request_id: 'test-orch-1',
    agent: 'Gemini',
    status: 'success',
    task: 'test-task',
    changed_files: [],
    verification: ['review passed'],
    result: { execution_metadata: { invocation_id: 'inv-2', run_id: 'run-2' } },
    commit: null,
    push: false,
    blockers: []
};

function cleanup() {
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    taskRegistry.resetRegistry();
}

function setupTask() {
    cleanup();
    taskRegistry.createTask(validCommand);
    taskRegistry.updateTaskStatus('test-orch-1', 'SELECTED');
    taskRegistry.updateTaskStatus('test-orch-1', 'PLANNED');
    taskRegistry.updateTaskStatus('test-orch-1', 'EXECUTING');
}

async function runAllTests() {
    await test('handleKiloCompletion - valid success report', async () => {
        setupTask();
        // Mock the gemini dispatch to avoid network calls
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        const https = require('https');
        const originalRequest = https.request;
        https.request = (options, callback) => {
            return {
                on: (event, handler) => { if (event === 'end') setTimeout(() => handler(), 5); },
                write: () => {},
                end: () => { setTimeout(() => callback({ statusCode: 204, on: (ev, h) => { if (ev === 'data') h(''); if (ev === 'end') h(); } }), 10); }
            };
        };

        const result = await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
        assertEqual(result.success, true);
        assertEqual(result.next_action, 'trigger_gemini');
        const task = taskRegistry.getTask('test-orch-1');
        assertEqual(task.status, 'EXECUTING');
        assertEqual(task.kilo.status, 'success');
        assertEqual(task.current_agent, 'Gemini');
        assertEqual(task.gemini.status, 'pending');
        https.request = originalRequest;
        cleanup();
    });

    await test('handleKiloCompletion - failure report transitions to FAILED', async () => {
        setupTask();
        const failureReport = { ...validKiloReport, status: 'failure' };
        const result = await orchestrator.handleKiloCompletion('test-orch-1', failureReport);
        assertEqual(result.success, true);
        assertEqual(result.next_action, 'human_review');
        const task = taskRegistry.getTask('test-orch-1');
        assertEqual(task.status, 'FAILED');
        cleanup();
    });

    await test('handleKiloCompletion - blocked report transitions to BLOCKED', async () => {
        setupTask();
        const blockedReport = { ...validKiloReport, status: 'blocked' };
        const result = await orchestrator.handleKiloCompletion('test-orch-1', blockedReport);
        assertEqual(result.success, true);
        assertEqual(result.next_action, 'human_review');
        const task = taskRegistry.getTask('test-orch-1');
        assertEqual(task.status, 'BLOCKED');
        cleanup();
    });

    await test('handleKiloCompletion - invalid report fails validation', async () => {
        setupTask();
        const invalidReport = { ...validKiloReport, agent: 'Invalid' };
        const result = await orchestrator.handleKiloCompletion('test-orch-1', invalidReport);
        assertEqual(result.success, false);
        assert(result.error.includes('Invalid execution report'));
        cleanup();
    });

    await test('handleKiloCompletion - repository mismatch fails', async () => {
        setupTask();
        const mismatchReport = { ...validKiloReport, repository: 'other/repo' };
        const result = await orchestrator.handleKiloCompletion('test-orch-1', mismatchReport);
        assertEqual(result.success, false);
        assert(result.error.includes('Repository mismatch'));
        cleanup();
    });

    await test('handleKiloCompletion - wrong agent fails', async () => {
        setupTask();
        const wrongAgentReport = { ...validKiloReport, agent: 'Gemini' };
        const result = await orchestrator.handleKiloCompletion('test-orch-1', wrongAgentReport);
        assertEqual(result.success, false);
        assert(result.error.includes('Expected Kilo report'));
        cleanup();
    });

    await test('handleKiloCompletion - idempotency prevents duplicate', async () => {
        setupTask();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        const https = require('https');
        const originalRequest = https.request;
        https.request = (options, callback) => {
            return {
                on: (event, handler) => { if (event === 'end') setTimeout(() => handler(), 5); },
                write: () => {},
                end: () => { setTimeout(() => callback({ statusCode: 204, on: (ev, h) => { if (ev === 'data') h(''); if (ev === 'end') h(); } }), 10); }
            };
        };

        await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
        const result = await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
        assertEqual(result.success, false);
        assert(result.error.includes('already recorded'));
        assertEqual(result.duplicate, true);
        https.request = originalRequest;
        cleanup();
    });

    await test('handleKiloCompletion - non-existent task fails', async () => {
        cleanup();
        const result = await orchestrator.handleKiloCompletion('non-existent', validKiloReport);
        assertEqual(result.success, false);
        assert(result.error.includes('not found'));
        cleanup();
    });

    await test('handleGeminiCompletion - valid success report', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        const result = await orchestrator.handleGeminiCompletion('test-orch-1', validGeminiReport);
        assertEqual(result.success, true);
        assertEqual(result.next_action, 'complete');
        const task = taskRegistry.getTask('test-orch-1');
        assertEqual(task.status, 'VERIFIED');
        assertEqual(task.gemini.status, 'success');
        assertEqual(task.current_agent, null);
        cleanup();
    });

    await test('handleGeminiCompletion - failure transitions to FAILED', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        const failureReport = { ...validGeminiReport, status: 'failure' };
        const result = await orchestrator.handleGeminiCompletion('test-orch-1', failureReport);
        assertEqual(result.success, true);
        assertEqual(result.next_action, 'human_review');
        const task = taskRegistry.getTask('test-orch-1');
        assertEqual(task.status, 'FAILED');
        cleanup();
    });

    await test('handleGeminiCompletion - idempotency prevents duplicate', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        await orchestrator.handleGeminiCompletion('test-orch-1', validGeminiReport);
        const result = await orchestrator.handleGeminiCompletion('test-orch-1', validGeminiReport);
        assertEqual(result.success, false);
        assert(result.error.includes('already recorded'));
        assertEqual(result.duplicate, true);
        cleanup();
    });

    await test('handleGeminiCompletion - invalid report fails validation', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        const invalidReport = { ...validGeminiReport, agent: 'Kilo' };
        const result = await orchestrator.handleGeminiCompletion('test-orch-1', invalidReport);
        assertEqual(result.success, false);
        assert(result.error.includes('Expected Gemini report'));
        cleanup();
    });

    await test('canTriggerGemini - returns true when Kilo succeeded and Gemini pending', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        const result = orchestrator.canTriggerGemini('test-orch-1');
        assertEqual(result.canTrigger, true);
        cleanup();
    });

    await test('canTriggerGemini - returns false when Kilo not success', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'failure', execution_id: 'exec-1', report: {} });
        const result = orchestrator.canTriggerGemini('test-orch-1');
        assertEqual(result.canTrigger, false);
        assert(result.reason.includes('not success'));
        cleanup();
    });

    await test('canTriggerGemini - returns false when Gemini already run', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        taskRegistry.updateAgentResult('test-orch-1', 'Gemini', { status: 'success', execution_id: 'exec-2', report: {} });
        const result = orchestrator.canTriggerGemini('test-orch-1');
        assertEqual(result.canTrigger, false);
        assert(result.reason.includes('already'));
        cleanup();
    });

    await test('canTriggerGemini - returns false when task not EXECUTING', async () => {
        setupTask();
        taskRegistry.updateAgentResult('test-orch-1', 'Kilo', { status: 'success', execution_id: 'exec-1', report: {} });
        taskRegistry.updateTaskStatus('test-orch-1', 'VERIFIED');
        const result = orchestrator.canTriggerGemini('test-orch-1');
        assertEqual(result.canTrigger, false);
        assert(result.reason.includes('not EXECUTING'));
        cleanup();
    });

    await test('getOrchestrationState - returns current state', async () => {
        setupTask();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        const https = require('https');
        const originalRequest = https.request;
        https.request = (options, callback) => {
            return {
                on: (event, handler) => { if (event === 'end') setTimeout(() => handler(), 5); },
                write: () => {},
                end: () => { setTimeout(() => callback({ statusCode: 204, on: (ev, h) => { if (ev === 'data') h(''); if (ev === 'end') h(); } }), 10); }
            };
        };

        await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
        const result = orchestrator.getOrchestrationState('test-orch-1');
        assertEqual(result.success, true);
        assertEqual(result.state.kilo_status, 'success');
        assertEqual(result.state.gemini_status, 'pending');
        assertEqual(result.state.next_action, 'trigger_gemini');
        https.request = originalRequest;
        cleanup();
    });

    await test('determineNextAction - returns next action', async () => {
        setupTask();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        const https = require('https');
        const originalRequest = https.request;
        https.request = (options, callback) => {
            return {
                on: (event, handler) => { if (event === 'end') setTimeout(() => handler(), 5); },
                write: () => {},
                end: () => { setTimeout(() => callback({ statusCode: 204, on: (ev, h) => { if (ev === 'data') h(''); if (ev === 'end') h(); } }), 10); }
            };
        };

        await orchestrator.handleKiloCompletion('test-orch-1', validKiloReport);
        const result = orchestrator.determineNextAction('test-orch-1');
        assertEqual(result.success, true);
        assertEqual(result.next_action, 'trigger_gemini');
        https.request = originalRequest;
        cleanup();
    });

    console.log(`\n=== Orchestrator Tests: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) process.exit(1);
}

runAllTests().catch(err => {
    console.error(err);
    process.exit(1);
});