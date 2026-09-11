const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const { handleTallyWebhook } = require('./services/tally');
const { handleCalWebhook } = require('./services/cal');
const { runAbandonedBookingCheck } = require('./workflows/abandonedBooking');
const { dispatch } = require('./poc/kilo-transport');

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

// Internal Cron Scheduler: Checks for abandoned bookings every 5 minutes
const ABANDONED_CHECK_INTERVAL = 5 * 60 * 1000;
setInterval(runAbandonedBookingCheck, ABANDONED_CHECK_INTERVAL);

app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

// System Health Diagnostic Route for OpenClaw
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        modules: {
            tally: 'active',
            cal: 'active',
            lineService: 'active',
            appsScript: 'active'
        },
        cron: {
            abandonedBookingScheduler: 'running (5m interval)'
        }
    });
});

app.post('/webhook/cal', async (req, res) => {
  console.log('[Webhook INBOUND] Hit /webhook/cal with body:', JSON.stringify(req.body, null, 2));
  try {
    if (!req.body || Object.keys(req.body).length === 0 || req.body.triggerEvent === 'PING') {
      return res.status(200).json({ success: true, message: 'Cal.com ping received successfully' });
    }
    req.url = '/webhook';
    return app._router.handle(req, res);
  } catch (error) {
    console.error('Error in /webhook/cal:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook/tally', async (req, res) => {
  console.log('[Webhook INBOUND] Hit /webhook/tally with body:', JSON.stringify(req.body, null, 2));
  try {
    req.url = '/tally-webhook';
    return app._router.handle(req, res);
  } catch (error) {
    console.error('Error in /webhook/tally:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tally-webhook', handleTallyWebhook);
app.post('/webhook', handleCalWebhook);

// POC Endpoint
app.post('/poc/kilo', authenticatePoc, async (req, res) => {
    const requestId = `poc-${Date.now()}`;
    try {
        const commandData = fs.readFileSync('poc/command.json', 'utf8');
        const command = JSON.parse(commandData);
        command.request_id = requestId; // Ensure unique ID

        // Dispatch via Kilo Transport
        const result = await dispatch(command);

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

const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;
setInterval(() => {
    axios.get('https://openclaw-webhook-iz6s.onrender.com/').catch(() => {});
}, KEEP_ALIVE_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
