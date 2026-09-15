const assert = require('assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const taskRegistry = require('../poc/task-registry');
const orchestrator = require('../poc/orchestrator');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

const originalRequest = https.request;

function setupGeminiMock() {
    https.request = (options, callback) => {
        return {
            on: (event, handler) => { if (event === 'end') setTimeout(() => handler(), 5); },
            write: () => {},
            end: () => { setTimeout(() => callback({ statusCode: 204, on: (ev, h) => { if (ev === 'data') h(''); if (ev === 'end') h(); } }), 10); }
        };
    };
}

function restoreMock() {
    https.request = originalRequest;
}

function cleanup() {
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    taskRegistry.resetRegistry();
    restoreMock();
    delete process.env.GITHUB_ORCHESTRATOR_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GEMINI_WORKFLOW_FILE;
}

const validCommand = {
    protocol_version: '0.1',
    request_id: 'handoff-test-1',
    source: 'Qwen',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'handoff-test-task',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'test',
    reporting: 'json',
    originator: 'Kyle'
};

const kiloSuccessReport = {
    request_id: 'handoff-test-1',
    agent: 'Kilo',
    status: 'success',
    task: 'handoff-test-task',
    changed_files: ['poc/new-file.js'],
    verification: ['unit tests passed'],
    result: { execution_metadata: { invocation_id: 'inv-1', run_id: 'run-1' } },
    commit: 'abc123',
    push: true,
    blockers: []
};

const kiloFailureReport = { ...kiloSuccessReport, status: 'failure' };
const kiloBlockedReport = { ...kiloSuccessReport, status: 'blocked', blockers: ['Missing auth'] };

async function runTests() {
    console.log('--- Running Kilo-to-Gemini Handoff Tests ---');
    let passCount = 0;
    let failCount = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`PASS: ${name}`);
            passCount++;
        } catch (err) {
            console.error(`FAIL: ${name} - ${err.message}`);
            failCount++;
        }
    }

    function assertEqual(actual, expected, msg) {
        if (actual !== expected) {
            throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }

    // Test 1: Full Kilo-to-Gemini handoff success
    await test('Full Kilo-to-Gemini handoff - successful dispatch', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupGeminiMock();

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        const result = await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);

        assertEqual(result.success, true);
        assertEqual(result.next_action, 'trigger_gemini');
        assert(result.gemini_dispatch !== null);
        assertEqual(result.gemini_dispatch.status, 'SUCCESS');

        const task = taskRegistry.getTask('handoff-test-1');
        assertEqual(task.kilo.status, 'success');
        assertEqual(task.gemini.status, 'pending');
        assert(task.gemini.execution_id !== undefined);
        assertEqual(task.next_action, 'trigger_gemini');

        cleanup();
    });

    // Test 2: Duplicate Kilo completion idempotency
    await test('Duplicate Kilo completion - idempotency prevents duplicate Gemini dispatch', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupGeminiMock();

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);
        const result = await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);

        assertEqual(result.success, false);
        assertEqual(result.duplicate, true);
        assert(result.error.includes('already recorded'));

        const task = taskRegistry.getTask('handoff-test-1');
        assertEqual(task.kilo.status, 'success');
        assertEqual(task.gemini.status, 'pending');

        cleanup();
    });

    // Test 3: Kilo failure does not trigger Gemini
    await test('Kilo failure does not trigger Gemini dispatch', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        const result = await orchestrator.handleKiloCompletion('handoff-test-1', kiloFailureReport);

        assertEqual(result.success, true);
        assertEqual(result.next_action, 'human_review');
        assertEqual(result.gemini_dispatch, null);

        const task = taskRegistry.getTask('handoff-test-1');
        assertEqual(task.status, 'FAILED');
        assertEqual(task.kilo.status, 'failure');
        assertEqual(task.gemini.status, 'pending');

        cleanup();
    });

    // Test 4: Kilo blocked does not trigger Gemini
    await test('Kilo blocked does not trigger Gemini dispatch', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        const result = await orchestrator.handleKiloCompletion('handoff-test-1', kiloBlockedReport);

        assertEqual(result.success, true);
        assertEqual(result.next_action, 'human_review');
        assertEqual(result.gemini_dispatch, null);

        const task = taskRegistry.getTask('handoff-test-1');
        assertEqual(task.status, 'BLOCKED');
        assertEqual(task.kilo.status, 'blocked');
        assertEqual(task.gemini.status, 'pending');

        cleanup();
    });

    // Test 5: Gemini dispatch failure triggers human_review
    await test('Gemini dispatch failure triggers human_review', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        // Mock failure
        https.request = (options, callback) => {
            return {
                on: (event, handler) => { if (event === 'end') setTimeout(() => handler(), 5); },
                write: () => {},
                end: () => { setTimeout(() => callback({ statusCode: 404, on: (ev, h) => { if (ev === 'data') h('{"message":"Error"}'); if (ev === 'end') h(); } }), 10); }
            };
        };

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        const result = await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);

        assertEqual(result.success, false);
        assertEqual(result.stage, 'gemini_dispatch');
        assert(result.error.includes('Gemini dispatch failed'));

        const task = taskRegistry.getTask('handoff-test-1');
        assertEqual(task.next_action, 'human_review');
        assertEqual(task.gemini.status, 'pending');

        cleanup();
    });

    // Test 6: Missing GitHub token handled gracefully
    await test('Missing GitHub token handled gracefully', async () => {
        cleanup();
        delete process.env.GITHUB_ORCHESTRATOR_TOKEN;

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        const result = await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);

        assertEqual(result.success, false);
        assertEqual(result.stage, 'gemini_dispatch');
        assert(result.error.includes('Missing GitHub orchestrator token'));

        const task = taskRegistry.getTask('handoff-test-1');
        assertEqual(task.next_action, 'human_review');

        cleanup();
    });

    // Test 7: Correlation preserved through handoff
    await test('Correlation preserved through Kilo-to-Gemini handoff', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupGeminiMock();

        const customCommand = { ...validCommand, request_id: 'corr-test-42', parent_request_id: 'parent-123' };
        taskRegistry.createTask(customCommand);
        taskRegistry.updateTaskStatus('corr-test-42', 'SELECTED');
        taskRegistry.updateTaskStatus('corr-test-42', 'PLANNED');
        taskRegistry.updateTaskStatus('corr-test-42', 'EXECUTING');

        const reportWithId = { ...kiloSuccessReport, request_id: 'corr-test-42' };
        await orchestrator.handleKiloCompletion('corr-test-42', reportWithId);

        const task = taskRegistry.getTask('corr-test-42');
        assertEqual(task.request_id, 'corr-test-42');
        assertEqual(task.parent_request_id, 'parent-123');
        assertEqual(task.kilo.report.request_id, 'corr-test-42');
        assertEqual(task.gemini.dispatch_info.request_id, 'corr-test-42');

        cleanup();
    });

    // Test 8: canTriggerGemini returns false after dispatch
    await test('canTriggerGemini returns false after successful dispatch', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupGeminiMock();

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);

        const canTrigger = orchestrator.canTriggerGemini('handoff-test-1');
        assertEqual(canTrigger.canTrigger, false);
        assert(canTrigger.reason.includes('already dispatched'));

        cleanup();
    });

    // Test 9: getOrchestrationState reflects state after dispatch
    await test('getOrchestrationState reflects state after dispatch', async () => {
        cleanup();
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupGeminiMock();

        taskRegistry.createTask(validCommand);
        taskRegistry.updateTaskStatus('handoff-test-1', 'SELECTED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'PLANNED');
        taskRegistry.updateTaskStatus('handoff-test-1', 'EXECUTING');

        await orchestrator.handleKiloCompletion('handoff-test-1', kiloSuccessReport);

        const state = orchestrator.getOrchestrationState('handoff-test-1');
        assertEqual(state.success, true);
        assertEqual(state.state.gemini_status, 'pending');
        assertEqual(state.state.next_action, 'trigger_gemini');

        cleanup();
    });

    console.log(`\n=== Kilo-to-Gemini Handoff Tests: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    cleanup();
    process.exit(1);
});