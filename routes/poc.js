const express = require('express');
const fs = require('fs');
const { getDispatcher } = require('../services/transport-provider');
const orchestrator = require('../poc/orchestrator');
const { validateExecutionReport, validateACPCommand, VALID_AGENTS } = require('../poc/schemas/acp-schema');
const taskRegistry = require('../poc/task-registry');
const gitWebhook = require('../poc/github-webhook');

const router = express.Router();

function transitionToExecuting(requestId) {
    const transitions = ['SELECTED', 'PLANNED', 'EXECUTING'];
    for (const status of transitions) {
        const result = taskRegistry.updateTaskStatus(requestId, status);
        if (!result.success) {
            return { success: false, error: result.error };
        }
    }
    return { success: true };
}

// POC Endpoint Authentication Middleware
const authenticatePoc = (req, res, next) => {
    const secret = req.headers['x-poc-trigger-secret'];
    if (!secret || secret !== process.env.ACP_POC_TRIGGER_SECRET) {
        return res.status(401).json({
            request_id: 'unknown',
            status: 'authentication blocked',
            stage: 'authentication blocked'
        });
    }
    next();
};

// Kilo Callback Authentication Middleware
const authenticateKiloCallback = (req, res, next) => {
    const secret = req.headers['x-kilo-callback-secret'];
    if (!secret || secret !== process.env.KILO_CALLBACK_SECRET) {
        return res.status(401).json({
            request_id: req.body?.request_id || 'unknown',
            status: 'authentication blocked',
            stage: 'authentication blocked',
            error: 'Invalid or missing callback secret'
        });
    }
    next();
};

// Gemini Callback Authentication Middleware
const authenticateGeminiCallback = (req, res, next) => {
    const secret = req.headers['x-gemini-callback-secret'];
    if (!secret || secret !== process.env.GEMINI_CALLBACK_SECRET) {
        return res.status(401).json({
            request_id: req.body?.request_id || 'unknown',
            status: 'authentication blocked',
            stage: 'authentication blocked',
            error: 'Invalid or missing callback secret'
        });
    }
    next();
};

// Gemini Builder Callback Authentication Middleware
const authenticateBuilderCallback = (req, res, next) => {
    const secret = req.headers['x-builder-callback-secret'];
    if (!secret || secret !== process.env.BUILDER_CALLBACK_SECRET) {
        return res.status(401).json({
            request_id: req.body?.request_id || 'unknown',
            status: 'authentication blocked',
            stage: 'authentication blocked',
            error: 'Invalid or missing callback secret'
        });
    }
    next();
};

// DeepSeek Coordinator Authentication Middleware
const authenticateDeepSeekCoordinator = (req, res, next) => {
    const secret = req.headers['x-deepseek-coordinator-secret'];
    if (!secret || secret !== process.env.DEEPSEEK_COORDINATOR_SECRET) {
        return res.status(401).json({
            request_id: req.body?.request_id || 'unknown',
            status: 'authentication blocked',
            stage: 'authentication blocked',
            error: 'Invalid or missing DeepSeek Coordinator secret'
        });
    }
    next();
};

// Chatbox Gateway Authentication Middleware
const authenticateChatboxGateway = (req, res, next) => {
    const secret = req.headers['x-chatbox-gateway-secret'];
    if (!secret || secret !== process.env.CHATBOX_GATEWAY_SECRET) {
        return res.status(401).json({
            request_id: 'unknown',
            status: 'authentication blocked',
            stage: 'authentication blocked',
            error: 'Invalid or missing Chatbox gateway secret'
        });
    }
    next();
};

function buildChatboxCommand(requestBody) {
    const userMessages = requestBody.messages.filter(m => m.role === 'user');
    const intentText = userMessages
        .map(m => m.content)
        .filter(c => typeof c === 'string')
        .join('\n');

    if (!intentText) {
        return { valid: false, error: 'No user message content found in request' };
    }

    const target = requestBody.target;
    if (!target || !VALID_AGENTS.includes(target)) {
        return { valid: false, error: 'Missing or invalid target field in Chatbox request' };
    }

    const requestId = `chatbox-${Date.now()}`;

    return {
        valid: true,
        command: {
            protocol_version: '0.1',
            request_id: requestId,
            source: 'Chatbox',
            target: target,
            task_type: 'natural-language-ingress',
            repository: 'fluentwithkyle/openclaw-webhook',
            base_branch: 'main',
            task: intentText,
            task_mode: 'REVIEW',
            constraints: {
                permitted_paths: ['poc/']
            },
            authorization: {
                capabilities: ['read_only']
            },
            verification: 'Chatbox ingress authenticated; intent preserved into REVIEW-mode ACP command for trusted control-plane classification',
            reporting: 'structured-json',
            originator: 'Kyle',
            natural_language_intent: {
                source: 'Chatbox',
                model: requestBody.model,
                messages: requestBody.messages
            }
        }
    };
}

router.post('/kilo', authenticatePoc, async (req, res) => {
    const requestId = `poc-${Date.now()}`;
    try {
        const commandData = fs.readFileSync('poc/command.json', 'utf8');
        const command = JSON.parse(commandData);
        command.request_id = requestId; // Ensure unique ID

        // Create task in registry
        const taskResult = taskRegistry.createTask(command);
        if (!taskResult.success) {
            return res.status(409).json({
                request_id: requestId,
                status: 'Task creation failed',
                stage: 'failed',
                error: taskResult.error
            });
        }

        // Dispatch via Kilo Transport (from provider)
        const result = await getDispatcher()(command);

        // Persist provider identifiers if returned
        if (result.provider_session_id || result.provider_message_id || result.provider_invocation_id) {
            const task = taskRegistry.getTask(requestId);
            if (task) {
                task.kilo.provider_session_id = result.provider_session_id;
                task.kilo.provider_message_id = result.provider_message_id;
                task.kilo.provider_invocation_id = result.provider_invocation_id;
                task.updated_at = new Date().toISOString();
                taskRegistry.persistCache();
            }
        }

        if (result.status === 'SUCCESS') {
            const transitionResult = transitionToExecuting(requestId);
            if (!transitionResult.success) {
                console.error('Failed to transition task to EXECUTING:', transitionResult.error);
            }
            res.status(200).json({
                request_id: requestId,
                status: 'Kilo dispatch accepted',
                stage: 'completed'
            });
        } else if (result.status === 'BLOCKED') {
            res.status(403).json({
                request_id: requestId,
                status: 'ACP validation blocked',
                stage: 'blocked'
            });
        } else {
            res.status(500).json({
                request_id: requestId,
                status: 'Kilo transport failure',
                stage: 'failed'
            });
        }
    } catch (error) {
        console.error('Error in /poc/kilo:', error);
        res.status(500).json({
            request_id: requestId,
            status: 'Kilo transport failure',
            stage: 'failed'
        });
    }
});

router.post('/builder/dispatch', authenticatePoc, async (req, res) => {
    const command = req.body;

    if (!command || typeof command !== 'object') {
        return res.status(400).json({
            request_id: 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing or invalid request body'
        });
    }

    const validation = validateACPCommand(command);
    if (!validation.valid) {
        return res.status(400).json({
            request_id: command?.request_id || 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Invalid ACP command: ${validation.error}`
        });
    }

    try {
        const result = taskRegistry.createTask(command);
        if (!result.success) {
            if (result.duplicate) {
                return res.status(409).json({
                    request_id: command.request_id,
                    status: 'duplicate',
                    stage: 'conflict',
                    error: result.error
                });
            }
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Task registration failed',
                stage: 'failed'
            });
        }

        const transitionResult = transitionToExecuting(command.request_id);
        if (!transitionResult.success) {
            console.error('Failed to transition Builder task to EXECUTING:', transitionResult.error);
        }

        const githubToken = process.env.ORCHESTRATOR_GH_TOKEN;
        const builderApiKey = process.env.GEMINI_BUILDER_API_KEY;
        if (!githubToken) {
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Builder dispatch blocked - missing ORCHESTRATOR_GH_TOKEN',
                stage: 'authentication blocked'
            });
        }

        const dispatchResult = await orchestrator.triggerGeminiBuilder(command.request_id, githubToken, builderApiKey);

        if (!dispatchResult.success) {
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Builder dispatch failed',
                stage: 'failed',
                error: dispatchResult.error,
                task_status: result.entry.status
            });
        }

        res.status(202).json({
            request_id: command.request_id,
            status: 'Builder dispatched',
            stage: 'dispatched',
            task_status: result.entry.status,
            builder_status: result.entry.builder.status,
            next_action: result.entry.next_action,
            dispatch_result: dispatchResult.dispatch_result
        });
    } catch (error) {
        console.error('Error in /poc/builder/dispatch:', error);
        return res.status(500).json({
            request_id: command?.request_id || 'unknown',
            status: 'dispatch failed',
            stage: 'failed',
            error: error.message
        });
    }
});

router.post('/kilo/callback', authenticateKiloCallback, async (req, res) => {
    const requestId = req.body?.request_id;

    if (!requestId) {
        return res.status(400).json({
            request_id: 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing request_id in callback body'
        });
    }

    // Validate the complete ACP execution report
    const validation = validateExecutionReport(req.body);
    if (!validation.valid) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Invalid execution report: ${validation.error}`
        });
    }

    // Validate agent is Kilo
    if (req.body.agent !== 'Kilo') {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Expected Kilo report, got ${req.body.agent}`
        });
    }

    // Validate request_id exists in TaskRegistry
    const task = taskRegistry.getTask(requestId);
    if (!task) {
        return res.status(404).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Unknown request_id'
        });
    }

    // Validate repository matches
    if (req.body.repository && req.body.repository !== task.repository) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Repository mismatch: expected ${task.repository}, got ${req.body.repository}`
        });
    }

    // Validate base_branch matches
    if (req.body.base_branch && req.body.base_branch !== task.base_branch) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Base branch mismatch: expected ${task.base_branch}, got ${req.body.base_branch}`
        });
    }

    // Process through orchestrator (handles idempotency and state transitions)
    const result = orchestrator.handleKiloCompletion(requestId, req.body);

    if (!result.success) {
        const httpStatus = result.duplicate ? 409 : 400;
        return res.status(httpStatus).json({
            request_id: requestId,
            status: result.duplicate ? 'duplicate' : 'validation blocked',
            stage: result.stage,
            error: result.error,
            duplicate: result.duplicate || false
        });
    }

    // Automatically trigger Gemini Builder if next_action indicates it
    let builderTriggerResult = null;
    if (result.next_action === 'trigger_builder') {
        const githubToken = process.env.ORCHESTRATOR_GH_TOKEN;
        const builderApiKey = process.env.GEMINI_BUILDER_API_KEY;
        if (githubToken) {
            builderTriggerResult = await orchestrator.triggerGeminiBuilder(requestId, githubToken, builderApiKey);
        } else {
            console.warn('[Kilo Callback] ORCHESTRATOR_GH_TOKEN not configured, skipping Builder trigger');
        }
    }

    res.status(200).json({
        request_id: requestId,
        status: 'Kilo completion recorded',
        stage: 'completed',
        next_action: result.next_action,
        task_status: result.task.status,
        kilo_status: result.task.kilo.status,
        builder_trigger: builderTriggerResult ? {
            success: builderTriggerResult.success,
            message: builderTriggerResult.message,
            error: builderTriggerResult.error
        } : null
    });
});

router.post('/gemini/callback', authenticateGeminiCallback, async (req, res) => {
    const requestId = req.body?.request_id;

    if (!requestId) {
        return res.status(400).json({
            request_id: 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing request_id in callback body'
        });
    }

    // Validate the complete ACP execution report
    const validation = validateExecutionReport(req.body);
    if (!validation.valid) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Invalid execution report: ${validation.error}`
        });
    }

    // Validate agent is Gemini
    if (req.body.agent !== 'Gemini') {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Expected Gemini report, got ${req.body.agent}`
        });
    }

    // Validate request_id exists in TaskRegistry
    const task = taskRegistry.getTask(requestId);
    if (!task) {
        return res.status(404).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Unknown request_id'
        });
    }

    // Validate repository matches
    if (req.body.repository && req.body.repository !== task.repository) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Repository mismatch: expected ${task.repository}, got ${req.body.repository}`
        });
    }

    // Validate base_branch matches
    if (req.body.base_branch && req.body.base_branch !== task.base_branch) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Base branch mismatch: expected ${task.base_branch}, got ${req.body.base_branch}`
        });
    }

    // Process through orchestrator (handles idempotency and state transitions)
    const result = orchestrator.handleGeminiCompletion(requestId, req.body);

    if (!result.success) {
        const httpStatus = result.duplicate ? 409 : 400;
        return res.status(httpStatus).json({
            request_id: requestId,
            status: result.duplicate ? 'duplicate' : 'validation blocked',
            stage: result.stage,
            error: result.error,
            duplicate: result.duplicate || false
        });
    }

    res.status(200).json({
        request_id: requestId,
        status: 'Gemini completion recorded',
        stage: 'completed',
        next_action: result.next_action,
        task_status: result.task.status,
        gemini_status: result.task.gemini.status
    });
});

router.post('/builder/callback', authenticateBuilderCallback, async (req, res) => {
    const requestId = req.body?.request_id;

    if (!requestId) {
        return res.status(400).json({
            request_id: 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing request_id in callback body'
        });
    }

    const validation = validateExecutionReport(req.body);
    if (!validation.valid) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Invalid execution report: ${validation.error}`
        });
    }

    if (req.body.agent !== 'Gemini Builder') {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Expected Gemini Builder report, got ${req.body.agent}`
        });
    }

    const task = taskRegistry.getTask(requestId);
    if (!task) {
        return res.status(404).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Unknown request_id'
        });
    }

    if (req.body.repository && req.body.repository !== task.repository) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Repository mismatch: expected ${task.repository}, got ${req.body.repository}`
        });
    }

    if (req.body.base_branch && req.body.base_branch !== task.base_branch) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Base branch mismatch: expected ${task.base_branch}, got ${req.body.base_branch}`
        });
    }

    const result = orchestrator.handleGeminiBuilderCompletion(requestId, req.body);

    if (!result.success) {
        const httpStatus = result.duplicate ? 409 : 400;
        return res.status(httpStatus).json({
            request_id: requestId,
            status: result.duplicate ? 'duplicate' : 'validation blocked',
            stage: result.stage,
            error: result.error,
            duplicate: result.duplicate || false
        });
    }

    // Automatically trigger Gemini Reviewer if next_action indicates it
    let geminiTriggerResult = null;
    if (result.next_action === 'trigger_gemini') {
        const githubToken = process.env.ORCHESTRATOR_GH_TOKEN;
        if (githubToken) {
            geminiTriggerResult = await orchestrator.triggerGemini(requestId, githubToken);
        } else {
            console.warn('[Builder Callback] ORCHESTRATOR_GH_TOKEN not configured, skipping Gemini Reviewer trigger');
        }
    }

    res.status(200).json({
        request_id: requestId,
        status: 'Gemini Builder completion recorded',
        stage: 'completed',
        next_action: result.next_action,
        task_status: result.task.status,
        builder_status: result.task.builder.status,
        gemini_trigger: geminiTriggerResult ? {
            success: geminiTriggerResult.success,
            message: geminiTriggerResult.message,
            error: geminiTriggerResult.error
        } : null
    });
});

router.post('/chatbox', authenticateChatboxGateway, async (req, res) => {
    const requestId = req.body?.request_id || 'unknown';

    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing or invalid request body'
        });
    }

    if (!req.body.model || typeof req.body.model !== 'string') {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing or invalid required field: model'
        });
    }

    if (!Array.isArray(req.body.messages)) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'Missing or invalid required field: messages (must be an array)'
        });
    }

    if (req.body.messages.length === 0) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'messages array must not be empty'
        });
    }

    for (const msg of req.body.messages) {
        if (!msg || typeof msg !== 'object' || !msg.role || !msg.content) {
            return res.status(400).json({
                request_id: requestId,
                status: 'validation blocked',
                stage: 'validation blocked',
                error: 'Each message must contain role and content fields'
            });
        }
    }

    const hasUserMessage = req.body.messages.some(m => m.role === 'user');
    if (!hasUserMessage) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: 'At least one user message is required to preserve intent'
        });
    }

    const buildResult = buildChatboxCommand(req.body);
    if (!buildResult.valid) {
        return res.status(400).json({
            request_id: requestId,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: buildResult.error
        });
    }

    const command = buildResult.command;

    const validation = validateACPCommand(command);
    if (!validation.valid) {
        return res.status(400).json({
            request_id: command.request_id,
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Invalid ACP command: ${validation.error}`
        });
    }

    try {
        const result = taskRegistry.createTask(command);
        if (!result.success) {
            if (result.duplicate) {
                return res.status(409).json({
                    request_id: command.request_id,
                    status: 'duplicate',
                    stage: 'conflict',
                    error: result.error
                });
            }
            return res.status(500).json({
                request_id: command.request_id,
                status: 'registration failed',
                stage: 'failed'
            });
        }

        let dispatchResult;
        try {
            dispatchResult = await getDispatcher()(command);
        } catch (dispatchError) {
            console.error('Dispatch error in /poc/chatbox:', dispatchError);
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Registration succeeded, dispatch failed',
                stage: 'failed',
                execution_initiated: false,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent,
                error: dispatchError.message
            });
        }

        if (dispatchResult.provider_session_id || dispatchResult.provider_message_id || dispatchResult.provider_invocation_id) {
            const task = taskRegistry.getTask(command.request_id);
            if (task) {
                task.kilo.provider_session_id = dispatchResult.provider_session_id;
                task.kilo.provider_message_id = dispatchResult.provider_message_id;
                task.kilo.provider_invocation_id = dispatchResult.provider_invocation_id;
                task.updated_at = new Date().toISOString();
                taskRegistry.persistCache();
            }
        }

        if (dispatchResult.status === 'SUCCESS') {
            const transitionResult = transitionToExecuting(command.request_id);
            if (!transitionResult.success) {
                console.error('Failed to transition task to EXECUTING:', transitionResult.error);
            }
            return res.status(202).json({
                request_id: command.request_id,
                status: 'Task registered and dispatched',
                stage: 'dispatched',
                execution_initiated: true,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent
            });
        } else if (dispatchResult.status === 'BLOCKED') {
            return res.status(403).json({
                request_id: command.request_id,
                status: 'ACP validation blocked',
                stage: 'blocked',
                execution_initiated: false,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent,
                error: dispatchResult.error
            });
        } else {
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Kilo transport failure',
                stage: 'failed',
                execution_initiated: false,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent,
                error: dispatchResult.error
            });
        }
    } catch (error) {
        console.error('Error in /poc/chatbox:', error);
        return res.status(500).json({
            request_id: command?.request_id || requestId,
            status: 'registration failed',
            stage: 'failed'
        });
    }
});

router.post('/coordinator', authenticateDeepSeekCoordinator, async (req, res) => {
    const command = req.body;

    const validation = validateACPCommand(command);
    if (!validation.valid) {
        return res.status(400).json({
            request_id: command?.request_id || 'unknown',
            status: 'validation blocked',
            stage: 'validation blocked',
            error: `Invalid ACP command: ${validation.error}`
        });
    }

    try {
        const result = taskRegistry.createTask(command);
        if (!result.success) {
            if (result.duplicate) {
                return res.status(409).json({
                    request_id: command.request_id,
                    status: 'duplicate',
                    stage: 'conflict',
                    error: result.error
                });
            }
            return res.status(500).json({
                request_id: command.request_id,
                status: 'registration failed',
                stage: 'failed'
            });
        }

        let dispatchResult;
        try {
            dispatchResult = await getDispatcher()(command);
        } catch (dispatchError) {
            console.error('Dispatch error in /poc/coordinator:', dispatchError);
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Registration succeeded, dispatch failed',
                stage: 'failed',
                execution_initiated: false,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent,
                error: dispatchError.message
            });
        }

        if (dispatchResult.provider_session_id || dispatchResult.provider_message_id || dispatchResult.provider_invocation_id) {
            const task = taskRegistry.getTask(command.request_id);
            if (task) {
                task.kilo.provider_session_id = dispatchResult.provider_session_id;
                task.kilo.provider_message_id = dispatchResult.provider_message_id;
                task.kilo.provider_invocation_id = dispatchResult.provider_invocation_id;
                task.updated_at = new Date().toISOString();
                taskRegistry.persistCache();
            }
        }

        if (dispatchResult.status === 'SUCCESS') {
            const transitionResult = transitionToExecuting(command.request_id);
            if (!transitionResult.success) {
                console.error('Failed to transition task to EXECUTING:', transitionResult.error);
            }
            return res.status(202).json({
                request_id: command.request_id,
                status: 'Task registered and dispatched',
                stage: 'dispatched',
                execution_initiated: true,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent
            });
        } else if (dispatchResult.status === 'BLOCKED') {
            return res.status(403).json({
                request_id: command.request_id,
                status: 'ACP validation blocked',
                stage: 'blocked',
                execution_initiated: false,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent,
                error: dispatchResult.error
            });
        } else {
            return res.status(500).json({
                request_id: command.request_id,
                status: 'Kilo transport failure',
                stage: 'failed',
                execution_initiated: false,
                task_status: result.entry.status,
                current_agent: result.entry.current_agent,
                next_agent: result.entry.next_agent,
                error: dispatchResult.error
            });
        }
    } catch (error) {
        console.error('Error in /poc/coordinator:', error);
        return res.status(500).json({
            request_id: command?.request_id || 'unknown',
            status: 'registration failed',
            stage: 'failed'
        });
    }
});

// POC GitHub Push Webhook — Git-based Kilo completion-signal receiver
// Receives GitHub push events and validates them as Kilo completion signals.
// This endpoint is a bounded POC, clearly separated from the existing
// production completion mechanism (kilo-polling.js, kilo/callback).
router.post('/github/webhook', async (req, res) => {
    const deliveryId = req.headers['x-github-delivery'];
    const signature = req.headers['x-hub-signature-256'];
    const githubEvent = req.headers['x-github-event'];
    const rawBody = req.rawBody;

    if (githubEvent !== 'push') {
        return res.status(200).json({
            status: 'ignored',
            message: 'Not a push event (event: ' + githubEvent + ')'
        });
    }

    try {
        const result = await gitWebhook.processPushEvent(
            req.body,
            deliveryId,
            {
                rawBody: rawBody,
                signature: signature,
                webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
                githubToken: process.env.GITHUB_TOKEN || process.env.ORCHESTRATOR_GH_TOKEN,
                config: {
                    repository: 'fluentwithkyle/openclaw-webhook',
                    branch: 'main'
                }
            }
        );

        let httpStatus = 200;
        if (result.status === 'blocked' || result.status === 'rejected') {
            httpStatus = 400;
        } else if (result.status === 'failed') {
            httpStatus = 500;
        }

        res.status(httpStatus).json(result);
    } catch (err) {
        console.error('Error in /poc/github/webhook:', err);
        res.status(500).json({
            status: 'error',
            delivery_id: deliveryId || 'unknown',
            error: err.message
        });
    }
});

module.exports = { router };
