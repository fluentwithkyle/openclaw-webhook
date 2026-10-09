const assert = require('assert');
const axios = require('axios');
const express = require('express');
const http = require('http');
const {
    CONTROL_PLANE_TOOL,
    DEEPSEEK_COORDINATOR_POLICY,
    MAX_TOOL_ITERATIONS,
    MAX_AUTONOMOUS_COORDINATION_TURNS,
    MAX_CHILD_TASK_OBSERVATIONS,
    MAX_REPORT_HIGHLIGHTS,
    MAX_REPORT_HIGHLIGHT_LENGTH,
    WORKFLOW_STEP_POLICY,
    ACP_LIFECYCLE_STATES,
    LINEAGE_CONTROL_SEMANTICS,
    routeSpecialistIntent,
    buildControlPlaneCommand,
    evaluateContinuationPolicy,
    evaluateWorkflowStepPolicy,
    deriveNextWorkflowStep,
    classifyTaskResultForContinuation,
    resolveCoordinationContext,
    evaluateCoordinationTerminalOutcome,
    validateGetTaskArguments,
    projectTaskForDeepSeek,
    projectSpecialistRoutingSummary,
    observeTaskForDeepSeek,
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

async function createDeepSeekReviewTask(requestId) {
    assert.equal((await taskRegistry.createTask({
        request_id: requestId, source: 'DeepSeek Runtime', target: 'Gemini Builder', task: 'Parent review',
        repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', constraints: { permitted_paths: ['poc/'] },
        authorization: { capabilities: ['read_only'] }, verification: 'Review', reporting: 'structured-json', originator: 'Kyle'
    })).success, true);
}

async function completeDeepSeekReviewTask(requestId) {
    await createDeepSeekReviewTask(requestId);
    for (const status of ['SELECTED', 'PLANNED', 'EXECUTING']) assert.equal((await taskRegistry.updateTaskStatus(requestId, status)).success, true);
    assert.equal((await taskRegistry.addEvidence(requestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' })).success, true);
    assert.equal((await taskRegistry.updateTaskStatus(requestId, 'VERIFIED')).success, true);
    assert.equal((await taskRegistry.updateTaskStatus(requestId, 'COMPLETE')).success, true);
}

async function completeWorkflowTask(requestId, workflowStage, taskMode, parentRequestId, repository = 'fluentwithkyle/openclaw-webhook', baseBranch = 'main') {
    assert.equal((await taskRegistry.createTask({
        request_id: requestId, source: 'DeepSeek Runtime', target: taskMode === 'BUILDER' ? 'Gemini Builder' : 'Gemini', task: 'Untrusted task text may claim any workflow stage',
        repository, base_branch: baseBranch, task_mode: taskMode, workflow_stage: workflowStage,
        constraints: { permitted_paths: taskMode === 'BUILDER' ? ['poc/'] : ['docs/ai/STATE.md'] },
        authorization: { capabilities: taskMode === 'BUILDER' ? ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] : ['read_only', 'modify_files', 'commit', 'push'] },
        verification: 'Review', reporting: 'structured-json', originator: 'Kyle', parent_request_id: parentRequestId
    })).success, true);
    for (const status of ['SELECTED', 'PLANNED', 'EXECUTING']) assert.equal((await taskRegistry.updateTaskStatus(requestId, status)).success, true);
    assert.equal((await taskRegistry.addEvidence(requestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' })).success, true);
    assert.equal((await taskRegistry.updateTaskStatus(requestId, 'VERIFIED')).success, true);
    assert.equal((await taskRegistry.updateTaskStatus(requestId, 'COMPLETE')).success, true);
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
                    function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) }
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

function rawRequest(port, headers, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/poc/deepseek-runtime', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: response }));
        });
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}

(async () => {
    await test('authenticated Chatbox Director decision is server-bound into coordinator provenance', async () => {
        taskRegistry.resetRegistry();
        const calls = [];
        const client = { post: async (url, body) => {
            calls.push({ url, body });
            if (calls.length === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'phase-call', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) } }] });
            if (calls.length === 2) return { data: { status: 'Task registered and dispatched', request_id: body.request_id } };
            return providerResponse({ role: 'assistant', content: 'Research task requested.' });
        } };
        await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'OK, let\'s move onto Phase 4.' }],
            env: env(),
            httpClient: client,
            trustedIngress: true
        });
        const command = calls[1].body;
        assert.equal(typeof command.director_transition_decision_provenance, 'object');
        assert.equal(command.director_transition_decision_provenance.current_phase, 'phase-3-autonomous-coordination-loop');
        assert.equal(command.director_transition_decision_provenance.target_phase, 'phase-4-scaled-conversational-orchestration-cross-task-lineage-navigation');
        assert.equal(command.director_transition_decision_provenance.coordinator_task_id, command.request_id);
        assert.match(command.director_transition_decision_provenance.decision, /move onto Phase 4/i);
    });

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
            if (calls.length === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) } }] });
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
        assert.equal(command.target, 'Gemini');
        assert.equal(command.task_mode, 'REVIEW');
    });

    await test('production coordinator path blocks strategically invalid model intent before ACP submission', async () => {
        let calls = 0;
        await assert.rejects(() => runDeepSeekConversation({
            messages: [{ role: 'user', content: 'start' }], env: env(),
            httpClient: { post: async () => {
                calls++;
                return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'blocked', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Review caching optimization' }) } }] });
            } }
        }), (error) => error.code === 'STRATEGIC_ALIGNMENT_BLOCKED');
        assert.equal(calls, 1, 'blocked intent must not reach the coordinator/ACP request');
    });

    await test('request_task automatically provides the reused sanitized observation to the next model decision', async () => {
        taskRegistry.resetRegistry();
        let modelCallCount = 0;
        let automaticObservation;
        const client = { post: async (url, body) => {
            if (url === env().DEEPSEEK_COORDINATOR_URL) {
                assert.equal((await taskRegistry.createTask(body)).success, true);
                for (const status of ['SELECTED', 'PLANNED', 'EXECUTING']) assert.equal((await taskRegistry.updateTaskStatus(body.request_id, status)).success, true);
                assert.equal((await taskRegistry.addEvidence(body.request_id, 'INDEPENDENT_VERIFICATION', 'Gemini', { summary: 'verified', token: 'hidden' })).success, true);
                assert.equal((await taskRegistry.updateTaskStatus(body.request_id, 'VERIFIED')).success, true);
                assert.equal((await taskRegistry.updateTaskStatus(body.request_id, 'COMPLETE')).success, true);
                return { data: { request_id: body.request_id, status: 'Task registered and dispatched' } };
            }
            modelCallCount++;
            if (modelCallCount === 1) {
                return providerResponse({ role: 'assistant', content: null, tool_calls: [{
                    id: 'call-1', type: 'function',
                    function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) }
                }] });
            }
            automaticObservation = JSON.parse(body.messages.find(message => message.role === 'tool').content);
            return providerResponse({ role: 'assistant', content: 'I received the independently verified result.' });
        } };

        const result = await runDeepSeekConversation({ messages: [{ role: 'user', content: 'Request and consume the result.' }], env: env(), httpClient: client });
        assert.equal(result.message.content, 'I received the independently verified result.');
        assert.equal(modelCallCount, 2);
        assert.equal(automaticObservation.status, 'completed');
        assert.equal(automaticObservation.observation.status, 'found');
        assert.equal(automaticObservation.observation.continuation.classification, 'eligible');
        assert.equal(automaticObservation.observation.continuation.submitted_in_this_execution, true);
        assert.equal(JSON.stringify(automaticObservation.observation).includes('hidden'), false);
        assert.equal(automaticObservation.observation.task.authorization, undefined);
        taskRegistry.resetRegistry();
    });

    await test('specialist routing summaries are server-derived, bounded, and observational', async () => {
        taskRegistry.resetRegistry();
        const cases = [
            ['security', 'Audit authentication and credential handling', 'SECURITY', 'Security Specialist', 'Security Specialist'],
            ['utility', 'Format the README documentation', 'UTILITY', 'Utility Specialist', 'Utility Specialist'],
            ['implementation', 'Implement a code change', 'IMPLEMENTATION', 'Gemini Builder', 'Gemini Builder'],
            ['review', 'Research the current coordinator behavior', 'REVIEW', 'Gemini', 'Gemini Reviewer']
        ];
        for (const [id, objective, classification, target, lane] of cases) {
            const route = routeSpecialistIntent(objective);
            assert.equal(route.valid, true);
            assert.equal(route.classification, classification);
            assert.equal(route.target, target);
            assert.equal(route.lane, lane);
        }
        const humanReview = projectSpecialistRoutingSummary({
            task: 'Consider this request', status: 'PENDING', current_agent: 'untrusted assignment'.repeat(50)
        });
        assert.deepEqual(humanReview, { routing_classification: 'HUMAN_REVIEW', dispatch_status: 'PENDING' });
        const longTask = {
            task: 'Review the request', status: `PENDING Bearer ${'a'.repeat(300)}`,
            current_agent: `Gemini Bearer ${'b'.repeat(300)}`
        };
        const bounded = projectSpecialistRoutingSummary(longTask);
        assert.equal(bounded.dispatch_status.length <= MAX_REPORT_HIGHLIGHT_LENGTH, true);
        assert.equal(bounded.assigned_specialist.length <= MAX_REPORT_HIGHLIGHT_LENGTH, true);
        assert.equal(bounded.dispatch_status.includes('Bearer ' + 'a'.repeat(300)), false);
        assert.equal(bounded.assigned_specialist.includes('Bearer ' + 'b'.repeat(300)), false);
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.model_operations, ['request_task', 'get_task']);
        assert.equal(MAX_TOOL_ITERATIONS, 3);
        taskRegistry.resetRegistry();
    });

    await test('observed independently verified task creates a bounded read-only continuation child', async () => {
        const parentRequestId = 'deepseek-runtime-phase3-parent';
        taskRegistry.resetRegistry();
        await completeDeepSeekReviewTask(parentRequestId);

        let childCommand;
        let observedResult;
        let modelCallCount = 0;
        const result = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Request the bounded follow-up.' }], env: env(),
            httpClient: { post: async (url, body) => {
                if (url === env().DEEPSEEK_COORDINATOR_URL) {
                    childCommand = body;
                    assert.equal((await taskRegistry.createTask(body)).success, true);
                    return { data: { request_id: body.request_id, status: 'Task registered and dispatched' } };
                }
                modelCallCount++;
                if (modelCallCount === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'get_task', request_id: parentRequestId }) } }] });
                if (modelCallCount === 2) {
                    const toolMessage = body.messages.find(message => message.role === 'tool');
                    observedResult = JSON.parse(toolMessage.content);
                    return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation', parent_request_id: parentRequestId }) } }] });
                }
                return providerResponse({ role: 'assistant', content: 'Follow-up requested.' });
            }}
        });
        assert.equal(result.message.content, 'Follow-up requested.');
        assert.equal(childCommand.parent_request_id, parentRequestId);
        assert.equal(childCommand.target, 'Gemini');
        assert.equal(childCommand.task_mode, 'REVIEW');
        assert.deepEqual(childCommand.authorization.capabilities, ['read_only']);
        assert.deepEqual(childCommand.constraints.permitted_paths, ['poc/']);
        assert.equal(observedResult.status, 'found');
        assert.equal(observedResult.continuation.classification, 'eligible');
        assert.equal(observedResult.continuation.eligible_for_next_decision, true);
        assert.equal(observedResult.continuation.submitted_in_this_execution, false);
        assert.deepEqual(projectTaskForDeepSeek(taskRegistry.getTask(childCommand.request_id)).lineage, { parent_request_id: parentRequestId, superseded_by: null, cancelled: false });
        taskRegistry.resetRegistry();
    });

    await test('server-authoritative workflow policy permits a completed independently verified review step', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-workflow-parent';
        await completeDeepSeekReviewTask(parentRequestId);
        const observed = new Map([[parentRequestId, classifyTaskResultForContinuation(taskRegistry.getTask(parentRequestId))]]);
        const result = evaluateWorkflowStepPolicy(parentRequestId, 'review', 'deepseek-runtime-workflow-child', observed);
        assert.deepEqual(result, { valid: true, authorization_required: false });
        assert.equal(WORKFLOW_STEP_POLICY.review.task_mode, 'REVIEW');
        assert.deepEqual(WORKFLOW_STEP_POLICY.review.capabilities, ['read_only']);
        taskRegistry.resetRegistry();
    });

    await test('workflow progression rejects incompatible lifecycle, failed, blocked, invalid lineage, and execution-only predecessors', async () => {
        taskRegistry.resetRegistry();
        const observed = new Set(['deepseek-runtime-workflow-missing']);
        assert.match(evaluateWorkflowStepPolicy('deepseek-runtime-workflow-missing', 'review', 'deepseek-runtime-workflow-child', observed).error, /does not exist/);

        await createDeepSeekReviewTask('deepseek-runtime-workflow-executing');
        for (const status of ['SELECTED', 'PLANNED', 'EXECUTING']) assert.equal((await taskRegistry.updateTaskStatus('deepseek-runtime-workflow-executing', status)).success, true);
        assert.equal((await taskRegistry.addEvidence('deepseek-runtime-workflow-executing', 'AGENT_REPORT', 'Gemini Builder', { status: 'success' })).success, true);
        assert.match(evaluateWorkflowStepPolicy('deepseek-runtime-workflow-executing', 'review', 'deepseek-runtime-workflow-child', new Set(['deepseek-runtime-workflow-executing'])).error, /COMPLETE/);

        for (const [requestId, status] of [['deepseek-runtime-workflow-failed', 'FAILED'], ['deepseek-runtime-workflow-blocked', 'BLOCKED']]) {
            await createDeepSeekReviewTask(requestId);
            for (const transition of ['SELECTED', 'PLANNED', 'EXECUTING', status]) assert.equal((await taskRegistry.updateTaskStatus(requestId, transition)).success, true);
            assert.match(evaluateWorkflowStepPolicy(requestId, 'review', 'deepseek-runtime-workflow-child', new Set([requestId])).error, new RegExp(status));
        }
        taskRegistry.resetRegistry();
    });

    await test('workflow implementation step remains server-derived and requires Director authorization at the ACP boundary', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-workflow-implementation-parent';
        await completeDeepSeekReviewTask(parentRequestId);
        const observed = new Map([[parentRequestId, classifyTaskResultForContinuation(taskRegistry.getTask(parentRequestId))]]);
        assert.deepEqual(evaluateWorkflowStepPolicy(parentRequestId, 'implementation', 'deepseek-runtime-workflow-implementation-child', observed), { valid: true, authorization_required: true });
        assert.equal(WORKFLOW_STEP_POLICY.implementation.target, 'Gemini Builder');
        assert.equal(WORKFLOW_STEP_POLICY.implementation.task_mode, 'BUILDER');
        assert.deepEqual(WORKFLOW_STEP_POLICY.implementation.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
        assert.throws(() => buildControlPlaneCommand({ operation: 'request_task', objective: 'Review this implementation plan', parent_request_id: parentRequestId, workflow_step: 'implementation', target: 'Kilo' }), /not permitted/);
        taskRegistry.resetRegistry();
    });

    await test('verification and reconciliation workflow stages require authoritative staged predecessors', async () => {
        taskRegistry.resetRegistry();
        const implementationId = 'deepseek-runtime-authoritative-implementation';
        await completeWorkflowTask(implementationId, 'implementation', 'BUILDER');
        const implementationObserved = new Map([[implementationId, classifyTaskResultForContinuation(taskRegistry.getTask(implementationId))]]);
        assert.deepEqual(evaluateWorkflowStepPolicy(implementationId, 'verification', 'deepseek-runtime-verification', implementationObserved), { valid: true, authorization_required: true });

        const verificationId = 'deepseek-runtime-authoritative-verification';
        await completeWorkflowTask(verificationId, 'verification', 'VERIFY_RECONCILE', implementationId);
        const verificationObserved = new Map([[verificationId, classifyTaskResultForContinuation(taskRegistry.getTask(verificationId))]]);
        assert.deepEqual(evaluateWorkflowStepPolicy(verificationId, 'reconciliation', 'deepseek-runtime-reconciliation', verificationObserved), { valid: true, authorization_required: true });
        assert.equal(WORKFLOW_STEP_POLICY.verification.predecessor_workflow_stage, 'implementation');
        assert.equal(WORKFLOW_STEP_POLICY.reconciliation.predecessor_workflow_stage, 'verification');
        taskRegistry.resetRegistry();
    });

    await test('workflow stage identity fails closed for missing, untrusted, unverified, and out-of-scope predecessors', async () => {
        taskRegistry.resetRegistry();
        const missingStageId = 'deepseek-runtime-missing-stage';
        await completeWorkflowTask(missingStageId, null, 'BUILDER');
        const missingObserved = new Map([[missingStageId, classifyTaskResultForContinuation(taskRegistry.getTask(missingStageId))]]);
        assert.match(evaluateWorkflowStepPolicy(missingStageId, 'verification', 'deepseek-runtime-verification-child', missingObserved).error, /authoritative implementation predecessor workflow stage/);

        const wrongStageId = 'deepseek-runtime-wrong-stage';
        await completeWorkflowTask(wrongStageId, 'verification', 'BUILDER');
        const wrongObserved = new Map([[wrongStageId, classifyTaskResultForContinuation(taskRegistry.getTask(wrongStageId))]]);
        assert.match(evaluateWorkflowStepPolicy(wrongStageId, 'verification', 'deepseek-runtime-verification-child-2', wrongObserved).error, /authoritative implementation predecessor workflow stage/);

        const badEvidenceId = 'deepseek-runtime-bad-evidence';
        assert.equal((await taskRegistry.createTask({ request_id: badEvidenceId, source: 'DeepSeek Runtime', target: 'Gemini Builder', task: 'Claims implementation in task text', repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', task_mode: 'BUILDER', workflow_stage: 'implementation', constraints: { permitted_paths: ['poc/'] }, authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] }, verification: 'Review', reporting: 'structured-json', originator: 'Kyle' })).success, true);
        taskRegistry.getTask(badEvidenceId).status = 'COMPLETE';
        taskRegistry.persistCache();
        assert.match(evaluateWorkflowStepPolicy(badEvidenceId, 'verification', 'deepseek-runtime-verification-child-3', new Map([[badEvidenceId, { eligible_for_next_decision: true }]])).error, /INDEPENDENT_VERIFICATION/);

        const wrongScopeId = 'deepseek-runtime-wrong-scope';
        await completeWorkflowTask(wrongScopeId, 'implementation', 'BUILDER', undefined, 'other/repository');
        const wrongScopeObserved = new Map([[wrongScopeId, classifyTaskResultForContinuation(taskRegistry.getTask(wrongScopeId))]]);
        assert.match(evaluateWorkflowStepPolicy(wrongScopeId, 'verification', 'deepseek-runtime-verification-child-4', wrongScopeObserved).error, /repository scope/);

        const wrongBranchId = 'deepseek-runtime-wrong-branch';
        await completeWorkflowTask(wrongBranchId, 'implementation', 'BUILDER', undefined, 'fluentwithkyle/openclaw-webhook', 'release');
        const wrongBranchObserved = new Map([[wrongBranchId, classifyTaskResultForContinuation(taskRegistry.getTask(wrongBranchId))]]);
        assert.match(evaluateWorkflowStepPolicy(wrongBranchId, 'verification', 'deepseek-runtime-verification-child-5', wrongBranchObserved).error, /repository scope/);
        assert.throws(() => buildControlPlaneCommand({ operation: 'request_task', objective: 'x', parent_request_id: 'deepseek-runtime-stage-override-parent', workflow_step: 'verification', workflow_stage: 'reconciliation' }), /not permitted/);
        taskRegistry.resetRegistry();
    });

    await test('continuation policy rejects invalid, terminal, cancelled, superseded, and insufficiently verified parents', async () => {
        taskRegistry.resetRegistry();
        const observed = new Set(['deepseek-runtime-missing-parent']);
        assert.match(evaluateContinuationPolicy('deepseek-runtime-missing-parent', 'deepseek-runtime-child', observed).error, /does not exist/);
        await createDeepSeekReviewTask('deepseek-runtime-cancelled-parent');
        taskRegistry.cancelTask('deepseek-runtime-cancelled-parent', 'cancelled');
        assert.match(evaluateContinuationPolicy('deepseek-runtime-cancelled-parent', 'deepseek-runtime-child', new Set(['deepseek-runtime-cancelled-parent'])).error, /cancelled/);
        await createDeepSeekReviewTask('deepseek-runtime-superseded-parent');
        assert.equal(taskRegistry.supersedeTask('deepseek-runtime-superseded-parent', 'replacement required').success, true);
        assert.match(evaluateContinuationPolicy('deepseek-runtime-superseded-parent', 'deepseek-runtime-child', new Set(['deepseek-runtime-superseded-parent'])).error, /superseded/);
        await createDeepSeekReviewTask('deepseek-runtime-failed-parent');
        for (const status of ['SELECTED', 'PLANNED', 'EXECUTING', 'FAILED']) assert.equal((await taskRegistry.updateTaskStatus('deepseek-runtime-failed-parent', status)).success, true);
        assert.match(evaluateContinuationPolicy('deepseek-runtime-failed-parent', 'deepseek-runtime-child', new Set(['deepseek-runtime-failed-parent'])).error, /FAILED/);
        await createDeepSeekReviewTask('deepseek-runtime-blocked-parent');
        for (const status of ['SELECTED', 'PLANNED', 'EXECUTING', 'BLOCKED']) assert.equal((await taskRegistry.updateTaskStatus('deepseek-runtime-blocked-parent', status)).success, true);
        assert.match(evaluateContinuationPolicy('deepseek-runtime-blocked-parent', 'deepseek-runtime-child', new Set(['deepseek-runtime-blocked-parent'])).error, /BLOCKED/);
        await createDeepSeekReviewTask('deepseek-runtime-agent-report-parent');
        for (const status of ['SELECTED', 'PLANNED', 'EXECUTING']) assert.equal((await taskRegistry.updateTaskStatus('deepseek-runtime-agent-report-parent', status)).success, true);
        assert.equal((await taskRegistry.addEvidence('deepseek-runtime-agent-report-parent', 'AGENT_REPORT', 'Gemini Builder', { status: 'success' })).success, true);
        assert.match(evaluateContinuationPolicy('deepseek-runtime-agent-report-parent', 'deepseek-runtime-child', new Set(['deepseek-runtime-agent-report-parent'])).error, /COMPLETE/);
        assert.match(evaluateContinuationPolicy('deepseek-runtime-agent-report-parent', 'deepseek-runtime-child', new Set()).error, /prior get_task/);
        taskRegistry.resetRegistry();
    });

    await test('result classification is server-derived and only complete independently verified results are eligible', async () => {
        taskRegistry.resetRegistry();
        assert.deepEqual(classifyTaskResultForContinuation(null), {
            classification: 'invalid', eligible_for_next_decision: false, reason: 'Task result is invalid; continuation cannot proceed'
        });
        await createDeepSeekReviewTask('deepseek-runtime-result-incomplete');
        assert.equal(classifyTaskResultForContinuation(taskRegistry.getTask('deepseek-runtime-result-incomplete')).classification, 'incomplete');
        await completeDeepSeekReviewTask('deepseek-runtime-result-complete');
        const eligible = classifyTaskResultForContinuation(taskRegistry.getTask('deepseek-runtime-result-complete'));
        assert.deepEqual(eligible, { classification: 'eligible', eligible_for_next_decision: true, reason: null });
        const observed = new Map([['deepseek-runtime-result-complete', eligible]]);
        assert.equal(evaluateContinuationPolicy('deepseek-runtime-result-complete', 'deepseek-runtime-result-child', observed).valid, true);
        taskRegistry.getTask('deepseek-runtime-result-complete').status = 'FAILED';
        taskRegistry.persistCache();
        assert.match(evaluateContinuationPolicy('deepseek-runtime-result-complete', 'deepseek-runtime-result-child', observed).error, /FAILED/);
        taskRegistry.resetRegistry();
    });

    await test('coordination context resolution does not consume a turn without a dispatched continuation', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-context-parent';
        await completeDeepSeekReviewTask(parentRequestId);
        assert.deepEqual(taskRegistry.createCoordinationContext(parentRequestId, MAX_AUTONOMOUS_COORDINATION_TURNS).success, true);
        const client = { post: async () => providerResponse({ role: 'assistant', content: 'Validated coordination state.' }) };
        const first = await runDeepSeekConversation({ messages: [{ role: 'user', content: 'Continue.' }], env: env(), httpClient: client, coordinationContextId: parentRequestId });
        assert.equal(first.message.content, 'Validated coordination state.');
        assert.equal(taskRegistry.getTask(parentRequestId).coordination_context.autonomous_turns, 0);
        await runDeepSeekConversation({ messages: [{ role: 'user', content: 'Continue.' }], env: env(), httpClient: client, coordinationContextId: parentRequestId });
        assert.equal(taskRegistry.getTask(parentRequestId).coordination_context.autonomous_turns, 0);
        taskRegistry.resetRegistry();
    });

    await test('automatic workflow sequencing is derived from authoritative completed workflow state', async () => {
        taskRegistry.resetRegistry();
        await completeDeepSeekReviewTask('deepseek-runtime-sequence-review');
        assert.deepEqual(deriveNextWorkflowStep(taskRegistry.getTask('deepseek-runtime-sequence-review')), { valid: true, workflow_step: 'implementation' });
        await completeWorkflowTask('deepseek-runtime-sequence-implementation', 'implementation', 'BUILDER', 'deepseek-runtime-sequence-review');
        assert.deepEqual(deriveNextWorkflowStep(taskRegistry.getTask('deepseek-runtime-sequence-implementation')), { valid: true, workflow_step: 'verification' });
        await completeWorkflowTask('deepseek-runtime-sequence-verification', 'verification', 'VERIFY_RECONCILE', 'deepseek-runtime-sequence-implementation');
        assert.deepEqual(deriveNextWorkflowStep(taskRegistry.getTask('deepseek-runtime-sequence-verification')), { valid: true, workflow_step: 'reconciliation' });
        await completeWorkflowTask('deepseek-runtime-sequence-reconciliation', 'reconciliation', 'VERIFY_RECONCILE', 'deepseek-runtime-sequence-verification');
        assert.equal(deriveNextWorkflowStep(taskRegistry.getTask('deepseek-runtime-sequence-reconciliation')).terminal, true);
        taskRegistry.resetRegistry();
    });

    await test('authorized conversations automatically execute bounded state-driven coordination turns', async () => {
        taskRegistry.resetRegistry();
        const submitted = [];
        let modelCalls = 0;
        const client = { post: async (url, body) => {
            if (url === env().DEEPSEEK_COORDINATOR_URL) {
                submitted.push(body);
                await completeWorkflowTask(body.request_id, body.workflow_stage || null, body.task_mode, body.parent_request_id);
                return { data: { request_id: body.request_id, status: 'Task registered and dispatched' } };
            }
            modelCalls++;
            if (modelCalls === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'root', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) } }] });
            if (modelCalls === 2) {
                const context = taskRegistry.getTask(submitted[0].request_id).coordination_context;
                assert.equal(context.autonomous_turns, 0);
                assert.equal(context.current_request_id, submitted[0].request_id);
                return providerResponse({ role: 'assistant', content: 'Initial review completed.' });
            }
            if (modelCalls === 3) {
                const observation = body.messages.find(message => message.role === 'system' && message.content.includes('Server-derived coordination observation'));
                assert(observation, 'the next autonomous turn must receive a server-derived observation');
                assert.match(observation.content, /only server-authorized next workflow step is implementation/);
                return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'follow-up', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Implement coordinator workflow sequencing', parent_request_id: submitted[0].request_id, workflow_step: 'implementation' }) } }] });
            }
            if (modelCalls === 4) {
                const context = taskRegistry.getTask(submitted[0].request_id).coordination_context;
                assert.equal(context.autonomous_turns, 1);
                assert.equal(context.current_request_id, submitted[1].request_id);
                return providerResponse({ role: 'assistant', content: 'First continuation completed.' });
            }
            if (modelCalls === 5) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'second-follow-up', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Verify coordinator workflow sequencing', parent_request_id: submitted[1].request_id, workflow_step: 'verification' }) } }] });
            if (modelCalls === 6) {
                const context = taskRegistry.getTask(submitted[0].request_id).coordination_context;
                assert.equal(context.autonomous_turns, 2);
                assert.equal(context.current_request_id, submitted[2].request_id);
                return providerResponse({ role: 'assistant', content: 'Bounded coordination completed.' });
            }
            throw new Error('the exhausted durable coordination budget must prevent another model turn');
        }};

        const result = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Coordinate the approved review.' }], env: env(), httpClient: client,
            autonomousCoordination: true
        });
        assert.equal(result.message.content, 'Bounded coordination completed.');
        assert.equal(submitted.length, 3);
        assert.equal(submitted[1].parent_request_id, submitted[0].request_id);
        assert.equal(submitted[2].parent_request_id, submitted[1].request_id);
        assert.deepEqual(submitted.map(command => command.workflow_step || null), [null, 'implementation', 'verification']);
        const context = taskRegistry.getTask(submitted[0].request_id).coordination_context;
        assert.equal(context.context_id, submitted[0].request_id);
        assert.equal(context.root_request_id, submitted[0].request_id);
        assert.equal(context.current_request_id, submitted[2].request_id);
        assert.equal(context.autonomous_turns, MAX_AUTONOMOUS_COORDINATION_TURNS);
        assert.equal(taskRegistry.getTask(submitted[2].request_id).coordination_context, undefined);
        assert.equal(modelCalls, 6);
        assert.equal(MAX_TOOL_ITERATIONS, 3);
        taskRegistry.resetRegistry();
    });

    await test('a model cannot advance autonomous workflow sequencing with a policy-valid but non-derived step', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-sequence-authority';
        await completeDeepSeekReviewTask(parentRequestId);
        assert.equal(taskRegistry.createCoordinationContext(parentRequestId, MAX_AUTONOMOUS_COORDINATION_TURNS).success, true);
        const client = { post: async () => providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'wrong-step', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation', parent_request_id: parentRequestId, workflow_step: 'review' }) } }] }) };
        await assert.rejects(
            runDeepSeekConversation({ messages: [{ role: 'user', content: 'Continue.' }], env: env(), httpClient: client, coordinationContextId: parentRequestId }),
            error => error.code === 'CONTINUATION_POLICY_REJECTED' && /server-derived next workflow step/.test(error.message)
        );
        assert.equal(taskRegistry.getTasksByParent(parentRequestId).length, 0);
        assert.equal(taskRegistry.getTask(parentRequestId).coordination_context.autonomous_turns, 0);
        taskRegistry.resetRegistry();
    });

    await test('automatic coordination stops before a terminal or insufficiently verified predecessor can continue', async () => {
        taskRegistry.resetRegistry();
        let modelCalls = 0;
        const client = { post: async (url, body) => {
            if (url === env().DEEPSEEK_COORDINATOR_URL) {
                assert.equal((await taskRegistry.createTask(body)).success, true);
                return { data: { request_id: body.request_id, status: 'Task registered and dispatched' } };
            }
            modelCalls++;
            if (modelCalls === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'root', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) } }] });
            return providerResponse({ role: 'assistant', content: 'Awaiting independently verified evidence.' });
        }};
        const result = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Coordinate the approved review.' }], env: env(), httpClient: client,
            autonomousCoordination: true
        });
        assert.equal(result.message.content, 'Awaiting independently verified evidence.');
        assert.equal(modelCalls, 2, 'no autonomous model turn is allowed without required evidence');
        const [root] = [...taskRegistry.getAllTasks().values()];
        assert.equal(root.coordination_context.autonomous_turns, 0);
        taskRegistry.resetRegistry();
    });

    await test('coordination contexts fail closed for missing, stale, terminal, and mismatched lineage state', async () => {
        taskRegistry.resetRegistry();
        assert.throws(() => resolveCoordinationContext('deepseek-runtime-no-context'), /missing or invalid/);
        const failedId = 'deepseek-runtime-context-failed';
        await createDeepSeekReviewTask(failedId);
        for (const status of ['SELECTED', 'PLANNED', 'EXECUTING', 'FAILED']) assert.equal((await taskRegistry.updateTaskStatus(failedId, status)).success, true);
        assert.equal(taskRegistry.createCoordinationContext(failedId, MAX_AUTONOMOUS_COORDINATION_TURNS).success, true);
        assert.deepEqual(resolveCoordinationContext(failedId).terminal_outcome, {
            terminal: true, status: 'HUMAN_REVIEW', code: 'COORDINATION_ESCALATION_REQUIRED', reason: 'Workflow is failed'
        });
        const parentId = 'deepseek-runtime-context-lineage';
        await completeDeepSeekReviewTask(parentId);
        assert.equal(taskRegistry.createCoordinationContext(parentId, MAX_AUTONOMOUS_COORDINATION_TURNS).success, true);
        assert.equal((await taskRegistry.createTask({ request_id: 'deepseek-runtime-context-active-child', source: 'DeepSeek Runtime', target: 'Gemini', task: 'Child', repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', task_mode: 'REVIEW', constraints: { permitted_paths: ['poc/'] }, authorization: { capabilities: ['read_only'] }, verification: 'Review', reporting: 'structured-json', originator: 'Kyle', parent_request_id: parentId })).success, true);
        assert.throws(() => resolveCoordinationContext(parentId), /active child task/);
        taskRegistry.resetRegistry();
    });

    await test('server recognizes only a fully verified authoritative reconciliation lineage as complete', async () => {
        taskRegistry.resetRegistry();
        const reviewId = 'deepseek-runtime-terminal-review';
        const implementationId = 'deepseek-runtime-terminal-implementation';
        const verificationId = 'deepseek-runtime-terminal-verification';
        const reconciliationId = 'deepseek-runtime-terminal-reconciliation';
        await completeDeepSeekReviewTask(reviewId);
        await completeWorkflowTask(implementationId, 'implementation', 'BUILDER', reviewId);
        await completeWorkflowTask(verificationId, 'verification', 'VERIFY_RECONCILE', implementationId);
        await completeWorkflowTask(reconciliationId, 'reconciliation', 'VERIFY_RECONCILE', verificationId);
        assert.equal(taskRegistry.createCoordinationContext(reviewId, MAX_AUTONOMOUS_COORDINATION_TURNS).success, true);
        assert.equal(taskRegistry.setCoordinationContextCurrent(reviewId, reconciliationId).success, true);
        const context = resolveCoordinationContext(reviewId);
        assert.equal(context.terminal_outcome.status, 'COMPLETE');
        const result = await runDeepSeekConversation({ messages: [{ role: 'user', content: 'The model says complete.' }], env: env(), coordinationContextId: reviewId });
        assert.equal(result.terminal_outcome.code, 'COORDINATION_WORKFLOW_COMPLETE');
        assert.equal(result.iterations, 0, 'the model cannot declare or drive terminal completion');

        taskRegistry.getTask(reconciliationId).evidence = [];
        taskRegistry.persistCache();
        assert.equal(evaluateCoordinationTerminalOutcome(taskRegistry.getTask(reviewId).coordination_context, taskRegistry.getTask(reconciliationId)).status, 'HUMAN_REVIEW');
        taskRegistry.resetRegistry();
    });

    await test('submitted task correlation is returned only from the existing get_task observation result', async () => {
        let requestId;
        let resultContext;
        let modelCalls = 0;
        const client = { post: async (url, body) => {
            if (url === env().DEEPSEEK_COORDINATOR_URL) {
                requestId = body.request_id;
                const created = (await taskRegistry.createTask(body));
                assert.equal(created.success, true);
                return { data: { request_id: requestId, status: 'Task registered and dispatched' } };
            }
            modelCalls++;
            if (modelCalls === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'request', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' }) } }] });
            if (modelCalls === 2) {
                return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'observe', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'get_task', request_id: requestId }) } }] });
            }
            const resultMessage = body.messages.filter(message => message.role === 'tool').pop();
            assert(resultMessage);
            resultContext = JSON.parse(resultMessage.content);
            return providerResponse({ role: 'assistant', content: 'Observed the submitted task.' });
        }};
        taskRegistry.resetRegistry();
        const result = await runDeepSeekConversation({ messages: [{ role: 'user', content: 'Review the coordinator.' }], env: env(), httpClient: client });
        assert.equal(result.message.content, 'Observed the submitted task.');
        assert.equal(resultContext.task.request_id, requestId);
        assert.equal(resultContext.continuation.submitted_in_this_execution, true);
        assert.equal(resultContext.continuation.eligible_for_next_decision, false);
        assert.equal(resultContext.continuation.classification, 'incomplete');
        assert.equal(resultContext.task.authorization, undefined);
        taskRegistry.resetRegistry();
    });

    await test('Phase 3 bounded coordination contexts preserve the coordinator contract, authority, and ACP-owned verification', async () => {
        assert.equal(DEEPSEEK_COORDINATOR_POLICY.phase, 'Phase 3 — Autonomous Coordination Loop (first bounded increment)');
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.model_operations, ['request_task', 'get_task']);
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.capabilities, ['read_only']);
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.permitted_paths, ['poc/']);
        assert.equal(DEEPSEEK_COORDINATOR_POLICY.server_derived_authority.authentication_context, 'server-held coordinator secret');
        assert.equal(DEEPSEEK_COORDINATOR_POLICY.authorization_boundary.authority, 'ACP and Kyle');
        assert(DEEPSEEK_COORDINATOR_POLICY.authorization_boundary.excluded_capabilities.includes('push'));
        assert.match(DEEPSEEK_COORDINATOR_POLICY.state_semantics.independent_verification, /ACP lifecycle/);
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.state_semantics.lifecycle_states, ACP_LIFECYCLE_STATES);
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.state_semantics.lineage_control_semantics, LINEAGE_CONTROL_SEMANTICS);
        assert.equal(ACP_LIFECYCLE_STATES.includes('CANCELLED'), false);
        assert.equal(ACP_LIFECYCLE_STATES.includes('SUPERSEDED'), false);
        assert.equal(DEEPSEEK_COORDINATOR_POLICY.continuation.required_parent_status, 'COMPLETE');
        assert.equal(DEEPSEEK_COORDINATOR_POLICY.continuation.required_evidence, 'INDEPENDENT_VERIFICATION');
        assert.equal(DEEPSEEK_COORDINATOR_POLICY.observation.max_child_tasks, MAX_CHILD_TASK_OBSERVATIONS);
        assert.equal(MAX_TOOL_ITERATIONS, 3);
        assert.equal(MAX_AUTONOMOUS_COORDINATION_TURNS, 2);
    });

    await test('server enforces exactly three maximum control-plane tool iterations', async () => {
        const toolCall = id => providerResponse({ role: 'assistant', content: null, tool_calls: [{
            id: `call-${id}`, type: 'function', function: {
                name: 'control_plane',
                arguments: JSON.stringify({ operation: 'get_task', request_id: `deepseek-runtime-missing-${id}` })
            }
        }] });
        let calls = 0;
        const withinLimit = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Observe three tasks.' }], env: env(),
            httpClient: { post: async () => {
                calls++;
                return calls <= MAX_TOOL_ITERATIONS ? toolCall(calls) : providerResponse({ role: 'assistant', content: 'Stopped.' });
            } }
        });
        assert.equal(withinLimit.iterations, MAX_TOOL_ITERATIONS);
        calls = 0;
        await assert.rejects(() => runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Attempt four observations.' }], env: env(),
            httpClient: { post: async () => toolCall(++calls) }
        }), error => error.code === 'TOOL_LOOP_BLOCKED');
    });

    await test('tool contract exposes only intent-level fields', async () => {
        const properties = CONTROL_PLANE_TOOL.function.parameters.properties;
        for (const forbidden of ['capabilities', 'permitted_paths', 'authorization', 'repository', 'base_branch', 'target', 'task_mode']) assert.equal(properties[forbidden], undefined);
        assert(properties.parent_request_id);
        assert.deepEqual(DEEPSEEK_COORDINATOR_POLICY.request_task.prohibited_authority_fields, ['target', 'repository', 'base_branch', 'task_mode', 'capabilities', 'permitted_paths', 'authorization', 'commit', 'push']);
    });

    await test('arbitrary authority fields are rejected instead of influencing ACP', async () => {
        assert.throws(() => buildControlPlaneCommand({ operation: 'request_task', objective: 'x', capabilities: ['push'] }), /not permitted/);
    });

    await test('model-selected target and unsupported operations fail closed', async () => {
        assert.throws(() => buildControlPlaneCommand({ operation: 'request_task', objective: 'x', target: 'Kilo' }), /not permitted/);
        assert.throws(() => buildControlPlaneCommand({ operation: 'execute', objective: 'x' }), /not permitted/);
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
            await assert.rejects(() => runDeepSeekConversation({ messages: [{ role: 'user', content: 'Review coordinator contract' }], env: env(), httpClient: client }), error => error.code === code && !error.message.includes('sensitive') && error.diagnostics === undefined);
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
        const input = { messages: [{ role: 'user', content: 'Review coordinator contract' }] };
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
            { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'request_task', objective: 'Check calendar' }) } }] },
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

    await test('streaming request returns an OpenAI-compatible SSE completion for ChatBox', async () => {
        const app = express();
        app.use(express.json());
        app.post('/poc/deepseek-runtime', createDeepSeekRuntimeHandler({
            env: env(),
            httpClient: { post: async () => providerResponse({ role: 'assistant', content: "Pong! 🏓 I'm here and ready. What can I help you with?" }) }
        }));
        const server = await new Promise(resolve => {
            const instance = app.listen(3012, () => resolve(instance));
        });
        try {
            const response = await rawRequest(3012, { Accept: 'text/event-stream' }, {
                model: 'deepseek/deepseek-v4-flash',
                messages: [{ role: 'user', content: 'Ping.' }],
                stream: true
            });
            assert.equal(response.status, 200);
            assert.match(response.headers['content-type'], /^text\/event-stream/);
            const events = response.body.trim().split('\n\n');
            assert.equal(events.at(-1), 'data: [DONE]');
            const chunks = events.slice(0, -1).map(event => JSON.parse(event.slice('data: '.length)));
            const content = chunks.map(chunk => chunk.choices[0].delta.content || '').join('');
            assert.equal(content, "Pong! 🏓 I'm here and ready. What can I help you with?");
            assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    await test('non-streaming request retains the JSON response contract', async () => {
        const response = {};
        const handler = createDeepSeekRuntimeHandler({
            env: env(),
            httpClient: { post: async () => providerResponse({ role: 'assistant', content: 'ordinary JSON response' }) }
        });
        await handler({ body: { messages: [{ role: 'user', content: 'hello' }] } }, {
            status: code => {
                response.status = code;
                return { json: body => { response.body = body; } };
            }
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.choices[0].message.content, 'ordinary JSON response');
        assert.equal(response.body.tool_iterations, 0);
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
            { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'get_task', request_id: 'deepseek-runtime-non-existent-task' }) } }] }
        ];
        const result = await runDeepSeekConversation({ messages: conversation, env: env(), httpClient: client });
        assert.equal(coordinatorCalled, false);
        assert.equal(result.message.content, 'done');
    });

    await test('get_task operation retrieves task metadata and status when task exists in taskRegistry', async () => {
        const requestId = 'deepseek-runtime-test-1';
        (await taskRegistry.createTask({
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
        }));

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

    await test('child-task summary aggregates all authoritative lifecycle states without exposing child data', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-child-summary-parent';
        await createDeepSeekReviewTask(parentRequestId);
        const statuses = ['PENDING', 'SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE', 'FAILED', 'BLOCKED'];
        const childIds = [];
        for (let index = 0; index < MAX_CHILD_TASK_OBSERVATIONS + statuses.length; index++) {
            const requestId = `deepseek-runtime-child-summary-${index}`;
            childIds.push(requestId);
            await createDeepSeekReviewTask(requestId);
            taskRegistry.getTask(requestId).parent_request_id = parentRequestId;
            const status = statuses[index % statuses.length];
            const transitions = {
                PENDING: [], SELECTED: ['SELECTED'], PLANNED: ['SELECTED', 'PLANNED'],
                EXECUTING: ['SELECTED', 'PLANNED', 'EXECUTING'],
                VERIFIED: ['SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED'],
                COMPLETE: ['SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE'],
                FAILED: ['SELECTED', 'PLANNED', 'EXECUTING', 'FAILED'],
                BLOCKED: ['SELECTED', 'PLANNED', 'EXECUTING', 'BLOCKED']
            };
            if (status === 'VERIFIED' || status === 'COMPLETE') {
                assert.equal((await taskRegistry.addEvidence(requestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' })).success, true);
            }
            for (const transition of transitions[status]) assert.equal((await taskRegistry.updateTaskStatus(requestId, transition)).success, true);
        }
        await createDeepSeekReviewTask('deepseek-runtime-child-summary-unrelated');
        const observation = observeTaskForDeepSeek(parentRequestId, new Set(), new Map());
        const summary = observation.task.child_tasks_summary;

        assert.deepEqual(Object.keys(summary).sort(), ['blocked', 'complete', 'executing', 'failed', 'pending', 'planned', 'selected', 'total', 'verified']);
        assert.deepEqual(summary, { total: childIds.length, pending: 3, selected: 3, planned: 2, executing: 2, verified: 2, complete: 2, failed: 2, blocked: 2 });
        assert.equal(observation.task.child_tasks.length, MAX_CHILD_TASK_OBSERVATIONS);
        assert.equal(observation.task.child_tasks.some(child => child.request_id === 'deepseek-runtime-child-summary-unrelated'), false);
        assert.equal(JSON.stringify(summary).includes(childIds[0]), false);
        assert.equal(JSON.stringify(summary).includes('authorization'), false);
        taskRegistry.resetRegistry();
    });

    await test('parent tasks without children omit the child-task summary', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-child-summary-empty-parent';
        await createDeepSeekReviewTask(parentRequestId);
        const observation = observeTaskForDeepSeek(parentRequestId, new Set(), new Map());
        assert.equal(observation.task.child_tasks, undefined);
        assert.equal(observation.task.child_tasks_summary, undefined);
        assert.equal(observation.task.child_diagnostics_summary, undefined);
        assert.equal(observation.task.workflow_completion_summary, undefined);
        taskRegistry.resetRegistry();
    });

    await test('child diagnostic summary aggregates all children with bounded sanitized status-scoped highlights', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-child-diagnostics-parent';
        await createDeepSeekReviewTask(parentRequestId);
        const createChild = (requestId, status, report) => {
            await createDeepSeekReviewTask(requestId);
            taskRegistry.getTask(requestId).parent_request_id = parentRequestId;
            if (report) assert.equal((await taskRegistry.updateAgentResult(requestId, 'Gemini Builder', {
                status: status === 'FAILED' ? 'failure' : 'blocked', execution_id: `${requestId}-execution`, report
            })).success, true);
            const transitions = status === 'FAILED' || status === 'BLOCKED'
                ? ['SELECTED', 'PLANNED', 'EXECUTING', status]
                : status === 'VERIFIED' ? ['SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED']
                    : status === 'COMPLETE' ? ['SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE'] : [];
            if (status === 'VERIFIED' || status === 'COMPLETE') {
                assert.equal((await taskRegistry.addEvidence(requestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' })).success, true);
            }
            for (const transition of transitions) assert.equal((await taskRegistry.updateTaskStatus(requestId, transition)).success, true);
        };
        for (let index = 0; index < MAX_CHILD_TASK_OBSERVATIONS; index++) createChild(`deepseek-runtime-child-diagnostics-normal-${index}`, 'PENDING');
        createChild('deepseek-runtime-child-diagnostics-verified', 'VERIFIED');
        createChild('deepseek-runtime-child-diagnostics-complete', 'COMPLETE');
        for (let index = 0; index < MAX_REPORT_HIGHLIGHTS + 1; index++) {
            createChild(`deepseek-runtime-child-diagnostics-failed-${index}`, 'FAILED', {
                summary: `Failure ${index}: token failure-token-${index}`, blockers: [`failure blocker ${index}`], authorization: 'Bearer hidden'
            });
        }
        for (let index = 0; index < 2; index++) {
            createChild(`deepseek-runtime-child-diagnostics-blocked-${index}`, 'BLOCKED', {
                summary: `Blocked ${index}: credential blocked-credential-${index}`, blockers: [`blocker ${index}`], permitted_paths: ['hidden']
            });
        }
        await createDeepSeekReviewTask('deepseek-runtime-child-diagnostics-unrelated');
        const unrelated = taskRegistry.getTask('deepseek-runtime-child-diagnostics-unrelated');
        assert.equal((await taskRegistry.updateAgentResult(unrelated.request_id, 'Gemini Builder', {
            status: 'failure', execution_id: 'unrelated-execution', report: { summary: 'Unrelated failure' }
        })).success, true);
        for (const transition of ['SELECTED', 'PLANNED', 'EXECUTING', 'FAILED']) assert.equal((await taskRegistry.updateTaskStatus(unrelated.request_id, transition)).success, true);

        const observation = observeTaskForDeepSeek(parentRequestId, new Set(), new Map());
        const diagnostics = observation.task.child_diagnostics_summary;
        assert.equal(observation.task.child_tasks.length, MAX_CHILD_TASK_OBSERVATIONS);
        assert.deepEqual(observation.task.child_tasks_summary, { total: MAX_CHILD_TASK_OBSERVATIONS + 2 + MAX_REPORT_HIGHLIGHTS + 3, pending: MAX_CHILD_TASK_OBSERVATIONS, selected: 0, planned: 0, executing: 0, verified: 1, complete: 1, failed: MAX_REPORT_HIGHLIGHTS + 1, blocked: 2 });
        assert.deepEqual(Object.keys(diagnostics).sort(), ['blocked', 'blocker_highlights', 'failed', 'failure_highlights']);
        assert.equal(diagnostics.failed, MAX_REPORT_HIGHLIGHTS + 1);
        assert.equal(diagnostics.blocked, 2);
        assert.equal(diagnostics.failure_highlights.length, MAX_REPORT_HIGHLIGHTS);
        assert.equal(diagnostics.blocker_highlights.length, MAX_REPORT_HIGHLIGHTS);
        assert(diagnostics.failure_highlights.every(highlight => highlight.source === 'agent_commentary' && highlight.text.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
        assert(diagnostics.blocker_highlights.every(highlight => highlight.source === 'agent_commentary' && highlight.text.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
        assert.equal(JSON.stringify(diagnostics).includes('failure-token'), false);
        assert.equal(JSON.stringify(diagnostics).includes('blocked-credential'), false);
        assert.equal(JSON.stringify(diagnostics).includes('hidden'), false);
        assert.equal(JSON.stringify(diagnostics).includes('permitted_paths'), false);
        taskRegistry.resetRegistry();
    });

    await test('parents with non-diagnostic children omit child diagnostic summary', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-child-diagnostics-non-terminal-parent';
        await createDeepSeekReviewTask(parentRequestId);
        await createDeepSeekReviewTask('deepseek-runtime-child-diagnostics-pending');
        taskRegistry.getTask('deepseek-runtime-child-diagnostics-pending').parent_request_id = parentRequestId;
        const observation = observeTaskForDeepSeek(parentRequestId, new Set(), new Map());
        assert(observation.task.child_tasks_summary);
        assert.equal(observation.task.child_diagnostics_summary, undefined);
        assert.equal(observation.task.workflow_completion_summary, undefined);
        taskRegistry.resetRegistry();
    });

    await test('workflow completion summary reports all-success terminal workflows with bounded sanitized highlights', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-workflow-success-parent';
        await createDeepSeekReviewTask(parentRequestId);
        for (let index = 0; index < MAX_REPORT_HIGHLIGHTS + 1; index++) {
            const childRequestId = `deepseek-runtime-workflow-success-${index}`;
            await completeDeepSeekReviewTask(childRequestId);
            const child = taskRegistry.getTask(childRequestId);
            child.parent_request_id = parentRequestId;
            assert.equal((await taskRegistry.updateAgentResult(childRequestId, 'Gemini Builder', {
                status: 'success', execution_id: `${childRequestId}-execution`,
                report: { summary: `Completed ${index}: token completion-token-${index}`, authorization: 'Bearer hidden' }
            })).success, true);
        }
        const observation = observeTaskForDeepSeek(parentRequestId, new Set(), new Map());
        const summary = observation.task.workflow_completion_summary;
        assert.deepEqual(summary.terminal_state_counts, { complete: MAX_REPORT_HIGHLIGHTS + 1, failed: 0, blocked: 0, cancelled: 0, superseded: 0 });
        assert.equal(summary.outcome, 'ALL_SUCCESS');
        assert.equal(summary.total_children, MAX_REPORT_HIGHLIGHTS + 1);
        assert.equal(summary.completion_highlights.length, MAX_REPORT_HIGHLIGHTS);
        assert(summary.completion_highlights.every(highlight => highlight.source === 'agent_commentary' && highlight.text.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
        assert.equal(JSON.stringify(summary).includes('completion-token'), false);
        assert.equal(JSON.stringify(summary).includes('hidden'), false);
        taskRegistry.resetRegistry();
    });

    await test('workflow completion summary distinguishes mixed, failed, blocked, and cancelled registry outcomes', async () => {
        const observeTerminalWorkflow = (suffix, statuses) => {
            taskRegistry.resetRegistry();
            const parentRequestId = `deepseek-runtime-workflow-${suffix}-parent`;
            await createDeepSeekReviewTask(parentRequestId);
            for (const [index, status] of statuses.entries()) {
                const childRequestId = `deepseek-runtime-workflow-${suffix}-${index}`;
                await createDeepSeekReviewTask(childRequestId);
                const child = taskRegistry.getTask(childRequestId);
                child.parent_request_id = parentRequestId;
                if (status === 'COMPLETE') {
                    assert.equal((await taskRegistry.addEvidence(childRequestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' })).success, true);
                    for (const state of ['SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE']) assert.equal((await taskRegistry.updateTaskStatus(childRequestId, state)).success, true);
                } else if (status === 'CANCELLED') {
                    child.lineage.cancelled = true;
                } else if (status === 'SUPERSEDED') {
                    child.lineage.superseded_by = `${childRequestId}-replacement`;
                } else {
                    for (const state of ['SELECTED', 'PLANNED', 'EXECUTING', status]) assert.equal((await taskRegistry.updateTaskStatus(childRequestId, state)).success, true);
                }
            }
            return observeTaskForDeepSeek(parentRequestId, new Set(), new Map()).task.workflow_completion_summary;
        };
        const mixed = observeTerminalWorkflow('mixed', ['COMPLETE', 'FAILED', 'BLOCKED']);
        assert.equal(mixed.outcome, 'PARTIAL_SUCCESS');
        assert.deepEqual(mixed.terminal_state_counts, { complete: 1, failed: 1, blocked: 1, cancelled: 0, superseded: 0 });
        assert.equal(observeTerminalWorkflow('failed', ['FAILED']).outcome, 'FAILED');
        assert.equal(observeTerminalWorkflow('blocked', ['BLOCKED']).outcome, 'BLOCKED');
        const cancelled = observeTerminalWorkflow('cancelled', ['CANCELLED', 'SUPERSEDED']);
        assert.equal(cancelled.outcome, 'MIXED_TERMINAL');
        assert.deepEqual(cancelled.terminal_state_counts, { complete: 0, failed: 0, blocked: 0, cancelled: 1, superseded: 1 });
        taskRegistry.resetRegistry();
    });

    await test('workflow completion summary aggregates terminal children beyond the detailed observation cap', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-workflow-cap-parent';
        await createDeepSeekReviewTask(parentRequestId);
        for (let index = 0; index < MAX_CHILD_TASK_OBSERVATIONS + 1; index++) {
            const childRequestId = `deepseek-runtime-workflow-cap-${index}`;
            await createDeepSeekReviewTask(childRequestId);
            taskRegistry.getTask(childRequestId).parent_request_id = parentRequestId;
            const status = index === MAX_CHILD_TASK_OBSERVATIONS ? 'FAILED' : 'COMPLETE';
            if (status === 'COMPLETE') {
                assert.equal((await taskRegistry.addEvidence(childRequestId, 'INDEPENDENT_VERIFICATION', 'Gemini', { status: 'success' })).success, true);
                for (const state of ['SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE']) assert.equal((await taskRegistry.updateTaskStatus(childRequestId, state)).success, true);
            } else {
                for (const state of ['SELECTED', 'PLANNED', 'EXECUTING', 'FAILED']) assert.equal((await taskRegistry.updateTaskStatus(childRequestId, state)).success, true);
            }
        }
        const observation = observeTaskForDeepSeek(parentRequestId, new Set(), new Map());
        assert.equal(observation.task.child_tasks.length, MAX_CHILD_TASK_OBSERVATIONS);
        assert.equal(observation.task.workflow_completion_summary.outcome, 'PARTIAL_SUCCESS');
        assert.deepEqual(observation.task.workflow_completion_summary.terminal_state_counts, { complete: MAX_CHILD_TASK_OBSERVATIONS, failed: 1, blocked: 0, cancelled: 0, superseded: 0 });
        taskRegistry.resetRegistry();
    });

    await test('get_task includes bounded sanitized child observations without changing continuation authority', async () => {
        taskRegistry.resetRegistry();
        const parentRequestId = 'deepseek-runtime-lineage-parent';
        await createDeepSeekReviewTask(parentRequestId);
        const childIds = [];
        for (let index = 0; index < MAX_CHILD_TASK_OBSERVATIONS + 1; index++) {
            const requestId = `deepseek-runtime-lineage-child-${index}`;
            childIds.push(requestId);
            assert.equal((await taskRegistry.createTask({
                request_id: requestId, source: 'DeepSeek Runtime', target: 'Gemini', task: `Child review ${index}`,
                repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', task_mode: 'REVIEW',
                constraints: { permitted_paths: ['poc/'] }, authorization: { capabilities: ['read_only'] }, verification: 'Review',
                originator: 'Kyle'
            })).success, true);
            taskRegistry.getTask(requestId).parent_request_id = parentRequestId;
        }
        assert.equal((await taskRegistry.createTask({
            request_id: 'deepseek-runtime-unrelated-task', source: 'DeepSeek Runtime', target: 'Gemini', task: 'Unrelated review',
            repository: 'fluentwithkyle/openclaw-webhook', base_branch: 'main', task_mode: 'REVIEW',
            constraints: { permitted_paths: ['poc/'] }, authorization: { capabilities: ['read_only'] }, verification: 'Review', originator: 'Kyle'
        })).success, true);
        assert.equal((await taskRegistry.updateAgentResult(childIds[0], 'Gemini', {
            status: 'success', execution_id: 'child-execution', report: { summary: 'verified', token: 'hidden', authorization: 'Bearer hidden' }
        })).success, true);
        assert.equal((await taskRegistry.addEvidence(childIds[0], 'INDEPENDENT_VERIFICATION', 'Gemini', { summary: 'verified', secret: 'hidden' })).success, true);
        for (const [index, status] of ['FAILED', 'BLOCKED'].entries()) {
            for (const transition of ['SELECTED', 'PLANNED', 'EXECUTING', status]) assert.equal((await taskRegistry.updateTaskStatus(childIds[index + 1], transition)).success, true);
        }
        assert.equal((await taskRegistry.updateAgentResult(childIds[1], 'Gemini Builder', {
            status: 'failure', execution_id: 'child-failure', report: { summary: 'Child failure token child-token', blockers: ['Child failure blocker'] }
        })).success, true);
        assert.equal((await taskRegistry.updateAgentResult(childIds[2], 'Gemini Builder', {
            status: 'blocked', execution_id: 'child-blocked', report: { summary: 'Child blocked', blockers: ['Child blocker'] }
        })).success, true);
        taskRegistry.getTask(childIds[3]).lineage.cancelled = true;
        taskRegistry.getTask(childIds[4]).lineage.superseded_by = 'deepseek-runtime-lineage-replacement';
        taskRegistry.persistCache();

        let observation;
        let calls = 0;
        const result = await runDeepSeekConversation({
            messages: [{ role: 'user', content: 'Observe parent lineage.' }], env: env(),
            httpClient: { post: async (url, body) => {
                if (url === env().DEEPSEEK_COORDINATOR_URL) throw new Error('get_task must not dispatch');
                calls++;
                if (calls === 1) return providerResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'observe-parent', type: 'function', function: { name: 'control_plane', arguments: JSON.stringify({ operation: 'get_task', request_id: parentRequestId }) } }] });
                observation = JSON.parse(body.messages.find(message => message.role === 'tool').content);
                return providerResponse({ role: 'assistant', content: 'Observed child tasks.' });
            } }
        });

        assert.equal(result.message.content, 'Observed child tasks.');
        assert.equal(observation.task.child_tasks.length, MAX_CHILD_TASK_OBSERVATIONS);
        assert.deepEqual(observation.task.child_tasks_summary, { total: MAX_CHILD_TASK_OBSERVATIONS + 1, pending: MAX_CHILD_TASK_OBSERVATIONS - 1, selected: 0, planned: 0, executing: 0, verified: 0, complete: 0, failed: 1, blocked: 1 });
        assert.deepEqual(observation.task.child_tasks.map(child => child.request_id), childIds.slice(0, MAX_CHILD_TASK_OBSERVATIONS));
        assert.equal(observation.task.child_tasks.some(child => child.request_id === 'deepseek-runtime-unrelated-task'), false);
        assert.deepEqual(observation.task.child_tasks[0].lineage, { parent_request_id: parentRequestId, superseded_by: null, cancelled: false });
        assert.equal(observation.task.child_tasks[0].execution.gemini.result.token, undefined);
        assert.equal(observation.task.child_tasks[0].execution.gemini.result.authorization, undefined);
        assert(observation.task.child_tasks[0].verification.independent_verification.length >= 1);
        assert.equal(JSON.stringify(observation.task.child_tasks[0]).includes('hidden'), false);
        assert.deepEqual(observation.task.child_tasks.slice(1, 5).map(child => child.lifecycle.status), ['FAILED', 'BLOCKED', 'PENDING', 'PENDING']);
        assert.equal(observation.task.child_tasks[1].failure_summary.observed_facts.report_counts[0].blockers, 1);
        assert.equal(observation.task.child_tasks[1].blocked_summary, null);
        assert.equal(observation.task.child_tasks[2].blocked_summary.observed_facts.report_counts[0].blockers, 1);
        assert.equal(observation.task.child_tasks[2].failure_summary, null);
        assert.equal(observation.task.child_tasks[3].lineage.cancelled, true);
        assert.equal(observation.task.child_tasks[4].lineage.superseded_by, 'deepseek-runtime-lineage-replacement');
        assert.equal(observation.continuation.eligible_for_next_decision, false);
        taskRegistry.resetRegistry();
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
                                arguments: JSON.stringify({ operation: 'request_task', objective: 'Research Phase 4 design and cross-task lineage navigation' })
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
        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: ' deepseek-runtime-12345' }), /not permitted/);
        assert.throws(() => validateGetTaskArguments({ operation: 'get_task', request_id: 'deepseek-runtime-12345 ' }), /not permitted/);
    });

    await test('get_task operation returns allowlisted sanitized projection excluding secrets and internal fields', async () => {
        const requestId = 'deepseek-runtime-sec-test-1';
        (await taskRegistry.createTask({
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
        }));

        (await taskRegistry.updateAgentResult(requestId, 'Gemini', {
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
        }));

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
        assert.equal(projectedTask.task, 'Security test task');
        assert.equal(projectedTask.lifecycle.status, 'PENDING');
        assert.equal(projectedTask.lifecycle.execution_completed, true);
        assert.equal(projectedTask.lifecycle.verified_outcome, false);
        assert.equal(projectedTask.agents.current, null);
        assert.equal(projectedTask.agents.next, null);
        assert.equal(projectedTask.next_action, null);
        assert(projectedTask.created_at);
        assert(projectedTask.updated_at);
        assert(projectedTask.execution.gemini);
        assert.equal(projectedTask.execution.gemini.status, 'success');
        assert.equal(projectedTask.execution.gemini.execution_id, 'gemini-exec-1');

        const report = projectedTask.execution.gemini.result;
        assert.equal(report.apiKey, undefined);
        assert.equal(report.authorization, undefined);
        assert.equal(report.nested, null);

        assert(projectedTask.execution.kilo);
        assert.equal(projectedTask.constraints, undefined);
        assert.equal(projectedTask.authorization, undefined);
        assert.equal(projectedTask.child_tasks, undefined);
        assert.deepEqual(projectedTask.lineage, { parent_request_id: null, superseded_by: null, cancelled: false });
    });

    await test('structured evidence summary preserves bounded, sanitized facts and clearly labeled specialist commentary', async () => {
        const task = {
            request_id: 'deepseek-runtime-structured-evidence', task: 'Review specialist results', status: 'BLOCKED',
            current_agent: null, next_agent: null, next_action: 'human_review', verification: 'Independent verification required',
            kilo: { status: 'success', execution_id: 'kilo-1', report: { summary: 'Kilo report', verification: ['unit tests', 'lint'], blockers: [], changed_files: ['a.js'] } },
            builder: { status: 'failure', execution_id: 'builder-1', report: { summary: 'Builder failed', verification: [], blockers: ['Recorded build failure'] } },
            gemini: { status: 'success', execution_id: 'gemini-1', report: { summary: 'Gemini reviewed', verification: ['review'] } },
            evidence: [
                { evidence_type: 'INDEPENDENT_VERIFICATION', agent: 'Gemini Reviewer', verification_result: 'success', report: { summary: 'Reviewer verified', verification: ['review check'] } },
                { evidence_type: 'AGENT_REPORT', agent: 'Security Specialist', verification_result: 'blocked', report: { summary: 'Security finding Bearer secret-value', blockers: ['Recorded security blocker'], token: 'hidden' } },
                { evidence_type: 'AGENT_REPORT', agent: 'Utility Specialist', report: { summary: 'Utility check complete', verification: ['format check'] } }
            ]
        };
        const projection = projectTaskForDeepSeek(task);
        const summary = projection.evidence_summary;
        assert.deepEqual(summary.observed_facts.execution, [
            { agent: 'kilo', status: 'success' }, { agent: 'builder', status: 'failure' }, { agent: 'gemini', status: 'success' }
        ]);
        assert.deepEqual(summary.observed_facts.independent_verification, { count: 1, outcomes: [{ agent: 'Gemini Reviewer', status: 'success' }] });
        assert.deepEqual(summary.observed_facts.report_counts[0], { agent: 'kilo', verification: 2, blockers: 0, changed_files: 1 });
        assert.equal(summary.agent_commentary.report_highlights.length, MAX_REPORT_HIGHLIGHTS);
        assert(summary.agent_commentary.report_highlights.every(highlight => highlight.source === 'agent_commentary'));
        assert(summary.agent_commentary.report_highlights.every(highlight => highlight.text.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
        assert.equal(JSON.stringify(summary).includes('secret-value'), false);
        assert.equal(projection.execution.kilo.result.summary, 'Kilo report');
        assert.equal(projection.failure, null);
        assert.equal(projection.blocked.status, 'BLOCKED');

        const missing = projectTaskForDeepSeek({ request_id: 'deepseek-runtime-missing-evidence', task: 'Unknown', status: 'PENDING', evidence: [] });
        assert.equal(missing.evidence_summary, null);
    });

    await test('verification and reconciliation summary exposes only bounded sanitized recorded facts', async () => {
        const longSummary = `Reconciled token reconciliation-token ${'x'.repeat(MAX_REPORT_HIGHLIGHT_LENGTH + 20)}`;
        const task = {
            request_id: 'deepseek-runtime-verification-reconciliation', task: 'Observe verification', status: 'EXECUTING', evidence: [
                { evidence_type: 'INDEPENDENT_VERIFICATION', agent: 'Gemini Reviewer', verification_result: 'authorization verification-token', report: { summary: longSummary } },
                { evidence_type: 'AGENT_REPORT', agent: 'Evidence Agent', report: { summary: 'Evidence reconciliation Bearer evidence-secret', reconciliation: { status: 'COMPLETED', changed_files: ['one.js'], token: 'hidden' } } }
            ],
            builder: { status: 'success', report: { summary: longSummary, reconciliation: { status: 'SKIPPED', changed_files: ['two.js', 'three.js'], authorization: 'Bearer hidden' } } }
        };
        const projection = projectTaskForDeepSeek(task);
        const summary = projection.verification_reconciliation_summary;
        assert.deepEqual(summary.observed_facts.independent_verification, {
            evidence_count: 1,
            outcomes: [{ agent: 'Gemini Reviewer', status: 'authorization [REDACTED]' }]
        });
        assert.deepEqual(summary.observed_facts.reconciliation, {
            count: 2,
            outcomes: [
                { agent: 'builder', status: 'SKIPPED', changed_files: 2 },
                { agent: 'Evidence Agent', status: 'COMPLETED', changed_files: 1 }
            ]
        });
        assert.equal(summary.agent_commentary.reconciliation_highlights.length, MAX_REPORT_HIGHLIGHTS > 1 ? 2 : 1);
        assert(summary.agent_commentary.reconciliation_highlights.every(highlight => highlight.source === 'agent_commentary' && highlight.text.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
        assert.equal(JSON.stringify(summary).includes('reconciliation-token'), false);
        assert.equal(JSON.stringify(summary).includes('evidence-secret'), false);
        assert.equal(JSON.stringify(summary).includes('hidden'), false);

        const bounded = projectTaskForDeepSeek({
            request_id: 'deepseek-runtime-bounded-verification', task: 'Observe', status: 'PENDING',
            evidence: Array.from({ length: MAX_REPORT_HIGHLIGHTS + 1 }, (_, index) => ({
                evidence_type: 'INDEPENDENT_VERIFICATION', agent: `Reviewer ${index}`, verification_result: `success ${'x'.repeat(MAX_REPORT_HIGHLIGHT_LENGTH + 1)}`
            }))
        }).verification_reconciliation_summary;
        assert.equal(bounded.observed_facts.independent_verification.evidence_count, MAX_REPORT_HIGHLIGHTS + 1);
        assert.equal(bounded.observed_facts.independent_verification.outcomes.length, MAX_REPORT_HIGHLIGHTS);
        assert(bounded.observed_facts.independent_verification.outcomes.every(outcome => outcome.status.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
    });

    await test('verification and reconciliation summary is omitted without relevant evidence and tolerates malformed reconciliation', async () => {
        const missing = projectTaskForDeepSeek({ request_id: 'deepseek-runtime-no-verification-reconciliation', task: 'Observe', status: 'PENDING', evidence: [] });
        assert.equal(missing.verification_reconciliation_summary, undefined);

        const malformed = projectTaskForDeepSeek({
            request_id: 'deepseek-runtime-malformed-reconciliation', task: 'Observe', status: 'PENDING',
            evidence: [{ evidence_type: 'AGENT_REPORT', agent: 'Gemini Builder', report: { reconciliation: 'invalid' } }],
            builder: { status: 'success', report: { reconciliation: { changed_files: 'invalid' } } }
        });
        assert.equal(malformed.verification_reconciliation_summary, undefined);
    });

    await test('failed and blocked tasks expose status-scoped bounded sanitized diagnostic summaries', async () => {
        const longBlocker = `token secret-token ${'x'.repeat(MAX_REPORT_HIGHLIGHT_LENGTH + 20)}`;
        const failed = projectTaskForDeepSeek({
            request_id: 'deepseek-runtime-failure-summary', task: 'Failed review', status: 'FAILED', evidence: [],
            builder: { status: 'failure', execution_id: 'builder-failure', report: { summary: 'Build failed: apiKey secret-api-key', blockers: [longBlocker, 'credential secret-credential', 'third blocker', 'fourth blocker'] } },
            gemini: { status: 'failure', execution_id: 'gemini-failure', report: { summary: 'Review failed', blockers: ['review blocker'] } }
        });
        assert.deepEqual(failed.failure_summary.observed_facts.execution, [
            { agent: 'builder', status: 'failure' }, { agent: 'gemini', status: 'failure' }
        ]);
        assert.deepEqual(failed.failure_summary.observed_facts.report_counts, [
            { agent: 'builder', blockers: 4 }, { agent: 'gemini', blockers: 1 }
        ]);
        assert.equal(failed.failure_summary.agent_commentary.blocker_highlights.length, MAX_REPORT_HIGHLIGHTS);
        assert(failed.failure_summary.agent_commentary.blocker_highlights.every(highlight => highlight.source === 'agent_commentary' && highlight.text.length <= MAX_REPORT_HIGHLIGHT_LENGTH));
        assert.equal(JSON.stringify(failed.failure_summary).includes('secret-token'), false);
        assert.equal(JSON.stringify(failed.failure_summary).includes('secret-api-key'), false);
        assert.equal(JSON.stringify(failed.failure_summary).includes('secret-credential'), false);
        assert.equal(failed.blocked_summary, null);
        assert.equal(failed.failure.status, 'FAILED');

        const blocked = projectTaskForDeepSeek({
            request_id: 'deepseek-runtime-blocked-summary', task: 'Blocked review', status: 'BLOCKED',
            builder: { status: 'blocked', execution_id: 'builder-blocked', report: { summary: 'Waiting for authorization proof', blockers: ['Director approval_id approval-value is unavailable'] } },
            evidence: [{ evidence_type: 'AGENT_REPORT', agent: 'Security Specialist', verification_result: 'blocked', report: { summary: 'Blocked by Bearer secret-value', blockers: ['authorization secret-authorization'] } }]
        });
        assert.deepEqual(blocked.blocked_summary.observed_facts.execution, [{ agent: 'builder', status: 'blocked' }]);
        assert.deepEqual(blocked.blocked_summary.observed_facts.report_counts, [
            { agent: 'builder', blockers: 1 }, { agent: 'Security Specialist', blockers: 1 }
        ]);
        assert.equal(JSON.stringify(blocked.blocked_summary).includes('secret-value'), false);
        assert.equal(JSON.stringify(blocked.blocked_summary).includes('approval-value'), false);
        assert.equal(blocked.failure_summary, null);
        assert.equal(blocked.blocked.status, 'BLOCKED');

        const unsupported = projectTaskForDeepSeek({ request_id: 'deepseek-runtime-no-diagnostics', task: 'Unknown failure', status: 'FAILED', evidence: [] });
        assert.equal(unsupported.failure_summary, null);
        assert.equal(unsupported.blocked_summary, null);
    });

    await test('safe projection separates agent execution reports from verified outcomes and exposes only sanitized evidence', async () => {
        const task = {
            request_id: 'deepseek-runtime-projection-test', task: 'Inspect status', status: 'VERIFIED',
            current_agent: 'Gemini', next_agent: null, next_action: 'complete', verification: 'Independent verification required',
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:01:00.000Z',
            builder: { status: 'success', execution_id: 'builder-1', report: { summary: 'done', secret: 'hidden' } },
            gemini: { status: 'success', execution_id: 'review-1', report: { result: 'verified', token: 'hidden' } },
            evidence: [
                { evidence_type: 'AGENT_REPORT', agent: 'Gemini Builder', timestamp: '2026-01-01T00:00:00.000Z', execution_id: 'builder-1', report: { summary: 'done', nested: { credential: 'hidden' } } },
                { evidence_type: 'INDEPENDENT_VERIFICATION', agent: 'Gemini', timestamp: '2026-01-01T00:01:00.000Z', execution_id: 'review-1', report: { summary: 'verified', api_key: 'hidden', nested: { authorization: 'hidden' } } }
            ],
            capabilities: ['push'], permitted_paths: ['private/']
        };
        const projection = projectTaskForDeepSeek(task);
        assert.equal(projection.lifecycle.execution_completed, true);
        assert.equal(projection.lifecycle.verified_outcome, true);
        assert.equal(projection.execution.builder.result.secret, undefined);
        assert.equal(projection.verification.independent_verification[0].report.api_key, undefined);
        assert.equal(projection.verification.independent_verification[0].report.nested, null);
        assert.deepEqual(projection.evidence, { count: 2, categories: { AGENT_REPORT: 1, INDEPENDENT_VERIFICATION: 1 } });
        assert.equal(projection.verification.independent_verification.length, 1);
        assert.equal(projection.capabilities, undefined);
        assert.equal(projection.permitted_paths, undefined);
    });

    await test('Phase 1 observation represents every ACP lifecycle state without exposing authority', async () => {
        const states = ['PENDING', 'SELECTED', 'PLANNED', 'EXECUTING', 'VERIFIED', 'COMPLETE', 'FAILED', 'BLOCKED'];
        for (const status of states) {
            const projection = projectTaskForDeepSeek({
                request_id: `deepseek-runtime-${status.toLowerCase()}`,
                task: 'Observe lifecycle',
                status,
                parent_request_id: 'deepseek-runtime-parent',
                current_agent: status === 'COMPLETE' ? null : 'Gemini Builder',
                next_agent: status === 'COMPLETE' ? null : 'Gemini',
                next_action: status === 'FAILED' || status === 'BLOCKED' ? 'human_review' : 'continue',
                verification: 'Independent verification required',
                kilo: { status: 'success', execution_id: 'kilo-1', report: { nested: { token: 'hidden' } } },
                builder: { status: 'success', execution_id: 'builder-1', report: { summary: 'implemented' } },
                gemini: { status: status === 'VERIFIED' || status === 'COMPLETE' ? 'success' : 'pending', execution_id: 'review-1', report: { summary: 'reviewed' } },
                evidence: [
                    { evidence_type: 'AGENT_REPORT', agent: 'Gemini Builder', timestamp: '2026-01-01T00:00:00.000Z' },
                    { evidence_type: 'INDEPENDENT_VERIFICATION', agent: 'Gemini', timestamp: '2026-01-01T00:01:00.000Z' }
                ],
                lineage: { superseded_by: null, cancelled: false, authorization: 'hidden' },
                capabilities: ['push'], permitted_paths: ['private/'], repository: 'private/repo', task_mode: 'BUILDER', authorization: { token: 'hidden' }
            });
            assert.equal(projection.lifecycle.status, status);
            assert.equal(projection.lifecycle.execution_completed, true);
            assert.equal(projection.lifecycle.verified_outcome, status === 'VERIFIED' || status === 'COMPLETE');
            assert.equal(projection.lineage.parent_request_id, 'deepseek-runtime-parent');
            assert.equal(projection.execution.kilo.result.nested, null);
            assert.equal(projection.capabilities, undefined);
            assert.equal(projection.permitted_paths, undefined);
            assert.equal(projection.repository, undefined);
            assert.equal(projection.task_mode, undefined);
            assert.equal(projection.authorization, undefined);
            assert.equal(projection.failure === null, status !== 'FAILED');
            assert.equal(projection.blocked === null, status !== 'BLOCKED');
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
