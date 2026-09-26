const axios = require('axios');
const taskRegistry = require('../poc/task-registry');

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOOL_ITERATIONS = 2;
const CONTROL_PLANE_TOOL = {
    type: 'function',
    function: {
        name: 'control_plane',
        description: 'Request a bounded read-only repository review or query task status through the trusted control plane.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['operation'],
            properties: {
                operation: { type: 'string', enum: ['request_task', 'get_task'] },
                objective: { type: 'string', minLength: 1, maxLength: 2000 },
                target: { type: 'string', enum: ['Gemini Builder'] },
                request_id: { type: 'string', minLength: 1, maxLength: 100 }
            }
        }
    }
};

class RuntimeError extends Error {
    constructor(status, code, message, diagnostics) {
        super(message);
        this.status = status;
        this.code = code;
        if (diagnostics) this.diagnostics = diagnostics;
    }
}

function getRuntimeConfig(env = process.env) {
    if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_MODEL || !env.DEEPSEEK_COORDINATOR_SECRET) {
        throw new RuntimeError(503, 'RUNTIME_NOT_CONFIGURED', 'DeepSeek runtime is not configured');
    }

    return {
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL,
        coordinatorSecret: env.DEEPSEEK_COORDINATOR_SECRET,
        openRouterUrl: env.OPENROUTER_API_URL || OPENROUTER_CHAT_COMPLETIONS_URL,
        coordinatorUrl: env.DEEPSEEK_COORDINATOR_URL || `http://127.0.0.1:${env.PORT || 3000}/poc/coordinator`,
        timeout: Number(env.DEEPSEEK_RUNTIME_TIMEOUT_MS) || 15000
    };
}

const VALID_ROLES = ['system', 'user', 'assistant', 'tool'];

function normalizeContent(content, role) {
    if (content === null) {
        if (role !== 'assistant') {
            throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
        }
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        if (content.length === 0) {
            throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
        }
        return content
            .map(part => {
                if (!part || typeof part !== 'object' || Array.isArray(part) || typeof part.text !== 'string') {
                    throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
                }
                return part.text;
            })
            .join('');
    }
    throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
}

function normalizeMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
    }
    if (typeof message.role !== 'string' || !VALID_ROLES.includes(message.role)) {
        throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include a valid string role field');
    }
    if (!('content' in message)) {
        throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
    }

    const normalized = { role: message.role };

    if (message.role === 'tool') {
        if (typeof message.tool_call_id !== 'string' || message.tool_call_id.trim() === '') {
            throw new RuntimeError(400, 'INVALID_MESSAGES', 'tool messages must include a string tool_call_id field');
        }
        normalized.tool_call_id = message.tool_call_id;
    }

    normalized.content = normalizeContent(message.content, message.role);

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        normalized.tool_calls = message.tool_calls;
    }

    return normalized;
}

function normalizeMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new RuntimeError(400, 'INVALID_MESSAGES', 'messages must be a non-empty array');
    }
    return messages.map(normalizeMessage);
}

function buildControlPlaneCommand(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments must be an object');
    }
    if (Object.keys(args).length !== 3 || args.operation !== 'request_task' || args.target !== 'Gemini Builder' ||
        typeof args.objective !== 'string' || args.objective.trim().length === 0 || args.objective.length > 2000) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments are not permitted by the runtime policy');
    }

    return {
        protocol_version: '0.1',
        request_id: `deepseek-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        source: 'DeepSeek Runtime',
        target: 'Gemini Builder',
        task_type: 'model-mediated-review',
        repository: 'fluentwithkyle/openclaw-webhook',
        base_branch: 'main',
        task: args.objective.trim(),
        task_mode: 'REVIEW',
        constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only'] },
        verification: 'Review the bounded poc/ scope and return structured findings.',
        reporting: 'structured-json',
        originator: 'Kyle'
    };
}

function validateGetTaskArguments(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments must be an object');
    }
    if (Object.keys(args).length !== 2 || args.operation !== 'get_task' || typeof args.request_id !== 'string' || args.request_id.trim().length === 0 || args.request_id.length > 100) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments for get_task are not permitted by the runtime policy');
    }

    return {
        operation: 'get_task',
        request_id: args.request_id.trim()
    };
}

function parseToolArguments(toolCall) {
    if (!toolCall || toolCall.type !== 'function' || !toolCall.function || toolCall.function.name !== 'control_plane') {
        throw new RuntimeError(400, 'UNEXPECTED_TOOL_CALL', 'Only the control_plane tool is permitted');
    }
    try {
        return JSON.parse(toolCall.function.arguments);
    } catch (error) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments must be valid JSON');
    }
}

function getCoordinatorDiagnostics(error) {
    const diagnostics = error && error.response && error.response.data && error.response.data.diagnostics;
    if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return undefined;

    const safeDiagnostics = {};
    if (typeof diagnostics.stage === 'string') safeDiagnostics.stage = diagnostics.stage;
    if (typeof diagnostics.category === 'string') safeDiagnostics.category = diagnostics.category;
    if (typeof diagnostics.status_code === 'number') safeDiagnostics.status_code = diagnostics.status_code;
    if (typeof diagnostics.workflow === 'string') safeDiagnostics.workflow = diagnostics.workflow;
    if (typeof diagnostics.repository === 'string') safeDiagnostics.repository = diagnostics.repository;
    return Object.keys(safeDiagnostics).length > 0 ? safeDiagnostics : undefined;
}

function normalizeProviderError(error, operation) {
    if (error instanceof RuntimeError) return error;
    if (error.code === 'ECONNABORTED') {
        return new RuntimeError(504, `${operation}_TIMEOUT`, `${operation} timed out`);
    }
    if (operation === 'COORDINATOR' && error.response) {
        if (error.response.status === 401) return new RuntimeError(502, 'COORDINATOR_AUTHENTICATION_FAILED', 'Coordinator authentication failed');
        if (error.response.status === 400) return new RuntimeError(502, 'COORDINATOR_VALIDATION_REJECTED', 'Coordinator rejected the ACP command');
        if (error.response.status === 403) return new RuntimeError(502, 'COORDINATOR_DISPATCH_BLOCKED', 'Coordinator blocked dispatch');
        if (error.response.status >= 500) return new RuntimeError(502, 'COORDINATOR_DISPATCH_FAILED', 'Coordinator dispatch failed', getCoordinatorDiagnostics(error));
    }
    return new RuntimeError(502, `${operation}_FAILED`, `${operation} request failed`);
}

async function runDeepSeekConversation({ messages, env, httpClient = axios }) {
    const conversation = normalizeMessages(messages);
    const config = getRuntimeConfig(env);

    for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
        let providerResponse;
        try {
            providerResponse = await httpClient.post(config.openRouterUrl, {
                model: config.model,
                messages: conversation,
                tools: [CONTROL_PLANE_TOOL],
                tool_choice: 'auto'
            }, {
                timeout: config.timeout,
                headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }
            });
        } catch (error) {
            throw normalizeProviderError(error, 'OPENROUTER');
        }

        const message = providerResponse.data && providerResponse.data.choices && providerResponse.data.choices[0] && providerResponse.data.choices[0].message;
        if (!message || typeof message !== 'object') {
            throw new RuntimeError(502, 'MALFORMED_MODEL_RESPONSE', 'OpenRouter returned an invalid model response');
        }

        const toolCalls = message.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            if (typeof message.content !== 'string') {
                throw new RuntimeError(502, 'MALFORMED_MODEL_RESPONSE', 'OpenRouter returned a response without assistant content');
            }
            return { message, iterations: iteration };
        }
        if (!Array.isArray(toolCalls) || toolCalls.length !== 1 || iteration === MAX_TOOL_ITERATIONS) {
            throw new RuntimeError(400, 'TOOL_LOOP_BLOCKED', 'The model requested an unsupported number of tool calls');
        }

        const toolCall = toolCalls[0];
        const args = parseToolArguments(toolCall);
        let toolResultContent;

        if (args.operation === 'request_task') {
            const command = buildControlPlaneCommand(args);
            let coordinatorResponse;
            try {
                coordinatorResponse = await httpClient.post(config.coordinatorUrl, command, {
                    timeout: config.timeout,
                    headers: {
                        'x-deepseek-coordinator-secret': config.coordinatorSecret,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (error) {
                throw normalizeProviderError(error, 'COORDINATOR');
            }
            toolResultContent = JSON.stringify({ status: 'completed', coordinator: coordinatorResponse.data });
        } else if (args.operation === 'get_task') {
            const validatedArgs = validateGetTaskArguments(args);
            const task = taskRegistry.getTask(validatedArgs.request_id);
            if (!task) {
                toolResultContent = JSON.stringify({ status: 'not_found', request_id: validatedArgs.request_id });
            } else {
                toolResultContent = JSON.stringify({
                    status: 'found',
                    task: {
                        request_id: task.request_id,
                        status: task.status,
                        current_agent: task.current_agent,
                        next_agent: task.next_agent,
                        task: task.task,
                        kilo: task.kilo,
                        gemini: task.gemini,
                        next_action: task.next_action,
                        verification: task.verification,
                        created_at: task.created_at,
                        updated_at: task.updated_at
                    }
                });
            }
        } else {
            throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'Unsupported control_plane operation');
        }

        conversation.push(message);
        conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent
        });
    }

    throw new RuntimeError(400, 'TOOL_LOOP_BLOCKED', 'The model exceeded the tool-call limit');
}

function createDeepSeekRuntimeHandler(options = {}) {
    return async (req, res) => {
        try {
            const result = await runDeepSeekConversation({
                messages: req.body && req.body.messages,
                env: options.env || process.env,
                httpClient: options.httpClient || axios
            });
            return res.status(200).json({
                choices: [{ message: result.message }],
                tool_iterations: result.iterations
            });
        } catch (error) {
            const runtimeError = normalizeProviderError(error, 'RUNTIME');
            const response = {
                status: 'runtime failed',
                stage: 'deepseek-runtime',
                error: runtimeError.message,
                code: runtimeError.code
            };
            if (runtimeError.diagnostics) response.diagnostics = runtimeError.diagnostics;
            return res.status(runtimeError.status).json(response);
        }
    };
}

module.exports = {
    CONTROL_PLANE_TOOL,
    MAX_TOOL_ITERATIONS,
    RuntimeError,
    buildControlPlaneCommand,
    validateGetTaskArguments,
    createDeepSeekRuntimeHandler,
    getRuntimeConfig,
    normalizeMessages,
    normalizeMessage,
    runDeepSeekConversation
};
