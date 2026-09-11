const express = require('express');
const fs = require('fs');
const { getDispatcher } = require('../services/transport-provider');

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

module.exports = { router };
