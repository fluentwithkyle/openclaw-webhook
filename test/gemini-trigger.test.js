const assert = require('assert');
const https = require('https');
const { dispatchGeminiWorkflow } = require('../poc/gemini-trigger');

const originalRequest = https.request;
let mockResponse = { statusCode: 204, data: '' };
let capturedOptions = null;
let capturedPayload = null;

function setupMock(statusCode = 204, responseData = '') {
    mockResponse = { statusCode, data: responseData };
    https.request = (options, callback) => {
        capturedOptions = options;
        return {
            on: (event, handler) => {
                if (event === 'end') {
                    setTimeout(() => handler(), 5);
                }
            },
            write: (data) => { capturedPayload = data; },
            end: () => {
                setTimeout(() => callback({
                    statusCode: mockResponse.statusCode,
                    on: (ev, h) => { if (ev === 'data') h(mockResponse.data); if (ev === 'end') h(); }
                }), 10);
            }
        };
    };
}

function restoreMock() {
    https.request = originalRequest;
    capturedOptions = null;
    capturedPayload = null;
}

async function runTests() {
    console.log('--- Running Gemini Trigger Tests ---');
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

    // Test 1: Missing GitHub token
    await test('Missing GitHub token returns FAILED', async () => {
        delete process.env.GITHUB_ORCHESTRATOR_TOKEN;
        const result = await dispatchGeminiWorkflow('test-1', {
            repository: 'test/repo',
            base_branch: 'main',
            task: 'test-task'
        });
        assertEqual(result.status, 'FAILED');
        assertEqual(result.error, 'Missing GitHub orchestrator token configuration');
        restoreMock();
    });

    // Test 2: Successful dispatch
    await test('Successful workflow dispatch returns SUCCESS', async () => {
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        process.env.GITHUB_REPOSITORY = 'test/repo';
        process.env.GEMINI_WORKFLOW_FILE = 'main.yml';
        setupMock(204);

        const result = await dispatchGeminiWorkflow('test-2', {
            repository: 'test/repo',
            base_branch: 'main',
            task: 'test-task',
            kilo_execution_id: 'kilo-exec-123'
        });

        assertEqual(result.status, 'SUCCESS');
        assertEqual(result.request_id, 'test-2');
        assert(result.message.includes('Successfully dispatched'));
        assert(capturedOptions.headers.Authorization === 'Bearer test-token');
        assert(capturedOptions.method === 'POST');
        const payload = JSON.parse(capturedPayload);
        assertEqual(payload.ref, 'main');
        assertEqual(payload.inputs.request_id, 'test-2');
        assertEqual(payload.inputs.task, 'test-task');
        assertEqual(payload.inputs.kilo_execution_id, 'kilo-exec-123');
        restoreMock();
    });

    // Test 3: Failed dispatch (404)
    await test('Failed workflow dispatch returns FAILED with error', async () => {
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupMock(404, '{"message": "Not Found"}');

        const result = await dispatchGeminiWorkflow('test-3', {
            repository: 'test/repo',
            base_branch: 'main',
            task: 'test-task'
        });

        assertEqual(result.status, 'FAILED');
        assert(result.error.includes('Workflow dispatch failed'));
        assert(result.error.includes('404'));
        restoreMock();
    });

    // Test 4: Network error
    await test('Network error returns FAILED', async () => {
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        https.request = (options, callback) => {
            return {
                on: (event, handler) => {
                    if (event === 'error') {
                        setTimeout(() => handler(new Error('ENOTFOUND')), 5);
                    }
                },
                write: () => {},
                end: () => {}
            };
        };

        const result = await dispatchGeminiWorkflow('test-4', {
            repository: 'test/repo',
            base_branch: 'main',
            task: 'test-task'
        });

        assertEqual(result.status, 'FAILED');
        assert(result.error.includes('Transport error'));
        restoreMock();
    });

    // Test 5: Uses default repository and workflow file when not provided
    await test('Uses default repository and workflow file from env', async () => {
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        delete process.env.GITHUB_REPOSITORY;
        delete process.env.GEMINI_WORKFLOW_FILE;
        setupMock(204);

        const result = await dispatchGeminiWorkflow('test-5', {
            base_branch: 'main',
            task: 'test-task'
        });

        assertEqual(result.status, 'SUCCESS');
        assert(capturedOptions.path.includes('/repos/fluentwithkyle/openclaw-webhook/actions/workflows/main.yml/dispatches'));
        restoreMock();
    });

    // Test 6: Custom base branch
    await test('Uses custom base branch from task context', async () => {
        process.env.GITHUB_ORCHESTRATOR_TOKEN = 'test-token';
        setupMock(204);

        await dispatchGeminiWorkflow('test-6', {
            repository: 'test/repo',
            base_branch: 'feature-branch',
            task: 'test-task'
        });

        const payload = JSON.parse(capturedPayload);
        assertEqual(payload.ref, 'feature-branch');
        restoreMock();
    });

    console.log(`\n=== Gemini Trigger Tests: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
    console.error(err);
    restoreMock();
    process.exit(1);
});