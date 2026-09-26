const assert = require('assert');
const axios = require('axios');
const express = require('express');
const http = require('http');
const {
    CONTROL_PLANE_TOOL,
    buildControlPlaneCommand,
    validateGetTaskArguments,
    createDeepSeekRuntimeHandler,
    normalizeMessages,
    runDeepSeekConversation
} = require('../services/deepseek-runtime');
const taskRegistry = require('../poc/task-registry');

let passed = 0;
let failed = 0;

function env() {
    return {
        OPENROUTER_API_KEY: 'runtime-test-key',
        OPENROUTER_MODEL: 'deepseek/test',
        DEEPSEEK_COORDINATOR_SECRET: 'coordinator-test-secret',
        DEEPSEEK_COORDINATOR_URL: 'http://coordinator.test/poc/coordinator'
    };
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (error) {
        failed++;
        console.error(`FAIL: ${name} - ${error.message}`);
    }
}

function providerResponse(message) {
    return { data: { choices: [{ message }] } };
}

function coordinatorFailureClient(status, data) {
    let callCount = 0;
    return {
        post: async () => {
            callCount++;
            if (callCount === 1) {
                return providerResponse({ role: 'assistant', tool_calls: [{
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'x', target: 'Gemini Builder' }) }
                }] });
            }
            const error = new Error('sensitive coordinator detail');
            error.response = { status, data };
            throw error;
        }
    };
}

function request(port, headers, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/poc/deepseek-runtime', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(response) }));
        });
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}

(async () => {
    await test('normal OpenRouter response is returned without a coordinator call', async () => {
        let calls = 0;
        const result = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'hello' }], env: env(),
            httpClient: { post: async () => { calls++; return providerResponse({ role: 'assistant', content: 'hello back' }); } }
        });
        assert.equal(result.message.content, 'hello back');
        assert.equal(calls, 1);
    });

    await test('tool call is translated into server-controlled ACP and submitted to coordinator', async () => {
        const calls = [];
        const client = { post: async (url, body, options) => {
            calls.push({ url, body, options });
            if (calls.length === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Review coordinator behavior', target: 'Gemini Builder' }) } }] });
            if (calls.length === 2) return { data: { status: 'Task registered and dispatched', request_id: body.request_id } };
            return providerResponse({ role: 'assistant', content: 'Review requested.' });
        } };
        const result = await runDeepSeekConversation({ messages: [{ role: 'user', content: 'review it' }], env: env(), httpClient: client });
        assert.equal(result.message.content, 'Review requested.');
        assert.equal(calls.length, 3);
        const command = calls[1].body;
        assert.equal(calls[1].url, env().DEEPSEEK_COORDINATOR_URL);
        assert.equal(calls[1].options.headers['x-deepseek-coordinator-secret'], env().DEEPSEEK_COORDINATOR_SECRET);
        assert.equal(command.repository, 'fluentwithkyle/openclaw-webhook');
        assert.equal(command.base_branch, 'main');
        assert.deepEqual(command.authorization.capabilities, ['read_only']);
        assert.deepEqual(command.constraints.permitted_paths, ['poc/']);
        assert.equal(command.target, 'Gemini Builder');
        assert.equal(command.task_mode, 'REVIEW');
    });

    await test('tool contract exposes only intent-level fields', async () => {
        const properties = CONTROL_PLANE_TOOL.function.parameters.properties;
        for (const forbidden of ['capabilities', 'permitted_paths', 'authorization', 'repository', 'base_branch']) assert.equal(properties[forbidden], undefined);
    });

    await test('arbitrary authority fields are rejected instead of influencing ACP', async () => {
        assert.throws(() => buildControlPlaneCommand({ operation: 'request_task', objective: 'x', target: 'Gemini Builder', capabilities: ['push'] }), /not permitted/);
    });

    await test('unsupported target and operation fail closed', async () => {
        assert.throws(() => buildControlPlaneCommand({ operation: 'request_task', objective: 'x', target: 'Kilo' }), /not permitted/);
        assert.throws(() => buildControlPlaneCommand({ operation: 'execute', objective: 'x', target: 'Gemini Builder' }), /not permitted/);
    });

    await test('malformed tool arguments fail closed', async () => {
        const client = { post: async () => providerResponse({ role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: '{bad json' } }] }) };
        await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: env(), httpClient: client }), error => error.code === 'INVALID_TOOL_ARGUMENTS');
    });

    await test('unexpected tools and malformed model responses fail closed', async () => {
        const badTool = { post: async () => providerResponse({ role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'http_post', arguments: '{}' } }] }) };
        await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: env(), httpClient: badTool }), error => error.code === 'UNEXPECTED_TOOL_CALL');
        const malformed = { post: async () => ({ data: {} }) };
        await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: env(), httpClient: malformed }), error => error.code === 'MALFORMED_MODEL_RESPONSE');
    });

    await test('provider failures and timeouts are sanitized', async () => {
        const failure = { post: async () => { throw new Error('runtime-test-key must not leak'); } };
        await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: env(), httpClient: failure }), error => error.code === 'OPENROUTER_FAILED' && !error.message.includes('runtime-test-key'));
        const timeout = { post: async () => { const error = new Error('timeout'); error.code = 'ECONNABORTED'; throw error; } };
        await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: env(), httpClient: timeout }), error => error.code === 'OPENROUTER_TIMEOUT');
    });

    await test('coordinator authentication, validation, and dispatch failures are explicit', async () => {
        for (const [status, code] of [[401, 'COORDINATOR_AUTHENTICATION_FAILED'], [400, 'COORDINATOR_VALIDATION_REJECTED'], [403, 'COORDINATOR_DISPATCH_BLOCKED'], [500, 'COORDINATOR_DISPATCH_FAILED']]) {
            const client = coordinatorFailureClient(status);
            await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: env(), httpClient: client }), error => error.code === code && !error.message.includes('sensitive') && error.diagnostics === undefined);
        }
    });

    await test('coordinator dispatch diagnostics are preserved and safely exposed', async () => {
        const diagnostics = {
            stage: 'dispatch',
            category: 'builder_workflow_dispatch_failed',
            status_code: 500,
            workflow: 'gemini-builder.yml',
            repository: 'fluentwithkyle/openclaw-webhook',
            authorization: 'Bearer should-not-leak',
            api_key: 'should-not-leak'
        };
        const coordinatorData = {
            error: 'Builder workflow dispatch failed',
            diagnostics,
            authorization: 'Bearer should-not-leak',
            api_key: 'should-not-leak'
        };
        const input = { messages: [{ role: 'user', content: 'x' }] };
        await assert.rejects(
            () => runDeepSeekConversation({ ...input, env: env(), httpClient: coordinatorFailureClient(500, coordinatorData) }),
            error => {
                assert.equal(error.status, 502);
                assert.equal(error.code, 'COORDINATOR_DISPATCH_FAILED');
                assert.deepEqual(error.diagnostics, {
                    stage: 'dispatch',
                    category: 'builder_workflow_dispatch_failed',
                    status_code: 500,
                    workflow: 'gemini-builder.yml',
                    repository: 'fluentwithkyle/openclaw-webhook'
                });
                return true;
            }
        );

        const response = {};
        const handler = createDeepSeekRuntimeHandler({ env: env(), httpClient: coordinatorFailureClient(500, coordinatorData) });
        await handler({ body: input }, {
            status: code => { response.status = code; return { json: body => { response.body = body; } }; }
        });
        assert.equal(response.status, 502);
        assert.equal(response.body.code, 'COORDINATOR_DISPATCH_FAILED');
        assert.deepEqual(response.body.diagnostics, {
            stage: 'dispatch',
            category: 'builder_workflow_dispatch_failed',
            status_code: 500,
            workflow: 'gemini-builder.yml',
            repository: 'fluentwithkyle/openclaw-webhook'
        });
        assert.deepEqual(Object.keys(response.body.diagnostics).sort(), ['category', 'repository', 'stage', 'status_code', 'workflow']);
        assert.equal(JSON.stringify(response.body).includes('should-not-leak'), false);
    });

    await test('missing credentials fail closed', async () => {
        await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'x' }], env: {}, httpClient: { post: async () => null } }), error => error.code === 'RUNTIME_NOT_CONFIGURED');
    });

    await test('assistant message with null content (tool-call history) reaches OpenRouter normalized', async () => {
        const calls = [];
        const client = { post: async (url, body) => {
            calls.push({ url, body });
            return providerResponse({ role: 'assistant', content: 'Done.' });
        } };
        const conversation = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: null }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(result.message.content, 'Done.');
        const sentMessages = calls[0].body.messages;
        assert.equal(sentMessages[0].role, 'user');
        assert.equal(sentMessages[1].role, 'assistant');
        assert.equal(sentMessages[1].content, '');
    });

    await test('tool result message with string content is preserved in conversation history', async () => {
        const calls = [];
        const client = { post: async (url, body) => {
            calls.push({ url, body });
            return providerResponse({ role: 'assistant', content: 'Acknowledged.' });
        } };
        const conversation = [
            { role: 'user', content: 'Check the calendar' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Check calendar', target: 'Gemini Builder' }) } }] },
            { role: 'tool', tool_call_id: 'call-1', content: '[{"status":"completed","coordinator":{"request_id":"test-1"}}]' }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(result.message.content, 'Acknowledged.');
        const sentMessages = calls[0].body.messages;
        assert.equal(sentMessages[0].role, 'user');
        assert.equal(sentMessages[1].role, 'assistant');
        assert.equal(sentMessages[1].content, '');
        assert.equal(sentMessages[2].role, 'tool');
        assert.equal(sentMessages[2].tool_call_id, 'call-1');
        assert.equal(typeof sentMessages[2].content, 'string');
    });

    await test('structured content parts (array) are normalized to string', async () => {
        const calls = [];
        const client = { post: async (url, body) => {
            calls.push({ url, body });
            return providerResponse({ role: 'assistant', content: 'OK' });
        } };
        const conversation = [
            { role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' World' }] }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(result.message.content, 'OK');
        assert.equal(calls[0].body.messages[0].content, 'Hello World');
    });

    await test('system message and multiple message roles are accepted', async () => {
        const calls = [];
        const client = { post: async (url, body) => {
            calls.push({ url, body });
            return providerResponse({ role: 'assistant', content: 'Understood.' });
        } };
        const conversation = [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is 2+2?' }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(result.message.content, 'Understood.');
        assert.equal(calls[0].body.messages[0].role, 'system');
        assert.equal(calls[0].body.messages[0].content, 'You are a helpful assistant.');
    });

    await test('malformed messages still fail closed with INVALID_MESSAGES', async () => {
        const invalidCases = [
            { messages: [] },
            { messages: [{ role: 'user' }] },
            { messages: [{ role: 'user', content: null }] },
            { messages: [{ role: 'user', content: 123 }] },
            { messages: [{ role: 'unknown', content: 'x' }] },
            { messages: [{ role: 'tool', content: 'x' }] },
            { messages: 'not an array' },
            { messages: null },
            { messages: [{ role: 'user', content: { nested: true } }] },
        ];
        for (const testCase of invalidCases) {
            await assert.rejects(
                async () => normalizeMessages(testCase.messages),
                error => error.code === 'INVALID_MESSAGES'
            );
        }
    });

    await test('normalizeMessages normalises null and structured content while preserving roles', async () => {
        const assistantNull = normalizeMessages([{ role: 'assistant', content: null }]);
        assert.equal(assistantNull[0].content, '');

        const structured = normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);
        assert.equal(structured[0].content, 'Hello');

        const toolResult = normalizeMessages([{ role: 'tool', tool_call_id: 'call-1', content: 'result' }]);
        assert.equal(toolResult[0].content, 'result');
        assert.equal(toolResult[0].role, 'tool');
        assert.equal(toolResult[0].tool_call_id, 'call-1');
    });

    await test('normalizeMessages rejects malformed messages with INVALID_MESSAGES', async () => {
        const invalidCases = [
            [{ role: 'user', content: 123 }],
            [{ role: 'user', content: { nested: true } }],
            [{ role: 'unknown', content: 'x' }],
            [{ role: '' }],
            [{ role: 123 }],
            [{ content: 'x' }],
            [{ role: 'tool', content: 'x' }],
        ];
         for (const messages of invalidCases) {
            await assert.rejects(
                async () => normalizeMessages(messages),
                error => error.code === 'INVALID_MESSAGES'
            );
        }
    });

    await test('invalid function role fails closed and is not accepted as a valid role', async () => {
        await assert.rejects(
            async () => normalizeMessages([{ role: 'function', content: 'x', name: 'foo' }]),
            error => error.code === 'INVALID_MESSAGES'
        );
    });

    await test('structured content array with a missing text part fails closed with INVALID_MESSAGES', async () => {
        await assert.rejects(
            async () => normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'image_url', image_url: { url: 'data:...' } }] }]),
            error => error.code === 'INVALID_MESSAGES'
        );
    });

    await test('structured content array with a malformed part fails closed with INVALID_MESSAGES', async () => {
        await assert.rejects(
            async () => normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text' }] }]),
            error => error.code === 'INVALID_MESSAGES'
        );
    });

    await test('structured content array with a non-object part fails closed with INVALID_MESSAGES', async () => {
        await assert.rejects(
            async () => normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'Hello' }, 'bad-part'] }]),
            error => error.code === 'INVALID_MESSAGES'
        );
    });

    await test('otherwise unusable (empty) structured content array fails closed with INVALID_MESSAGES', async () => {
        await assert.rejects(
            async () => normalizeMessages([{ role: 'user', content: [] }]),
            error => error.code === 'INVALID_MESSAGES'
        );
    });

    await test('valid structured content parts continue to normalize correctly', async () => {
        const structured = normalizeMessages([{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' World' }] }]);
        assert.equal(structured[0].content, 'Hello World');
    });

    await test('runtime route accepts custom-header and Bearer gateway authentication while rejecting missing or invalid credentials', async () => {
        process.env.CHATBOX_GATEWAY_SECRET = 'gateway-test-secret';
        process.env.OPENROUTER_API_KEY = 'route-test-key';
        process.env.OPENROUTER_MODEL = 'deepseek/test';
        process.env.DEEPSEEK_COORDINATOR_SECRET = 'route-coordinator-secret';
        const { router } = require('../routes/poc');
        const app = express();
        app.use(express.json());
        app.use('/poc', router);
        const server = await new Promise(resolve => {
            const instance = app.listen(3011, () => resolve(instance));
        });
        const originalPost = axios.post;
        axios.post = async () => providerResponse({ role: 'assistant', content: 'authenticated response' });
        try {
            const body = { messages: [{ role: 'user', content: 'hello' }] };
            assert.equal((await request(3011, {}, body)).status, 401);
            assert.equal((await request(3011, { 'x-chatbox-gateway-secret': 'invalid' }, body)).status, 401);
            assert.equal((await request(3011, { authorization: 'Bearer wrong-secret' }, body)).status, 401);
            const valid = await request(3011, { 'x-chatbox-gateway-secret': 'gateway-test-secret' }, body);
            assert.equal(valid.status, 200);
            assert.equal(valid.body.choices[0].message.content, 'authenticated response');
            assert.equal(JSON.stringify(valid.body).includes('route-test-key'), false);
            const bearer = await request(3011, { authorization: 'Bearer gateway-test-secret' }, body);
            assert.equal(bearer.status, 200);
            assert.equal(bearer.body.choices[0].message.content, 'authenticated response');
        } finally {
            axios.post = originalPost;
            await new Promise(resolve => server.close(resolve));
        }
    });

    await test('control_plane tool exposes get_task operation and request_id parameter', async () => {
        const operationEnum = CONTROL_PLANE_TOOL.function.parameters.properties.operation.enum;
        assert(operationEnum.includes('get_task'));
        assert(CONTROL_PLANE_TOOL.function.parameters.properties.request_id);
    });

    await test('validateGetTaskArguments validates get_task args and rejects invalid ones', async () => {
        const valid = validateGetTaskArguments({ operation: 'get_task', request_id: 'deepseek-runtime-123' });
        assert.equal(valid.operation, 'get_task');
        assert.equal(valid.request_id, 'deepseek-runtime-123');

        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: 'task-123' }), /not permitted/);
        assert.throws(() => validateGetTaskArguments({ operation: 'get_task' }), /not permitted/);
        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: '' }), /not permitted/);
        assert.throws(() => validateGetTaskArguments({ operation: 'request_task', request_id: 'deepseek-runtime-123' }), /not permitted/);
    });

    await test('get_task operation queries taskRegistry server-side and returns not_found when absent', async () => {
        let coordinatorCalled = false;
        const client = {
            post: async (url) => {
                if (url === env().DEEPSEEK_COORDINATOR_URL) {
                    coordinatorCalled = true;
                }
                return providerResponse({ role: 'assistant', content: 'done' });
            }
        };
        const conversation = [
            { role: 'user', content: 'Check task status' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'get_task', request_id: 'non-existent-task' }) } }] }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(coordinatorCalled, false);
        assert.equal(result.message.content, 'done');
    });

    await test('get_task operation retrieves task metadata and status when task exists in taskRegistry', async () => {
        const requestId = 'deepseek-runtime-test-1';
        taskRegistry.createTask({
            request_id: requestId,
            source: 'DeepSeek',
            target: 'Gemini Builder',
            task: 'Test task',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task_mode: 'REVIEW',
            constraints: { permitted_paths: ['poc/'] },
            authorization: { capabilities: ['read_only'] },
            verification: 'verify'
        });

        let coordinatorCalled = false;
        const client = {
            post: async (url) => {
                if (url === env().DEEPSEEK_COORDINATOR_URL) {
                    coordinatorCalled = true;
                }
                return providerResponse({ role: 'assistant', content: 'task status received' });
            }
        };
        const conversation = [
            { role: 'user', content: 'Check task' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'get_task', request_id: requestId }) } }] }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(coordinatorCalled, false);
        assert.equal(result.message.content, 'task status received');
    });

    await test('multi-turn conversation executes request_task then get_task', async () => {
        let dispatchedRequestId = null;
        let openRouterCallCount = 0;
        const client = {
            post: async (url, body) => {
                if (url === env().DEEPSEEK_COORDINATOR_URL) {
                    dispatchedRequestId = body.request_id;
                    return { data: { status: 'Task registered and dispatched', request_id: body.request_id } };
                }
                openRouterCallCount++;
                if (openRouterCallCount === 1) {
                    return providerResponse({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call-1',
                            type: 'function',
                            function: {
                                name: 'control_plane',
                                arguments: JSON.stringify({ operation: 'request_task', objective: 'Inspect code', target: 'Gemini Builder' })
                            }
                        }]
                    });
                } else if (openRouterCallCount === 2) {
                    return providerResponse({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call-2',
                            type: 'function',
                            function: {
                                name: 'control_plane',
                                arguments: JSON.stringify({ operation: 'get_task', request_id: dispatchedRequestId })
                            }
                        }]
                    });
                } else {
                    return providerResponse({ role: 'assistant', content: 'Task inspection completed.' });
                }
            }
        };

        const result = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Run and check task' }],
            env: env(),
            httpClient: client
        });
        assert.equal(result.message.content, 'Task inspection completed.');
        assert.equal(result.iterations, 2);
    });

    await test('validateGetTaskArguments enforces deepseek-runtime-* namespace enforcement', async () => {
        const valid = validateGetTaskArguments({ operation: 'get_task', request_id: 'deepseek-runtime-12345' });
        assert.equal(valid.request_id, 'deepseek-runtime-12345');

        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: 'task-123' }), /not permitted/);
        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: 'kilo-runtime-123' }), /not permitted/);
        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: 'random-id' }), /not permitted/);
    });

    await test('get_task operation returns allowlisted sanitized projection excluding secrets and internal fields', async () => {
        const requestId = 'deepseek-runtime-sec-test-1';
        taskRegistry.createTask({
            request_id: requestId,
            source: 'DeepSeek',
            target: 'Gemini Builder',
            task: 'Security test task',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task_mode: 'REVIEW',
            constraints: { permitted_paths: ['poc/'] },
            authorization: { capabilities: ['read_only'] },
            verification: 'verify'
        });

        taskRegistry.updateAgentResult(requestId, 'Gemini', {
            status: 'success',
            execution_id: 'gemini-exec-1',
            report: {
                summary: 'Completed successfully with token secret-token-value and apiKey secret-api-key',
                apiKey: 'super-secret-key',
                authorization: 'Bearer secret-bearer-token',
                nested: {
                    secret_password: 'bad-password'
                }
            }
        });

        let toolContent = null;
        let openRouterCalls = 0;
        const client = {
            post: async (url, body) => {
                if (url === env().DEEPSEEK_COORDINATOR_URL) {
                    return { data: { status: 'dispatched' } };
                }
                openRouterCalls++;
                if (openRouterCalls === 1) {
                    return providerResponse({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call-1',
                            type: 'function',
                            function: {
                                name: 'control_plane',
                                arguments: JSON.stringify({ operation: 'get_task', request_id: requestId })
                            }
                        }]
                    });
                }
                const messages = body.messages;
                const toolMsg = messages.find(m => m.role === 'tool');
                if (toolMsg) toolContent = JSON.parse(toolMsg.content);
                return providerResponse({ role: 'assistant', content: 'Inspected.' });
            }
        };

        await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'check security projection' }],
            env: env(),
            httpClient: client
        });

        assert(toolContent);
        assert.equal(toolContent.status, 'found');
        const projectedTask = toolContent.task;

        assert.equal(projectedTask.request_id, requestId);
        assert.equal(projectedTask.status, 'PENDING');
        assert.equal(projectedTask.task, 'Security test task');
        assert.equal(projectedTask.task_mode, 'REVIEW');
        assert.equal(projectedTask.current_agent, null);
        assert.equal(projectedTask.next_agent, null);
        assert.equal(projectedTask.next_action, null);
        assert(projectedTask.created_at);
        assert(projectedTask.updated_at);
        assert(projectedTask.gemini);
        assert.equal(projectedTask.gemini.status, 'success');
        assert.equal(projectedTask.gemini.execution_id, 'gemini-exec-1');

        const report = projectedTask.gemini.report;
        assert.equal(report.apiKey, undefined);
        assert.equal(report.authorization, undefined);
        assert.equal(report.nested, null);

        assert.equal(projectedTask.kilo, undefined);
        assert.equal(projectedTask.constraints, undefined);
        assert.equal(projectedTask.authorization, undefined);
        assert.equal(projectedTask.verification, undefined);
        assert.equal(projectedTask.lineage, undefined);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
