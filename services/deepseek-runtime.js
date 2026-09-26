const axios = require('axios');

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOOL_ITERATIONS = 2;
const CONTROL_PLANE_TOOL = {
    type: 'function',
    function: {
        name: 'control_plane',
        description: 'Request a bounded read-only repository review through the trusted control plane.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['operation', 'objective', 'target'],
            properties: {
                operation: { type: 'string', enum: ['request_task'] },
                objective: { type: 'string', minLength: 1, maxLength: 2000 },
                target: { type: 'string', enum: ['Gemini Builder'] }
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

function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new RuntimeError(400, 'INVALID_MESSAGES', 'messages must be a non-empty array');
    }
    for (const message of messages) {
        if (!message || typeof message !== 'object' || typeof message.role !== 'string' || typeof message.content !== 'string') {
            throw new RuntimeError(400, 'INVALID_MESSAGES', 'each message must include string role and content fields');
        }
    }
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
    validateMessages(messages);
    const config = getRuntimeConfig(env);
    const conversation = messages.map(message => ({ ...message }));

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
        const command = buildControlPlaneCommand(parseToolArguments(toolCall));
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

        conversation.push(message);
        conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ status: 'completed', coordinator: coordinatorResponse.data })
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
    createDeepSeekRuntimeHandler,
    getRuntimeConfig,
    runDeepSeekConversation
};
