const axios = require('axios');
const taskRegistry = require('../poc/task-registry');

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOOL_ITERATIONS = 2;
const DEEPSEEK_COORDINATOR_POLICY = Object.freeze({
    phase: 'Phase 2 bounded lineage',
    model_operations: Object.freeze(['request_task', 'get_task']),
    request_task: Object.freeze({ model_fields: Object.freeze(['operation', 'objective', 'parent_request_id']), target: 'Gemini Builder' }),
    get_task: Object.freeze({ model_fields: Object.freeze(['operation', 'request_id']), request_id_prefix: 'deepseek-runtime-' }),
    server_derived_authority: Object.freeze({
        repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', target: 'Gemini Builder',
        task_mode: 'REVIEW', capabilities: Object.freeze(['read_only']), permitted_paths: Object.freeze(['poc/']),
        originator: 'Kyle', authentication_context: 'server-held coordinator secret', verification: 'Review the bounded poc/ scope and return structured findings.'
    }),
    observation_projection: Object.freeze(['identity', 'lifecycle', 'lineage', 'agents', 'next_action', 'execution', 'evidence_summary', 'verification', 'failure', 'blocked']),
    state_semantics: Object.freeze({
        agent_report: 'execution evidence only',
        independent_verification: 'required by the ACP lifecycle before VERIFIED or COMPLETE',
        verified_outcome: 'only ACP lifecycle status VERIFIED or COMPLETE'
    }),
    authorization_boundary: Object.freeze({
        authority: 'ACP and Kyle',
        excluded_capabilities: Object.freeze(['modify_files', 'commit', 'push', 'run_tests', 'FAILOVER_EXECUTE', 'BUILDER'])
    }),
    extensions: Object.freeze({ later_phases_require_acp_policy_change: true })
});
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
                parent_request_id: { type: 'string', minLength: 1, maxLength: 100 },
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
    const hasParentRequestId = Object.prototype.hasOwnProperty.call(args, 'parent_request_id');
    if (Object.keys(args).length !== (hasParentRequestId ? 3 : 2) || args.operation !== 'request_task' ||
        typeof args.objective !== 'string' || args.objective.trim().length === 0 || args.objective.length > 2000 ||
        (hasParentRequestId && (typeof args.parent_request_id !== 'string' || args.parent_request_id.trim().length === 0 ||
            args.parent_request_id.length > 100 || args.parent_request_id !== args.parent_request_id.trim() ||
            !args.parent_request_id.startsWith('deepseek-runtime-')))) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments are not permitted by the runtime policy');
    }

    const command = {
        protocol_version: '0.1',
        request_id: `deepseek-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        source: 'DeepSeek Runtime',
        target: 'Gemini Builder',
        task_type: 'model-mediated-review',
        repository: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.repository,
        base_branch: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.base_branch,
        task: args.objective.trim(),
        task_mode: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.task_mode,
        constraints: { permitted_paths: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.permitted_paths.slice() },
        authorization: { capabilities: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.capabilities.slice() },
        verification: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.verification,
        reporting: 'structured-json',
        originator: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.originator
    };
    if (hasParentRequestId) command.parent_request_id = args.parent_request_id;
    return command;
}

function validateGetTaskArguments(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments must be an object');
    }
    if (Object.keys(args).length !== 2 || args.operation !== 'get_task' || typeof args.request_id !== 'string' || args.request_id.trim().length === 0 || args.request_id.length > 100) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments for get_task are not permitted by the runtime policy');
    }
    const requestId = args.request_id.trim();
    if (args.request_id !== requestId || !requestId.startsWith('deepseek-runtime-')) {
        throw new RuntimeError(400, 'INVALID_TOOL_ARGUMENTS', 'control_plane arguments for get_task are not permitted by the runtime policy');
    }

    return {
        operation: 'get_task',
        request_id: requestId
    };
}

function sanitizeReport(report) {
    if (!report || typeof report !== 'object') return report || null;
    if (Array.isArray(report)) return report.map(sanitizeReport);

    const sanitized = {};
    for (const [key, value] of Object.entries(report)) {
        const lowerKey = key.toLowerCase();
        if (
            lowerKey.includes('key') ||
            lowerKey.includes('secret') ||
            lowerKey.includes('token') ||
            lowerKey.includes('credential') ||
            lowerKey.includes('authorization') ||
            lowerKey.includes('password')
        ) {
            continue;
        }
        if (value && typeof value === 'object') {
            sanitized[key] = sanitizeReport(value);
        } else if (typeof value === 'string') {
            sanitized[key] = sanitizeStringValue(value);
        } else {
            sanitized[key] = value;
        }
    }
    return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeStringValue(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
        .replace(/api[_-]?key[=:]\s*[A-Za-z0-9_\-\.]+/gi, 'api_key=REDACTED');
}

function projectAgentExecution(agent) {
    if (!agent) return null;
    return {
        status: agent.status || null,
        execution_id: agent.execution_id || null,
        result: sanitizeReport(agent.report)
    };
}

function projectTaskForDeepSeek(task) {
    const evidence = Array.isArray(task.evidence) ? task.evidence : [];
    const independentVerification = evidence.filter(record => record && record.evidence_type === 'INDEPENDENT_VERIFICATION')
        .map(record => sanitizeReport({ agent: record.agent, timestamp: record.timestamp, execution_id: record.execution_id, report: record.report }));
    const evidenceCategories = evidence.reduce((categories, record) => {
        if (record && typeof record.evidence_type === 'string') {
            categories[record.evidence_type] = (categories[record.evidence_type] || 0) + 1;
        }
        return categories;
    }, {});
    const agentExecutions = {
        kilo: projectAgentExecution(task.kilo),
        builder: projectAgentExecution(task.builder),
        gemini: projectAgentExecution(task.gemini)
    };
    const executionCompleted = Object.values(agentExecutions).some(agent => agent && ['success', 'failure', 'blocked'].includes(agent.status));
    const verifiedOutcome = task.status === 'VERIFIED' || task.status === 'COMPLETE';
    const terminalDetails = { status: task.status, agent_execution: agentExecutions };

    return {
        request_id: task.request_id,
        task: task.task,
        lifecycle: {
            status: task.status,
            execution_completed: executionCompleted,
            verified_outcome: verifiedOutcome
        },
        lineage: {
            parent_request_id: task.parent_request_id || null,
            superseded_by: task.lineage && task.lineage.superseded_by || null,
            cancelled: Boolean(task.lineage && task.lineage.cancelled)
        },
        agents: { current: task.current_agent, next: task.next_agent },
        next_action: task.next_action,
        execution: agentExecutions,
        evidence: {
            count: evidence.length,
            categories: evidenceCategories
        },
        verification: {
            requirements: task.verification,
            independent_verification: independentVerification
        },
        failure: task.status === 'FAILED' ? terminalDetails : null,
        blocked: task.status === 'BLOCKED' ? terminalDetails : null,
        created_at: task.created_at,
        updated_at: task.updated_at
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
            if (command.parent_request_id) {
                const lineageCheck = taskRegistry.validateLineageForCreate(command.parent_request_id, command.request_id);
                if (!lineageCheck.valid) {
                    throw new RuntimeError(400, 'LINEAGE_VALIDATION_REJECTED', lineageCheck.error);
                }
            }
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
                toolResultContent = JSON.stringify({ status: 'found', task: projectTaskForDeepSeek(task) });
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

function sendStreamingCompletion(res, message, model) {
    const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const created = Math.floor(Date.now() / 1000);
    const writeEvent = payload => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    const metadata = { id: completionId, object: 'chat.completion.chunk', created };

    res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    writeEvent({
        ...metadata,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: message.content }, finish_reason: null }]
    });
    writeEvent({
        ...metadata,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    });
    res.end('data: [DONE]\n\n');
}

function createDeepSeekRuntimeHandler(options = {}) {
    return async (req, res) => {
        try {
            const result = await runDeepSeekConversation({
                messages: req.body && req.body.messages,
                env: options.env || process.env,
                httpClient: options.httpClient || axios
            });
            if (req.body && req.body.stream === true) {
                return sendStreamingCompletion(res, result.message, req.body.model);
            }
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
    DEEPSEEK_COORDINATOR_POLICY,
    MAX_TOOL_ITERATIONS,
    RuntimeError,
    buildControlPlaneCommand,
    validateGetTaskArguments,
    projectTaskForDeepSeek,
    createDeepSeekRuntimeHandler,
    getRuntimeConfig,
    normalizeMessages,
    normalizeMessage,
    runDeepSeekConversation,
    sendStreamingCompletion
};
