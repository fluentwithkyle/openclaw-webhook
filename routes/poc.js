const express = require('express');
const fs = require('fs');
const { getDispatcher } = require('../services/transport-provider');
const { handleKiloCompletion } = require('../poc/orchestrator');

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

router.post('/kilo', authenticatePoc, async (req, res) => {
    const requestId = `poc-${Date.now()}`;
    try {
        const commandData = fs.readFileSync('poc/command.json', 'utf8');
        const command = JSON.parse(commandData);
        command.request_id = requestId; // Ensure unique ID

        // Dispatch via Kilo Transport (from provider)
        const result = await getDispatcher()(command);

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

router.post('/kilo/callback', authenticatePoc, async (req, res) => {
    const requestId = req.body?.request_id;
    if (!requestId) {
        return res.status(400).json({
            request_id: 'unknown',
            status: 'validation failed',
            stage: 'missing_request_id',
            error: 'request_id is required'
        });
    }

    try {
        const report = req.body;
        const result = await handleKiloCompletion(requestId, report);

        if (result.success) {
            res.status(200).json({
                request_id: requestId,
                status: 'Kilo completion recorded',
                stage: 'completed',
                next_action: result.next_action,
                gemini_dispatch: result.gemini_dispatch
            });
        } else {
            const statusCode = result.duplicate ? 409 : (result.stage === 'validation' ? 400 : 500);
            res.status(statusCode).json({
                request_id: requestId,
                status: 'Kilo completion failed',
                stage: result.stage,
                error: result.error,
                duplicate: result.duplicate
            });
        }
    } catch (error) {
        console.error('Error in /poc/kilo/callback:', error);
        res.status(500).json({
            request_id: requestId,
            status: 'Kilo callback failure',
            stage: 'failed',
            error: error.message
        });
    }
});

module.exports = { router };
