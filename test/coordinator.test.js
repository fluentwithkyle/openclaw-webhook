const assert = require('assert');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const taskRegistry = require('../poc/task-registry');
const { setDispatcher } = require('../services/transport-provider');
const { dispatch } = require('../poc/kilo-transport');

const REGISTRY_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json');
const BACKUP_FILE = path.join(__dirname, '..', 'poc', 'task-registry.json.bak');

const app = express();
app.use(express.json());

process.env.DEEPSEEK_COORDINATOR_SECRET = 'test-deepseek-secret';
process.env.ACP_POC_TRIGGER_SECRET = 'test-secret';
process.env.KILO_CALLBACK_SECRET = 'test-kilo-secret';
process.env.GEMINI_CALLBACK_SECRET = 'test-gemini-secret';

const { router: pocRouter } = require('../routes/poc');
app.use('/poc', pocRouter);

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            request_id: 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Malformed JSON in request body'
        });
    }
    next(err);
});

const server = app.listen(3004);

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

let passCount = 0;
let failCount = 0;

function cleanup() {
    if (fs.existsSync(REGISTRY_FILE)) fs.unlinkSync(REGISTRY_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    taskRegistry.resetRegistry();
}

function makeCommand(requestId) {
    return {
        protocol_version: '0.1',
        request_id: requestId,
        source: 'DeepSeek Coordinator',
        target: 'Kilo',
        task_type: 'implementation',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: 'test-coordinator-task',
        constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only'] },
        verification: 'Run tests and verify',
        reporting: 'json',
        originator: 'Kyle'
    };
}

async function makeRequest(options, data = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body || '{}') });
                } catch (e) {
                    resolve({ status: res.statusCode, body: body });
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function makeRawRequest(options, rawData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body || '{}') });
                } catch (e) {
                    resolve({ status: res.statusCode, body: body });
                }
            });
        });
        req.on('error', reject);
        if (rawData) req.write(rawData);
        req.end();
    });
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
    // Test 1: Valid authenticated canonical ACP request -> 202
    await runTest('Coordinator - valid authenticated ACP request returns 202 and registers task', async () => {
        cleanup();
        const command = makeCommand('coord-test-1');
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, command);
        assertEqual(res.status, 202);
        assertEqual(res.body.request_id, 'coord-test-1');
        assertEqual(res.body.status, 'Task registered');
        assertEqual(res.body.stage, 'registered');
        assertEqual(res.body.execution_initiated, false);
        assertEqual(res.body.task_status, 'PENDING');

        const task = taskRegistry.getTask('coord-test-1');
        assert(task !== null, 'Task should be registered');
        assertEqual(task.request_id, 'coord-test-1');
        assertEqual(task.status, 'PENDING');
        assertEqual(task.current_agent, 'Kilo');

        cleanup();
    });

    // Test 2: Missing authentication -> 401
    await runTest('Coordinator - missing auth returns 401 and does not register task', async () => {
        cleanup();
        const command = makeCommand('coord-test-2');
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, command);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        const task = taskRegistry.getTask('coord-test-2');
        assertEqual(task, null);

        cleanup();
    });

    // Test 3: Invalid authentication -> 401
    await runTest('Coordinator - invalid auth returns 401 and does not register task', async () => {
        cleanup();
        const command = makeCommand('coord-test-3');
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'wrong-secret' }
        }, command);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        const task = taskRegistry.getTask('coord-test-3');
        assertEqual(task, null);

        cleanup();
    });

    // Test 4: Malformed JSON -> 400
    await runTest('Coordinator - malformed JSON returns 400', async () => {
        cleanup();
        const res = await makeRawRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, '{invalid json}');
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');

        cleanup();
    });

    // Test 5: Missing required ACP field -> 400
    await runTest('Coordinator - missing required ACP field returns 400', async () => {
        cleanup();
        const command = makeCommand('coord-test-5');
        delete command.request_id;
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, command);
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');
        assert(res.body.error.includes('request_id'));

        cleanup();
    });

    // Test 6: Invalid ACP authorization/structure -> 400
    await runTest('Coordinator - invalid ACP authorization structure returns 400', async () => {
        cleanup();
        const command = makeCommand('coord-test-6');
        command.authorization = { capabilities: 'not-an-array' };
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, command);
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');
        assert(res.body.error.includes('capabilities'));

        cleanup();
    });

    // Test 7: Duplicate request_id -> 409
    await runTest('Coordinator - duplicate request_id returns 409 and existing task remains intact', async () => {
        cleanup();
        const command = makeCommand('coord-test-7');

        const res1 = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, command);
        assertEqual(res1.status, 202);

        const res2 = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, command);
        assertEqual(res2.status, 409);
        assertEqual(res2.body.status, 'duplicate');

        const task = taskRegistry.getTask('coord-test-7');
        assert(task !== null);
        assertEqual(task.status, 'PENDING');
        assertEqual(task.request_id, 'coord-test-7');

        cleanup();
    });

    // Test 8: Registration failure -> 500
    await runTest('Coordinator - registration failure returns 500', async () => {
        cleanup();
        const command = makeCommand('coord-test-8');

        const originalCreateTask = taskRegistry.createTask;
        taskRegistry.createTask = () => ({ success: false, error: 'Simulated registry failure' });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
            }, command);
            assertEqual(res.status, 500);
            assertEqual(res.body.status, 'registration failed');
        } finally {
            taskRegistry.createTask = originalCreateTask;
        }

        cleanup();
    });

    // Test 9: Registration-only behavior -> does not invoke getDispatcher()
    await runTest('Coordinator - registration-only does not invoke getDispatcher()', async () => {
        cleanup();
        const command = makeCommand('coord-test-9');

        let dispatcherCalled = false;
        setDispatcher(() => {
            dispatcherCalled = true;
            return { status: 'SUCCESS' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
            }, command);
            assertEqual(res.status, 202);
            assertEqual(res.body.status, 'Task registered');
            assertEqual(dispatcherCalled, false, 'getDispatcher should not be called for registration-only');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 10: Existing Kilo/Gemini routes remain unaffected
    await runTest('Coordinator - existing /poc/kilo route auth still works (401 without secret)', async () => {
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/kilo', method: 'POST'
        }, {});
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');
    });

    await runTest('Coordinator - existing /poc/kilo/callback route auth still works (401 without secret)', async () => {
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/kilo/callback', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { request_id: 'test', agent: 'Kilo', status: 'success' });
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');
    });

    await runTest('Coordinator - existing /poc/gemini/callback route auth still works (401 without secret)', async () => {
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/gemini/callback', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { request_id: 'test', agent: 'Gemini', status: 'success' });
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');
    });

    // Test: Missing env secret fails closed
    await runTest('Coordinator - missing env secret fails closed', async () => {
        const originalSecret = process.env.DEEPSEEK_COORDINATOR_SECRET;
        delete process.env.DEEPSEEK_COORDINATOR_SECRET;

        const command = makeCommand('coord-test-nosecret');
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, command);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        process.env.DEEPSEEK_COORDINATOR_SECRET = originalSecret;
    });

    // Test: DeepSeek secret is distinct from other secrets
    await runTest('Coordinator - KILO_CALLBACK_SECRET does not authenticate coordinator', async () => {
        cleanup();
        const command = makeCommand('coord-test-distinct');
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-kilo-secret' }
        }, command);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        const task = taskRegistry.getTask('coord-test-distinct');
        assertEqual(task, null);

        cleanup();
    });

    // Test: Request body with no body (undefined) -> 400
    await runTest('Coordinator - missing body returns 400', async () => {
        cleanup();
        const res = await makeRequest({
            hostname: 'localhost', port: 3004, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deepseek-coordinator-secret': 'test-deepseek-secret' }
        }, null);
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');

        const task = taskRegistry.getTask('coord-test-nobody');
        assertEqual(task, null);

        cleanup();
    });

    server.close();

    console.log(`\n=== Coordinator Tests: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) process.exit(1);
}

main().catch(console.error);
