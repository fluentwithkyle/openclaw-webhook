const taskRegistry = require('./task-registry');
const orchestrator = require('./orchestrator');

let providerClient = null;
let pollingInterval = null;
let isPolling = false;

const DEFAULT_POLL_INTERVAL_MS = 30000;
const MAX_POLL_RETRIES = 10;

function setProviderClient(client) {
    providerClient = client;
}

function getProviderClient() {
    return providerClient;
}

async function pollKiloCompletion(requestId) {
    const task = taskRegistry.getTask(requestId);
    if (!task) {
        return { success: false, error: 'Task not found', stage: 'registry' };
    }

    if (task.kilo.status === 'success' || task.kilo.status === 'failure' || task.kilo.status === 'blocked') {
        return { 
            success: true, 
            status: task.kilo.status, 
            terminal: true,
            message: `Kilo already completed with status: ${task.kilo.status}`,
            completion: task.kilo.report
        };
    }

    if (task.kilo.status !== 'pending') {
        return { success: false, error: `Kilo status is ${task.kilo.status}, not pending`, stage: 'status' };
    }

    if (!providerClient) {
        return { success: false, error: 'No provider client configured for polling', stage: 'configuration' };
    }

    const identifiers = {
        request_id: requestId,
        provider_session_id: task.kilo.provider_session_id,
        provider_message_id: task.kilo.provider_message_id,
        provider_invocation_id: task.kilo.provider_invocation_id,
        internal_execution_id: task.kilo.execution_id
    };

    try {
        const result = await providerClient.getCompletionStatus(identifiers);
        return result;
    } catch (err) {
        return { success: false, error: `Provider polling error: ${err.message}`, stage: 'provider' };
    }
}

async function processKiloCompletion(requestId, providerResult) {
    if (!providerResult || !providerResult.completion) {
        return { success: false, error: 'No completion data from provider', stage: 'provider_result' };
    }

    const completion = providerResult.completion;

    const report = {
        request_id: requestId,
        agent: 'Kilo',
        status: completion.status,
        task: completion.task || '',
        changed_files: completion.changed_files || [],
        verification: completion.verification || [],
        result: {
            execution_metadata: {
                invocation_id: completion.invocation_id || providerResult.provider_invocation_id || 'unknown',
                run_id: completion.run_id || providerResult.provider_session_id || 'unknown'
            },
            implementation: completion.result || {}
        },
        commit: completion.commit || null,
        push: completion.push || false,
        blockers: completion.blockers || []
    };

    const validation = require('./schemas/acp-schema').validateExecutionReport(report);
    if (!validation.valid) {
        return { success: false, error: `Invalid execution report from provider: ${validation.error}`, stage: 'validation' };
    }

    const orchestratorResult = orchestrator.handleKiloCompletion(requestId, report);
    return orchestratorResult;
}

async function pollAndProcess(requestId) {
    const pollResult = await pollKiloCompletion(requestId);

    if (!pollResult.success) {
        if (pollResult.error && pollResult.error.includes('No provider client')) {
            return { success: false, error: pollResult.error, stage: pollResult.stage, terminal: false };
        }
        return { success: false, error: pollResult.error, stage: pollResult.stage, terminal: false };
    }

    if (pollResult.terminal && pollResult.completion) {
        return { success: true, status: pollResult.status, terminal: true, message: pollResult.message };
    }

    if (pollResult.status === 'in_progress') {
        return { success: true, status: 'in_progress', message: 'Kilo execution still in progress' };
    }

    if (pollResult.status === 'success' || pollResult.status === 'failure' || pollResult.status === 'blocked') {
        const processResult = await processKiloCompletion(requestId, pollResult);
        return { success: processResult.success, ...processResult, terminal: true };
    }

    return { success: false, error: `Unknown provider status: ${pollResult.status}`, stage: 'provider_status', terminal: false };
}

async function startPolling(options = {}) {
    if (isPolling) {
        return { success: false, error: 'Polling already running' };
    }

    const intervalMs = options.intervalMs || DEFAULT_POLL_INTERVAL_MS;
    const maxRetries = options.maxRetries || MAX_POLL_RETRIES;

    isPolling = true;
    let retries = 0;

    const pollCycle = async () => {
        if (!isPolling) return;

        const tasks = taskRegistry.getTasksByStatus('EXECUTING').filter(t => t.kilo.status === 'pending');

        for (const task of tasks) {
            if (!isPolling) break;

            const result = await pollAndProcess(task.request_id);

            if (result.terminal) {
                if (result.success) {
                    console.log(`[Kilo Polling] Task ${task.request_id} completed with status: ${result.next_action}`);
                } else {
                    console.error(`[Kilo Polling] Task ${task.request_id} failed: ${result.error}`);
                }
            } else if (result.status === 'in_progress') {
                console.log(`[Kilo Polling] Task ${task.request_id} still in progress`);
            }
        }

        retries++;
        if (retries >= maxRetries) {
            stopPolling();
        }
    };

    pollingInterval = setInterval(pollCycle, intervalMs);
    console.log(`[Kilo Polling] Started with interval ${intervalMs}ms, max retries: ${maxRetries}`);

    return { success: true, message: 'Polling started' };
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    isPolling = false;
    console.log('[Kilo Polling] Stopped');
}

function getPollingStatus() {
    return {
        isPolling,
        interval: pollingInterval ? 'active' : 'inactive'
    };
}

async function pollOnce(requestId) {
    if (!providerClient) {
        return { success: false, error: 'No provider client configured', stage: 'configuration' };
    }
    return await pollAndProcess(requestId);
}

module.exports = {
    setProviderClient,
    getProviderClient,
    pollKiloCompletion,
    processKiloCompletion,
    pollAndProcess,
    startPolling,
    stopPolling,
    getPollingStatus,
    pollOnce,
    DEFAULT_POLL_INTERVAL_MS,
    MAX_POLL_RETRIES
};