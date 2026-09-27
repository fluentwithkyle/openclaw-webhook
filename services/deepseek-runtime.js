const axios = require('axios');
const taskRegistry = require('../poc/task-registry');

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_TOOL_ITERATIONS = 3;
const MAX_CHILD_TASK_OBSERVATIONS = 10;
const CHILD_TASK_SUMMARY_STATUSES = Object.freeze(['PENDING', 'SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE', 'FAILED', 'BLOCKED']);
const MAX_REPORT_HIGHLIGHTS = 3;
const MAX_REPORT_HIGHLIGHT_LENGTH = 240;
const WORKFLOW_TERMINAL_STATUSES = Object.freeze(['COMPLETE', 'FAILED', 'BLOCKED']);
const WORKFLOW_TERMINAL_OUTCOMES = Object.freeze(['COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED', 'SUPERSEDED']);

const SPECIALIST_ROUTING_POLICY = Object.freeze({
    GeminiReviewer: Object.freeze({ lane: 'Gemini Reviewer', target: 'Gemini', task_mode: 'REVIEW', capabilities: Object.freeze(['read_only']), permitted_paths: Object.freeze(['poc/']) }),
    SecuritySpecialist: Object.freeze({ lane: 'Security Specialist', target: 'Security Specialist', task_mode: 'REVIEW', capabilities: Object.freeze(['read_only']), permitted_paths: Object.freeze(['poc/']) }),
    UtilitySpecialist: Object.freeze({ lane: 'Utility Specialist', target: 'Utility Specialist', task_mode: 'REVIEW', capabilities: Object.freeze(['read_only']), permitted_paths: Object.freeze(['poc/']) }),
    GeminiBuilder: Object.freeze({ lane: 'Gemini Builder', target: 'Gemini Builder', task_mode: 'BUILDER', capabilities: Object.freeze(['read_only', 'modify_files', 'run_tests', 'commit', 'push']), permitted_paths: Object.freeze(['poc/']), authorization_required: true }),
    Kilo: Object.freeze({ lane: 'Kilo', target: 'Kilo', task_mode: 'FAILOVER_EXECUTE', authorization_required: true })
});

function routeSpecialistIntent(objective, trustedContext = {}) {
    const normalized = typeof objective === 'string' ? objective.trim() : '';
    if (!normalized) return { valid: false, outcome: 'HUMAN_REVIEW', reason: 'A non-empty intent is required for specialist routing' };
    const intent = normalized.toLowerCase();
    if (/\b(auth(?:entication|orization)?|credential|secret|token|password|crypto(?:graphy|graphic)?|encrypt(?:ion)?|decrypt(?:ion)?|security[ -]?(?:boundary|review)|trust[ -]?boundary)\b/.test(intent)) {
        return { valid: true, ...SPECIALIST_ROUTING_POLICY.SecuritySpecialist, dispatchable: true };
    }
    if (/\b(documentation|docs?|format(?:ting)?|typo|readme|boilerplate|text transformation)\b/.test(intent)) {
        return { valid: true, ...SPECIALIST_ROUTING_POLICY.UtilitySpecialist, dispatchable: true };
    }
    if (/\b(implement|implementation|modify|change code|fix|build|refactor|commit|push|write code)\b/.test(intent)) {
        return { valid: true, ...SPECIALIST_ROUTING_POLICY.GeminiBuilder, dispatchable: true };
    }
    if (trustedContext.explicit_kilo_failover === true) {
        return { valid: false, ...SPECIALIST_ROUTING_POLICY.Kilo, outcome: 'HUMAN_REVIEW', reason: 'Kilo failover routing requires separately issued Director authorization with trusted scope' };
    }
    if (/\b(review|research|analy[sz]e|audit|assess|investigate|explain|inspect)\b/.test(intent)) {
        return { valid: true, ...SPECIALIST_ROUTING_POLICY.GeminiReviewer, dispatchable: true };
    }
    return { valid: false, outcome: 'HUMAN_REVIEW', reason: 'Specialist routing could not safely classify the intent' };
}
const DEEPSEEK_COORDINATOR_POLICY = Object.freeze({
    phase: 'Phase 3 bounded autonomous continuation',
    model_operations: Object.freeze(['request_task', 'get_task']),
    request_task: Object.freeze({ model_fields: Object.freeze(['operation', 'objective', 'parent_request_id']), specialist_routing: 'server policy' }),
    get_task: Object.freeze({ model_fields: Object.freeze(['operation', 'request_id']), request_id_prefix: 'deepseek-runtime-' }),
    server_derived_authority: Object.freeze({
        repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main',
        specialist_routing: 'deterministic server policy', task_mode: 'REVIEW', capabilities: Object.freeze(['read_only']), permitted_paths: Object.freeze(['poc/']),
        originator: 'Kyle', authentication_context: 'server-held coordinator secret', verification: 'Review the bounded poc/ scope and return structured findings.'
    }),
    observation_projection: Object.freeze(['identity', 'lifecycle', 'lineage', 'agents', 'next_action', 'execution', 'evidence', 'evidence_summary', 'verification_reconciliation_summary', 'verification', 'failure', 'failure_summary', 'blocked', 'blocked_summary', 'workflow_completion_summary']),
    state_semantics: Object.freeze({
        agent_report: 'execution evidence only',
        independent_verification: 'required by the ACP lifecycle before VERIFIED or COMPLETE',
        verified_outcome: 'only ACP lifecycle status VERIFIED or COMPLETE'
    }),
    continuation: Object.freeze({
        requires_observation: true,
        required_parent_status: 'COMPLETE',
        required_evidence: 'INDEPENDENT_VERIFICATION',
        stop_statuses: Object.freeze(['FAILED', 'BLOCKED', 'CANCELLED', 'SUPERSEDED']),
        max_tool_iterations: MAX_TOOL_ITERATIONS,
        result_classification: 'server-derived from TaskRegistry lifecycle, lineage, and evidence only'
    }),
    observation: Object.freeze({ max_child_tasks: MAX_CHILD_TASK_OBSERVATIONS }),
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

function buildControlPlaneCommand(args, trustedContext) {
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

    const route = routeSpecialistIntent(args.objective, trustedContext);
    if (!route.valid) throw new RuntimeError(403, 'SPECIALIST_ROUTING_BLOCKED', route.reason, { lane: route.lane || 'Human review', outcome: route.outcome });
    const command = {
        protocol_version: '0.1',
        request_id: `deepseek-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        source: 'DeepSeek Runtime',
        target: route.target,
        task_type: 'model-mediated-review',
        repository: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.repository,
        base_branch: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.base_branch,
        task: args.objective.trim(),
        task_mode: route.task_mode,
        constraints: { permitted_paths: route.permitted_paths.slice() },
        authorization: { capabilities: route.capabilities.slice() },
        verification: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.verification,
        reporting: 'structured-json',
        originator: DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.originator
    };
    if (route.task_mode === 'BUILDER') {
        command.activation_syntax = '@gemini-cli';
        command.activation_surface = 'workflow_dispatch';
    }
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

function evaluateContinuationPolicy(parentRequestId, newRequestId, observedTaskIds) {
    if (!observedTaskIds || !observedTaskIds.has(parentRequestId)) {
        return { valid: false, error: 'Continuation requires a prior get_task observation of the parent task' };
    }

    const observedResult = observedTaskIds instanceof Map ? observedTaskIds.get(parentRequestId) : null;
    if (observedResult && !observedResult.eligible_for_next_decision) {
        return { valid: false, error: observedResult.reason };
    }

    const parent = taskRegistry.getTask(parentRequestId);
    if (!parent) return { valid: false, error: 'parent_request_id does not exist in registry; continuation cannot proceed' };
    const currentResult = classifyTaskResultForContinuation(parent);
    if (!currentResult.eligible_for_next_decision) return { valid: false, error: currentResult.reason };
    return taskRegistry.validateLineageForCreate(parentRequestId, newRequestId);
}

function classifyTaskResultForContinuation(task) {
    if (!task || typeof task !== 'object' || typeof task.request_id !== 'string' || typeof task.status !== 'string') {
        return { classification: 'invalid', eligible_for_next_decision: false, reason: 'Task result is invalid; continuation cannot proceed' };
    }
    if (taskRegistry.isCancelled(task.request_id)) {
        return { classification: 'terminal', eligible_for_next_decision: false, reason: 'Cannot continue a cancelled task' };
    }
    if (taskRegistry.isSuperseded(task.request_id)) {
        return { classification: 'terminal', eligible_for_next_decision: false, reason: 'Cannot continue a superseded task' };
    }
    if (DEEPSEEK_COORDINATOR_POLICY.continuation.stop_statuses.includes(task.status)) {
        return { classification: 'terminal', eligible_for_next_decision: false, reason: `Cannot continue a task in terminal state ${task.status}` };
    }
    if (task.status !== DEEPSEEK_COORDINATOR_POLICY.continuation.required_parent_status) {
        return { classification: 'incomplete', eligible_for_next_decision: false, reason: `Continuation requires parent status ${DEEPSEEK_COORDINATOR_POLICY.continuation.required_parent_status}` };
    }
    if (!taskRegistry.hasEvidenceOfType(task.request_id, DEEPSEEK_COORDINATOR_POLICY.continuation.required_evidence)) {
        return { classification: 'insufficiently_verified', eligible_for_next_decision: false, reason: `Continuation requires ${DEEPSEEK_COORDINATOR_POLICY.continuation.required_evidence} evidence` };
    }
    return { classification: 'eligible', eligible_for_next_decision: true, reason: null };
}

function observeTaskForDeepSeek(requestId, submittedTaskIds, observedTaskResults) {
    const task = taskRegistry.getTask(requestId);
    if (!task) return { status: 'not_found', request_id: requestId };

    const result = classifyTaskResultForContinuation(task);
    observedTaskResults.set(requestId, result);
    const allChildTasks = taskRegistry.getTasksByParent(requestId);
    const projection = projectTaskForDeepSeek(task);
    if (allChildTasks.length > 0) {
        projection.child_tasks_summary = summarizeChildTaskStatuses(allChildTasks);
        const childDiagnosticsSummary = summarizeChildTaskDiagnostics(allChildTasks);
        if (childDiagnosticsSummary) projection.child_diagnostics_summary = childDiagnosticsSummary;
        const workflowCompletionSummary = summarizeWorkflowCompletion(allChildTasks);
        if (workflowCompletionSummary) projection.workflow_completion_summary = workflowCompletionSummary;
        projection.child_tasks = allChildTasks.slice(0, MAX_CHILD_TASK_OBSERVATIONS).map(projectTaskForDeepSeek);
    }
    return {
        status: 'found',
        task: projection,
        continuation: {
            ...result,
            submitted_in_this_execution: submittedTaskIds.has(requestId)
        }
    };
}

function summarizeChildTaskStatuses(childTasks) {
    const summary = CHILD_TASK_SUMMARY_STATUSES.reduce((counts, status) => ({ ...counts, [status.toLowerCase()]: 0 }), {
        total: childTasks.length
    });
    for (const childTask of childTasks) {
        if (CHILD_TASK_SUMMARY_STATUSES.includes(childTask.status)) {
            summary[childTask.status.toLowerCase()]++;
        }
    }
    return summary;
}

function summarizeChildTaskDiagnostics(childTasks) {
    const summary = { failed: 0, blocked: 0, failure_highlights: [], blocker_highlights: [] };
    for (const childTask of childTasks) {
        if (!['FAILED', 'BLOCKED'].includes(childTask.status)) continue;
        const diagnosticSummary = projectStructuredDiagnosticSummary(
            childTask.status,
            Array.isArray(childTask.evidence) ? childTask.evidence : [],
            projectTaskAgentExecutions(childTask)
        );
        const commentary = diagnosticSummary && diagnosticSummary.agent_commentary;
        const highlights = childTask.status === 'FAILED'
            ? [...(commentary && commentary.report_highlights || []), ...(commentary && commentary.blocker_highlights || [])]
            : [...(commentary && commentary.blocker_highlights || []), ...(commentary && commentary.report_highlights || [])];
        const targetHighlights = childTask.status === 'FAILED' ? summary.failure_highlights : summary.blocker_highlights;
        summary[childTask.status.toLowerCase()]++;
        for (const highlight of highlights) {
            if (targetHighlights.length >= MAX_REPORT_HIGHLIGHTS) break;
            targetHighlights.push({
                agent: sanitizeStringValue(String(highlight.agent || 'Unknown')).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH),
                source: 'agent_commentary',
                text: sanitizeStringValue(highlight.text).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH)
            });
        }
    }
    return summary.failed > 0 || summary.blocked > 0 ? summary : null;
}

function getWorkflowTerminalOutcome(childTask) {
    if (taskRegistry.isCancelled(childTask.request_id)) return 'CANCELLED';
    if (taskRegistry.isSuperseded(childTask.request_id)) return 'SUPERSEDED';
    return WORKFLOW_TERMINAL_STATUSES.includes(childTask.status) ? childTask.status : null;
}

function classifyWorkflowOutcome(terminalStateCounts) {
    const presentOutcomes = WORKFLOW_TERMINAL_OUTCOMES.filter(outcome => terminalStateCounts[outcome.toLowerCase()] > 0);
    if (presentOutcomes.length === 1) {
        return presentOutcomes[0] === 'COMPLETE' ? 'ALL_SUCCESS' : presentOutcomes[0];
    }
    return terminalStateCounts.complete > 0 ? 'PARTIAL_SUCCESS' : 'MIXED_TERMINAL';
}

function summarizeWorkflowCompletion(childTasks) {
    const terminalStateCounts = WORKFLOW_TERMINAL_OUTCOMES.reduce((counts, outcome) => ({ ...counts, [outcome.toLowerCase()]: 0 }), {});
    const completionHighlights = [];
    for (const childTask of childTasks) {
        const terminalOutcome = getWorkflowTerminalOutcome(childTask);
        if (!terminalOutcome) return null;
        terminalStateCounts[terminalOutcome.toLowerCase()]++;
        if (terminalOutcome !== 'COMPLETE') continue;
        const evidenceSummary = projectStructuredEvidenceSummary(
            Array.isArray(childTask.evidence) ? childTask.evidence : [],
            projectTaskAgentExecutions(childTask)
        );
        const highlights = evidenceSummary && evidenceSummary.agent_commentary && evidenceSummary.agent_commentary.report_highlights || [];
        for (const highlight of highlights) {
            if (completionHighlights.length >= MAX_REPORT_HIGHLIGHTS) break;
            completionHighlights.push({
                agent: sanitizeStringValue(String(highlight.agent || 'Unknown')).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH),
                source: 'agent_commentary',
                text: sanitizeStringValue(highlight.text).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH)
            });
        }
    }
    const summary = {
        outcome: classifyWorkflowOutcome(terminalStateCounts),
        total_children: childTasks.length,
        terminal_state_counts: terminalStateCounts
    };
    if (completionHighlights.length > 0) summary.completion_highlights = completionHighlights;
    return summary;
}

function projectTaskAgentExecutions(task) {
    return {
        kilo: projectAgentExecution(task.kilo),
        builder: projectAgentExecution(task.builder),
        gemini: projectAgentExecution(task.gemini)
    };
}

function sanitizeReport(report) {
    if (!report || typeof report !== 'object') return report || null;
    if (Array.isArray(report)) return report.map(value => typeof value === 'string' ? sanitizeStringValue(value) : sanitizeReport(value));

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
        .replace(/\b(api[_ -]?key|token|credential|authorization|password|director[_ -]?approval(?:[_ -]?(?:id|proof))?)([=:]?\s+)[A-Za-z0-9_\-\.]+/gi, '$1$2[REDACTED]')
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

function boundedReportHighlight(agent, report) {
    const sanitized = sanitizeReport(report);
    if (!sanitized || typeof sanitized !== 'object') return null;
    const summary = typeof sanitized.summary === 'string' ? sanitized.summary :
        sanitized.result && typeof sanitized.result.summary === 'string' ? sanitized.result.summary : null;
    if (!summary || summary.trim().length === 0) return null;
    return {
        agent,
        source: 'agent_commentary',
        text: summary.trim().slice(0, MAX_REPORT_HIGHLIGHT_LENGTH)
    };
}

function projectReportCounts(agent, report) {
    const sanitized = sanitizeReport(report);
    if (!sanitized || typeof sanitized !== 'object') return null;
    const counts = {};
    for (const field of ['verification', 'blockers', 'changed_files']) {
        if (Array.isArray(sanitized[field])) counts[field] = sanitized[field].length;
    }
    return Object.keys(counts).length > 0 ? { agent, ...counts } : null;
}

function projectStructuredEvidenceSummary(evidence, agentExecutions) {
    const observedExecution = Object.entries(agentExecutions)
        .filter(([, execution]) => execution && typeof execution.status === 'string')
        .map(([agent, execution]) => ({ agent, status: execution.status }));
    const independentVerification = evidence.filter(record => record && record.evidence_type === 'INDEPENDENT_VERIFICATION');
    const evidenceOutcomes = independentVerification
        .filter(record => typeof record.verification_result === 'string')
        .map(record => ({ agent: record.agent, status: record.verification_result }));
    const highlights = [];
    const reportCounts = [];
    const reportSources = [
        ...Object.entries(agentExecutions).map(([agent, execution]) => ({ agent, report: execution && execution.result })),
        ...evidence.map(record => ({ agent: record && record.agent, report: record && record.report }))
    ];
    for (const source of reportSources) {
        const highlight = boundedReportHighlight(source.agent, source.report);
        if (highlight) highlights.push(highlight);
        const counts = projectReportCounts(source.agent, source.report);
        if (counts) reportCounts.push(counts);
    }
    const summary = { observed_facts: {} };
    if (observedExecution.length > 0) summary.observed_facts.execution = observedExecution;
    if (independentVerification.length > 0) {
        summary.observed_facts.independent_verification = { count: independentVerification.length };
        if (evidenceOutcomes.length > 0) summary.observed_facts.independent_verification.outcomes = evidenceOutcomes;
    }
    if (reportCounts.length > 0) summary.observed_facts.report_counts = reportCounts;
    if (highlights.length > 0) summary.agent_commentary = { report_highlights: highlights.slice(0, MAX_REPORT_HIGHLIGHTS) };
    return Object.keys(summary.observed_facts).length > 0 || summary.agent_commentary ? summary : null;
}

function projectVerificationReconciliationSummary(evidence, agentExecutions) {
    const independentVerification = evidence.filter(record => record && record.evidence_type === 'INDEPENDENT_VERIFICATION');
    const reconciliationSources = [
        ...Object.entries(agentExecutions).map(([agent, execution]) => ({ agent, report: execution && execution.result })),
        ...evidence.map(record => ({ agent: record && record.agent, report: record && record.report }))
    ];
    const reconciliation = [];
    let reconciliationCount = 0;
    const highlights = [];
    for (const source of reconciliationSources) {
        const report = sanitizeReport(source.report);
        const details = report && report.reconciliation;
        if (!details || typeof details !== 'object' || Array.isArray(details) || typeof details.status !== 'string') continue;
        const observed = {
            agent: sanitizeStringValue(String(source.agent || 'Unknown')).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH),
            status: sanitizeStringValue(details.status).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH)
        };
        if (Array.isArray(details.changed_files)) observed.changed_files = details.changed_files.length;
        reconciliationCount++;
        if (reconciliation.length < MAX_REPORT_HIGHLIGHTS) reconciliation.push(observed);
        const highlight = boundedReportHighlight(source.agent, report);
        if (highlight && highlights.length < MAX_REPORT_HIGHLIGHTS) highlights.push(highlight);
    }
    if (independentVerification.length === 0 && reconciliationCount === 0) return null;

    const summary = { observed_facts: {} };
    if (independentVerification.length > 0) {
        const outcomes = [];
        for (const record of independentVerification) {
            if (typeof record.verification_result !== 'string' || outcomes.length >= MAX_REPORT_HIGHLIGHTS) continue;
            outcomes.push({
                agent: sanitizeStringValue(String(record.agent || 'Unknown')).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH),
                status: sanitizeStringValue(record.verification_result).slice(0, MAX_REPORT_HIGHLIGHT_LENGTH)
            });
        }
        summary.observed_facts.independent_verification = { evidence_count: independentVerification.length };
        if (outcomes.length > 0) summary.observed_facts.independent_verification.outcomes = outcomes;
    }
    if (reconciliation.length > 0) {
        summary.observed_facts.reconciliation = {
            count: reconciliationCount,
            outcomes: reconciliation
        };
    }
    if (highlights.length > 0) summary.agent_commentary = { reconciliation_highlights: highlights };
    return summary;
}

function projectStructuredDiagnosticSummary(status, evidence, agentExecutions) {
    const executionStatus = status === 'FAILED' ? 'failure' : 'blocked';
    const sources = [
        ...Object.entries(agentExecutions)
            .filter(([, execution]) => execution && execution.status === executionStatus)
            .map(([agent, execution]) => ({ agent, evidence_type: 'AGENT_EXECUTION', report: execution.result })),
        ...evidence
            .filter(record => record && record.verification_result === executionStatus)
            .map(record => ({ agent: record.agent, evidence_type: record.evidence_type, report: record.report }))
    ];
    const observedExecution = Object.entries(agentExecutions)
        .filter(([, execution]) => execution && execution.status === executionStatus)
        .map(([agent, execution]) => ({ agent, status: execution.status }));
    const blockerCounts = [];
    const reportHighlights = [];
    const blockerHighlights = [];
    for (const source of sources) {
        const sanitized = sanitizeReport(source.report);
        if (!sanitized || typeof sanitized !== 'object') continue;
        if (Array.isArray(sanitized.blockers)) {
            blockerCounts.push({ agent: source.agent, blockers: sanitized.blockers.length });
            for (const blocker of sanitized.blockers) {
                if (typeof blocker === 'string' && blocker.trim().length > 0) {
                    blockerHighlights.push({ agent: source.agent, source: 'agent_commentary', text: blocker.trim().slice(0, MAX_REPORT_HIGHLIGHT_LENGTH) });
                }
            }
        }
        const highlight = boundedReportHighlight(source.agent, sanitized);
        if (highlight) reportHighlights.push(highlight);
    }
    const summary = { observed_facts: {} };
    if (observedExecution.length > 0) summary.observed_facts.execution = observedExecution;
    if (blockerCounts.length > 0) summary.observed_facts.report_counts = blockerCounts;
    const commentary = {};
    if (blockerHighlights.length > 0) commentary.blocker_highlights = blockerHighlights.slice(0, MAX_REPORT_HIGHLIGHTS);
    if (reportHighlights.length > 0) commentary.report_highlights = reportHighlights.slice(0, MAX_REPORT_HIGHLIGHTS);
    if (Object.keys(commentary).length > 0) summary.agent_commentary = commentary;
    return Object.keys(summary.observed_facts).length > 0 || summary.agent_commentary ? summary : null;
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
    const agentExecutions = projectTaskAgentExecutions(task);
    const executionCompleted = Object.values(agentExecutions).some(agent => agent && ['success', 'failure', 'blocked'].includes(agent.status));
    const verifiedOutcome = task.status === 'VERIFIED' || task.status === 'COMPLETE';
    const terminalDetails = { status: task.status, agent_execution: agentExecutions };

    const projection = {
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
        evidence_summary: projectStructuredEvidenceSummary(evidence, agentExecutions),
        failure_summary: task.status === 'FAILED' ? projectStructuredDiagnosticSummary('FAILED', evidence, agentExecutions) : null,
        blocked_summary: task.status === 'BLOCKED' ? projectStructuredDiagnosticSummary('BLOCKED', evidence, agentExecutions) : null,
        verification: {
            requirements: task.verification,
            independent_verification: independentVerification
        },
        failure: task.status === 'FAILED' ? terminalDetails : null,
        blocked: task.status === 'BLOCKED' ? terminalDetails : null,
        created_at: task.created_at,
        updated_at: task.updated_at
    };
    const verificationReconciliationSummary = projectVerificationReconciliationSummary(evidence, agentExecutions);
    if (verificationReconciliationSummary) projection.verification_reconciliation_summary = verificationReconciliationSummary;
    return projection;
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
    const submittedTaskIds = new Set();
    const observedTaskResults = new Map();

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
                const continuationCheck = evaluateContinuationPolicy(command.parent_request_id, command.request_id, observedTaskResults);
                if (!continuationCheck.valid) {
                    throw new RuntimeError(400, 'CONTINUATION_POLICY_REJECTED', continuationCheck.error);
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
            submittedTaskIds.add(command.request_id);
            toolResultContent = JSON.stringify({
                status: 'completed',
                coordinator: coordinatorResponse.data,
                observation: observeTaskForDeepSeek(command.request_id, submittedTaskIds, observedTaskResults)
            });
        } else if (args.operation === 'get_task') {
            const validatedArgs = validateGetTaskArguments(args);
            toolResultContent = JSON.stringify(observeTaskForDeepSeek(validatedArgs.request_id, submittedTaskIds, observedTaskResults));
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
    MAX_CHILD_TASK_OBSERVATIONS,
    MAX_REPORT_HIGHLIGHTS,
    MAX_REPORT_HIGHLIGHT_LENGTH,
    SPECIALIST_ROUTING_POLICY,
    routeSpecialistIntent,
    RuntimeError,
    buildControlPlaneCommand,
    validateGetTaskArguments,
    evaluateContinuationPolicy,
    classifyTaskResultForContinuation,
    observeTaskForDeepSeek,
    projectTaskForDeepSeek,
    createDeepSeekRuntimeHandler,
    getRuntimeConfig,
    normalizeMessages,
    normalizeMessage,
    runDeepSeekConversation,
    sendStreamingCompletion
};
