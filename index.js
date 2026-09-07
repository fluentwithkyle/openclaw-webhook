const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const { sendLineNotification } = require('./services/lineService');
const { triggerAppsScript, cleanTaipeiTimestamp, cleanEventTitle } = require('./services/appsScript');
const { handleTallyWebhook } = require('./services/tally');
const { handleCalWebhook } = require('./services/cal');

// Internal Cron Scheduler: Checks for abandoned bookings every 5 minutes
const ABANDONED_CHECK_INTERVAL = 5 * 60 * 1000;
setInterval(async () => {
    console.log('Running internal cron: Checking for abandoned bookings...');
    try {
        const response = await triggerAppsScript({ action: 'get_pending' });
        if (!response || response.status !== 'success' || !response.data) return;

        const pendingClients = response.data;
        const now = new Date().getTime();
        const THIRTY_MINUTES = 30 * 60 * 1000;

        for (const client of pendingClients) {
            if (!client.timestamp) continue;
            const submittedTime = new Date(client.timestamp).getTime();
            const elapsedMs = now - submittedTime;

            if (elapsedMs > THIRTY_MINUTES) {
                const hoursElapsed = (elapsedMs / (1000 * 60 * 60)).toFixed(1);
                const formattedSubTime = cleanTaipeiTimestamp(client.timestamp);

                const message = `Abandoned Booking ➡️\n\nName: ${client.name}\nEmail: ${client.email}\nLINE ID: ${client.lineId || 'Not provided'}\n\n${cleanEventTitle(client.packageSelected || 'Not specified')}\n${client.bookingDateTime || 'Not specified'}\n\n${formattedSubTime}\nElapsed: ${hoursElapsed} hours \n\nLocation: ${client.location || 'Not provided'}\nProfession: ${client.profession || 'Not provided'}\n\nEnglish Reality: \n${client.englishReality || 'Not provided'}\n\n3-Month Goal: \n${client.goal3Month || 'Not provided'}\n\nConversation Topics: \n${client.conversationTopics || 'Not provided'}`;

                await sendLineNotification(message);

                await triggerAppsScript({
                    action: 'upsert_client',
                    email: client.email,
                    lineId: client.lineId,
                    scheduleStatus: 'Follow-Up Needed'
                });
            }
        }
    } catch (err) {
        console.error('Error in internal abandoned booking cron:', err.message);
    }
}, ABANDONED_CHECK_INTERVAL);

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

const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;
setInterval(() => {
    axios.get('https://openclaw-webhook-iz6s.onrender.com/').catch(() => {});
}, KEEP_ALIVE_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
