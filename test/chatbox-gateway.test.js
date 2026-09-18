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

process.env.CHATBOX_GATEWAY_SECRET = 'test-chatbox-secret';
process.env.DEEPSEEK_COORDINATOR_SECRET = 'test-deepseek-secret';

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

const server = app.listen(3005);

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

function makeOpenAiRequest(messages, model) {
    return { model: model || 'gpt-4', messages };
}

function validChatboxBody() {
    return makeOpenAiRequest([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'I would like to automate client lesson prep. Go create the system that can accomplish this.' }
    ]);
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

const chatboxAuth = { 'x-chatbox-gateway-secret': 'test-chatbox-secret' };
const deepseekAuth = { 'x-deepseek-coordinator-secret': 'test-deepseek-secret' };

async function main() {
    // Test 1: Valid authenticated OpenAI request -> 202, task registered, and dispatched
    await runTest('Chatbox - valid authenticated OpenAI request returns 202, registers task, and dispatches', async () => {
        cleanup();
        const body = validChatboxBody();

        let dispatchedCommand = null;
        setDispatcher((cmd) => {
            dispatchedCommand = cmd;
            return { status: 'SUCCESS', provider_session_id: 'session-123' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 202);
            assertEqual(res.body.status, 'Task registered and dispatched');
            assertEqual(res.body.stage, 'dispatched');
            assertEqual(res.body.execution_initiated, true);
            assertEqual(res.body.task_status, 'PENDING');
            assertEqual(res.body.current_agent, 'Kilo');
            assertEqual(res.body.next_agent, 'Gemini');

            const task = taskRegistry.getTask(res.body.request_id);
            assert(task !== null, 'Task should be registered');
            assertEqual(task.status, 'PENDING');
            assertEqual(task.current_agent, 'Kilo');
            assertEqual(task.request_id, res.body.request_id);
            assertEqual(task.kilo.provider_session_id, 'session-123');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 2: Missing authentication -> 401
    await runTest('Chatbox - missing auth returns 401 and does not register task', async () => {
        cleanup();
        const body = validChatboxBody();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, body);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        assertEqual(taskRegistry.getAllTasks().length, 0, 'No task should be registered');

        cleanup();
    });

    // Test 3: Invalid authentication -> 401
    await runTest('Chatbox - invalid auth returns 401 and does not register task', async () => {
        cleanup();
        const body = validChatboxBody();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-chatbox-gateway-secret': 'wrong-secret' }
        }, body);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        assertEqual(taskRegistry.getAllTasks().length, 0, 'No task should be registered');

        cleanup();
    });

    // Test 4: Missing model field -> 400
    await runTest('Chatbox - missing model field returns 400', async () => {
        cleanup();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', ...chatboxAuth }
        }, { messages: validChatboxBody().messages });
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');
        assert(res.body.error.includes('model'));

        cleanup();
    });

    // Test 5: Missing messages field -> 400
    await runTest('Chatbox - missing messages field returns 400', async () => {
        cleanup();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', ...chatboxAuth }
        }, { model: 'gpt-4' });
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');
        assert(res.body.error.includes('messages'));

        cleanup();
    });

    // Test 6: Empty messages array -> 400
    await runTest('Chatbox - empty messages array returns 400', async () => {
        cleanup();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', ...chatboxAuth }
        }, { model: 'gpt-4', messages: [] });
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');
        assert(res.body.error.includes('empty'));

        cleanup();
    });

    // Test 7: Message without role or content -> 400
    await runTest('Chatbox - message missing role returns 400', async () => {
        cleanup();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', ...chatboxAuth }
        }, { model: 'gpt-4', messages: [{ content: 'hello' }] });
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');

        cleanup();
    });

    // Test 8: No user message -> 400
    await runTest('Chatbox - no user message returns 400', async () => {
        cleanup();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', ...chatboxAuth }
        }, { model: 'gpt-4', messages: [{ role: 'system', content: 'You are helpful.' }] });
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');
        assert(res.body.error.includes('user message'));

        cleanup();
    });

    // Test 9: Natural-language intent preservation — intent stored in ACP task field
    await runTest('Chatbox - natural-language intent preserved in ACP command task field', async () => {
        cleanup();
        const intent = 'I would like to automate client lesson prep. Go create the system.';
        const body = makeOpenAiRequest([{ role: 'user', content: intent }], 'gpt-4');

        let dispatchedCommand = null;
        setDispatcher((cmd) => {
            dispatchedCommand = cmd;
            return { status: 'SUCCESS' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 202);

            assert(dispatchedCommand !== null, 'Dispatcher should have been called');
            assertEqual(dispatchedCommand.source, 'Chatbox');
            assertEqual(dispatchedCommand.target, 'Kilo');
            assertEqual(dispatchedCommand.task_mode, 'REVIEW');
            assert(dispatchedCommand.task.includes(intent), 'Task field must contain the natural-language intent');

            const naturalLanguageField = dispatchedCommand.natural_language_intent;
            assert(naturalLanguageField !== undefined, 'natural_language_intent field must be preserved');
            assertEqual(naturalLanguageField.source, 'Chatbox');
            assertEqual(naturalLanguageField.model, 'gpt-4');
            assert(Array.isArray(naturalLanguageField.messages), 'messages must be an array');
            assertEqual(naturalLanguageField.messages[0].content, intent);
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 10: Downstream control-plane handoff — dispatch uses existing getDispatcher() path with valid ACP command
    await runTest('Chatbox - intent passed through existing control-plane validation and dispatch', async () => {
        cleanup();
        const body = validChatboxBody();

        let dispatchedCommand = null;
        setDispatcher((cmd) => {
            dispatchedCommand = cmd;
            return { status: 'SUCCESS', provider_session_id: 'sess-abc', provider_message_id: 'msg-def', provider_invocation_id: 'inv-ghi' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 202);
            assertEqual(res.body.execution_initiated, true);

            assert(dispatchedCommand !== null, 'Dispatcher (getDispatcher) should have been called');
            assertEqual(dispatchedCommand.protocol_version, '0.1');
            assertEqual(dispatchedCommand.repository, 'fluentwithkyle/openclaw-webhook');
            assertEqual(dispatchedCommand.base_branch, 'main');
            assertEqual(dispatchedCommand.task_type, 'natural-language-ingress');

            const task = taskRegistry.getTask(res.body.request_id);
            assert(task !== null, 'Task should be in registry');
            assertEqual(task.kilo.provider_session_id, 'sess-abc');
            assertEqual(task.kilo.provider_message_id, 'msg-def');
            assertEqual(task.kilo.provider_invocation_id, 'inv-ghi');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 11: Gateway does NOT grant elevated capabilities — only REVIEW mode with read_only
    await runTest('Chatbox - gateway does not independently grant elevated capabilities (REVIEW/read_only only)', async () => {
        cleanup();
        const body = validChatboxBody();

        let dispatchedCommand = null;
        setDispatcher((cmd) => {
            dispatchedCommand = cmd;
            return { status: 'SUCCESS' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 202);

            assert(dispatchedCommand !== null);
            assertEqual(dispatchedCommand.task_mode, 'REVIEW');
            assertEqual(JSON.stringify(dispatchedCommand.authorization.capabilities), JSON.stringify(['read_only']));
            assert(!dispatchedCommand.authorization.capabilities.includes('modify_files'));
            assert(!dispatchedCommand.authorization.capabilities.includes('commit'));
            assert(!dispatchedCommand.authorization.capabilities.includes('push'));
            assert(!dispatchedCommand.authorization.capabilities.includes('run_tests'));
            assertEqual(JSON.stringify(dispatchedCommand.constraints.permitted_paths), JSON.stringify(['poc/']));
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 12: Registration failure -> 500, dispatcher not called
    await runTest('Chatbox - registration failure returns 500 and does not dispatch', async () => {
        cleanup();
        const body = validChatboxBody();

        const originalCreateTask = taskRegistry.createTask;
        taskRegistry.createTask = () => ({ success: false, error: 'Simulated registry failure' });

        let dispatcherCalled = false;
        setDispatcher(() => {
            dispatcherCalled = true;
            return { status: 'SUCCESS' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 500);
            assertEqual(res.body.status, 'registration failed');
            assertEqual(dispatcherCalled, false, 'Dispatcher should not be called on registration failure');
        } finally {
            taskRegistry.createTask = originalCreateTask;
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 13: Dispatch failure (FAILED status) -> 500, task still registered
    await runTest('Chatbox - dispatch failure returns 500 with task still registered', async () => {
        cleanup();
        const body = validChatboxBody();
        setDispatcher(() => ({ status: 'FAILED', error: 'Transport error' }));

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 500);
            assertEqual(res.body.status, 'Kilo transport failure');
            assertEqual(res.body.execution_initiated, false);
            assert(res.body.error.includes('Transport error'));

            const task = taskRegistry.getTask(res.body.request_id);
            assert(task !== null, 'Task should be registered even if dispatch failed');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 14: Dispatch blocked (BLOCKED status) -> 403, task still registered
    await runTest('Chatbox - dispatch blocked returns 403 with task still registered', async () => {
        cleanup();
        const body = validChatboxBody();
        setDispatcher(() => ({ status: 'BLOCKED', error: 'ACP validation blocked at dispatch' }));

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 403);
            assertEqual(res.body.status, 'ACP validation blocked');
            assertEqual(res.body.execution_initiated, false);

            const task = taskRegistry.getTask(res.body.request_id);
            assert(task !== null, 'Task should be registered even if dispatch blocked');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 15: Dispatcher throws exception -> 500, task still registered
    await runTest('Chatbox - dispatch exception returns 500 with task still registered', async () => {
        cleanup();
        const body = validChatboxBody();
        setDispatcher(() => { throw new Error('Dispatcher crashed'); });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 500);
            assertEqual(res.body.status, 'Registration succeeded, dispatch failed');
            assertEqual(res.body.execution_initiated, false);
            assert(res.body.error.includes('Dispatcher crashed'));

            const task = taskRegistry.getTask(res.body.request_id);
            assert(task !== null, 'Task should be registered even if dispatch threw');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 16: Malformed JSON -> 400
    await runTest('Chatbox - malformed JSON returns 400', async () => {
        cleanup();
        const res = await makeRawRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', ...chatboxAuth }
        }, '{invalid json}');
        assertEqual(res.status, 400);
        assertEqual(res.body.status, 'validation blocked');

        cleanup();
    });

    // Test 17: Missing env secret fails closed -> 401
    await runTest('Chatbox - missing env secret fails closed', async () => {
        const originalSecret = process.env.CHATBOX_GATEWAY_SECRET;
        delete process.env.CHATBOX_GATEWAY_SECRET;

        const body = validChatboxBody();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-chatbox-gateway-secret': 'test-chatbox-secret' }
        }, body);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        process.env.CHATBOX_GATEWAY_SECRET = originalSecret;
    });

    // Test 18: Chatbox secret is distinct from DeepSeek Coordinator secret
    await runTest('Chatbox - DeepSeek Coordinator secret does not authenticate Chatbox gateway', async () => {
        cleanup();
        const body = validChatboxBody();
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-chatbox-gateway-secret': 'test-deepseek-secret' }
        }, body);
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');

        assertEqual(taskRegistry.getAllTasks().length, 0, 'No task should be registered');

        cleanup();
    });

    // Test 19: Existing DeepSeek Coordinator route regression — still returns 401 without secret
    await runTest('Chatbox - existing /poc/coordinator route auth still works (401 without secret)', async () => {
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/coordinator', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { protocol_version: '0.1', request_id: 'test', source: 'test' });
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');
    });

    // Test 20: Existing /poc/kilo route regression
    await runTest('Chatbox - existing /poc/kilo route auth still works (401 without secret)', async () => {
        const res = await makeRequest({
            hostname: 'localhost', port: 3005, path: '/poc/kilo', method: 'POST'
        }, {});
        assertEqual(res.status, 401);
        assertEqual(res.body.status, 'authentication blocked');
    });

    // Test 21: Intent with multiple user messages — all concatenated and preserved
    await runTest('Chatbox - multiple user messages concatenated in task field', async () => {
        cleanup();
        const body = makeOpenAiRequest([
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'First intent sentence.' },
            { role: 'user', content: 'Second intent sentence.' }
        ], 'gpt-4');

        let dispatchedCommand = null;
        setDispatcher((cmd) => {
            dispatchedCommand = cmd;
            return { status: 'SUCCESS' };
        });

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 202);

            assert(dispatchedCommand !== null);
            assert(dispatchedCommand.task.includes('First intent sentence.'));
            assert(dispatchedCommand.task.includes('Second intent sentence.'));
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 22: Response does not expose secrets
    await runTest('Chatbox - response does not expose secrets in error output', async () => {
        cleanup();
        const body = validChatboxBody();
        setDispatcher(() => ({ status: 'FAILED', error: 'Transport error' }));

        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            const responseStr = JSON.stringify(res.body);
            assert(!responseStr.includes('test-chatbox-secret'), 'Secret must not appear in response');
            assert(!responseStr.includes(process.env.CHATBOX_GATEWAY_SECRET), 'Secret must not appear in response');
        } finally {
            setDispatcher(dispatch);
        }

        cleanup();
    });

    // Test 23: Provider identifiers persisted after successful dispatch with provider IDs
    await runTest('Chatbox - provider identifiers persisted in task after successful dispatch', async () => {
        cleanup();
        const body = validChatboxBody();
        setDispatcher(() => ({
            status: 'SUCCESS',
            provider_session_id: 'sess-abc',
            provider_message_id: 'msg-def',
            provider_invocation_id: 'inv-ghi'
        }));
        try {
            const res = await makeRequest({
                hostname: 'localhost', port: 3005, path: '/poc/chatbox', method: 'POST',
                headers: { 'Content-Type': 'application/json', ...chatboxAuth }
            }, body);
            assertEqual(res.status, 202);

            const task = taskRegistry.getTask(res.body.request_id);
            assertEqual(task.kilo.provider_session_id, 'sess-abc');
            assertEqual(task.kilo.provider_message_id, 'msg-def');
            assertEqual(task.kilo.provider_invocation_id, 'inv-ghi');
        } finally {
            setDispatcher(dispatch);
        }
        cleanup();
    });

    server.close();

    console.log(`\n=== Chatbox Gateway Tests: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) process.exit(1);
}

main().catch(console.error);
