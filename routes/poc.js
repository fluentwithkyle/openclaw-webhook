const express = require('express');
const fs = require('fs');
const { getDispatcher } = require('../services/transport-provider');
const orchestrator = require('../poc/orchestrator');
const { validateExecutionReport } = require('../poc/schemas/acp-schema');
const taskRegistry = require('../poc/task-registry');

const router = express.Router();

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

    res.status(200).json({
        request_id: requestId,
        status: 'Kilo completion recorded',
        stage: 'completed',
        next_action: result.next_action,
        task_status: result.task.status,
        kilo_status: result.task.kilo.status
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

module.exports = { router };