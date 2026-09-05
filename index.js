const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzh7dEtGMxxYhZuiqOxw1LByPjA4xZM6_W8c-PCK_K10tmDazmt4kefFAVMW1r8T47D/exec';

async function sendLineNotification(text) {
   const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
   const userId = process.env.LINE_USER_ID;

   if (!token || !userId) {
     console.log('LINE credentials missing; skipping push notification.');
     return;
   }

   try {
     await axios.post(
       'https://api.line.me/v2/bot/message/push',
       { to: userId, messages: [{ type: 'text', text: text }] },
       { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }
     );
     console.log('LINE notification sent successfully.');
   } catch (error) {
     console.error('Error sending LINE notification:', error.response?.data || error.message);
   }
}

async function triggerAppsScript(payload) {
   try {
     const response = await axios.post(APPS_SCRIPT_URL, payload, {
       headers: { 'Content-Type': 'application/json' }
     });
     return response.data;
   } catch (error) {
     console.error('Failed to communicate with Google Apps Script:', error.message);
   }
}

app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

app.post('/abandoned-alert', async (req, res) => {
   try {
     const { name, email, lineId, packageSelected, timestamp, hoursElapsed, location, profession, englishReality, goal3Month, conversationTopics } = req.body;
        
     const message = `ABANDONED BOOKING ALERT\nName: ${name}\nEmail: ${email}\nLINE ID: ${lineId || 'Not provided'}\nPackage: ${packageSelected || 'Not specified'}\nSubmitted At: ${timestamp || 'Unknown'}\nElapsed: ${hoursElapsed} hours without booking.\nLocation: ${location || 'Not provided'}\nProfession: ${profession || 'Not provided'}\nEnglish Reality: ${englishReality || 'Not provided'}\n3-Month Goal: ${goal3Month || 'Not provided'}\nConversation Topics: ${conversationTopics || 'Not provided'}`;

     await sendLineNotification(message);
     res.status(200).json({ status: 'success', message: 'Abandoned alert sent' });
   } catch (error) {
     console.error('Error handling abandoned alert:', error);
     res.status(500).json({ error: error.message });
   }
});

app.post('/tally-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        const payloadData = eventData.data || eventData;
        const fields = payloadData.fields || [];

        let clientName = 'Unknown Client';
        let clientEmail = '';
        let clientLineId = '';
        let selectedPackage = 'Not specified';
        let location = '';
        let profession = '';
        let englishReality = '';
        let goal3Month = '';
        let conversationTopics = '';

        fields.forEach(field => {
            const label = field.label ? field.label.toLowerCase() : '';
            const value = field.value;

            if (!value) return;

            if (label.includes('name') || label.includes('full name')) {
                clientName = Array.isArray(value) ? value.join(' ') : String(value);
            } else if (label.includes('email')) {
                clientEmail = String(value);
            } else if (label.includes('line') || label.includes('messaging')) {
                clientLineId = String(value);
            } else if (label.includes('package') || label.includes('select')) {
                selectedPackage = Array.isArray(value) ? value.join(', ') : String(value);
            } else if (label.includes('location') || label.includes('address') || label.includes('city')) {
                location = Array.isArray(value) ? value.join(', ') : String(value);
            } else if (label.includes('profession') || label.includes('field') || label.includes('job')) {
                profession = Array.isArray(value) ? value.join(', ') : String(value);
            } else if (label.includes('current english reality') || label.includes('reality')) {
                englishReality = Array.isArray(value) ? value.join(', ') : String(value);
            } else if (label.includes('3-month goal') || label.includes('goal')) {
                goal3Month = Array.isArray(value) ? value.join(', ') : String(value);
            } else if (label.includes('conversation topics') || label.includes('topics')) {
                conversationTopics = Array.isArray(value) ? value.join(', ') : String(value);
            }
        });

        const submissionTimestamp = new Date().toISOString();

        await triggerAppsScript({
            action: 'append_row',
            name: clientName,
            email: clientEmail,
            lineId: clientLineId,
            packageSelected: selectedPackage,
            timestamp: submissionTimestamp,
            location: location,
            profession: profession,
            englishReality: englishReality,
            goal3Month: goal3Month,
            conversationTopics: conversationTopics,
            scheduleStatus: 'Pending Booking'
        });

    } catch (error) {
        console.error('Error processing Tally webhook:', error);
    }

    res.status(200).json({ status: 'success' });
});

app.post('/cal-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        const triggerEvent = eventData.triggerEvent || eventData.event;
        const payload = eventData.payload || {};

        const attendees = payload.attendees || [];
        const clientEmail = attendees[0]?.email || payload.email;
        const clientName = attendees[0]?.name || payload.name || 'Unknown Client';
        const lineId = payload.responses?.line_id || payload.customAnswers?.line_id || 'Not provided';
        const eventTitle = payload.title || payload.eventType?.title || 'Free Intro Chat';
        const startTime = payload.startTime || payload.start;
        const location = payload.location || 'Online / Video Call';

        if (triggerEvent === 'BOOKING_CREATED') {
            await triggerAppsScript({
                action: 'update_status',
                email: clientEmail,
                scheduleStatus: 'Confirmed',
                bookingTimestamp: startTime,
                location: location
            });

            await sendLineNotification(`BOOKING CREATED\nName: ${clientName}\nEmail: ${clientEmail}\nEvent: ${eventTitle}\nTime: ${startTime}\nLocation: ${location}`);
        } else if (triggerEvent === 'BOOKING_CANCELLED' || triggerEvent === 'CANCELLED') {
            const cancelReason = payload.cancellationReason || 'No reason provided';
            await triggerAppsScript({
                action: 'update_status',
                email: clientEmail,
                scheduleStatus: 'Cancelled',
                cancellationStatus: 'Cancelled',
                cancellationReason: cancelReason
            });
            await sendLineNotification(`CANCELLATION ALERT\nName: ${clientName}\nEmail: ${clientEmail}\nReason: ${cancelReason}`);
        }

        const isFreeIntro = eventTitle.toLowerCase().includes('free intro chat');
        if (isFreeIntro && triggerEvent === 'MEETING_ENDED' && clientEmail) {
            const personalizedTallyUrl = `https://tally.so/r/lb26p6?name=${encodeURIComponent(clientName)}&email=${encodeURIComponent(clientEmail)}&line_id=${encodeURIComponent(lineId)}`;
            await triggerAppsScript({
                action: 'send_email',
                name: clientName,
                email: clientEmail,
                tallyUrl: personalizedTallyUrl
            });
        }
    } catch (error) {
        console.error('Error handling Cal.com webhook:', error);
    }
     
    res.status(200).json({ status: 'success' });
});

// ========================================================================== // Render Internal Cron Scheduler (Abandoned Booking Check) // ==========================================================================
async function checkAbandonedBookings() {
    try {
        console.log('Running scheduled abandoned booking check...');
        const result = await triggerAppsScript({ action: 'check_abandoned_pending' });
        if (result && result.abandonedClients && result.abandonedClients.length > 0) {
            for (const client of result.abandonedClients) {
                await axios.post(`https://openclaw-webhook-iz6s.onrender.com/abandoned-alert`, {
                    name: client.name,
                    email: client.email,
                    lineId: client.lineId,
                    packageSelected: client.packageSelected,
                    timestamp: client.timestamp,
                    hoursElapsed: client.hoursElapsed,
                    location: client.location,
                    profession: client.profession,
                    englishReality: client.englishReality,
                    goal3Month: client.goal3Month,
                    conversationTopics: client.conversationTopics
                });
            }
        }
    } catch (error) {
        console.error('Error in scheduled abandoned booking check:', error.message);
    }
}

// Run abandoned check every 15 minutes
setInterval(checkAbandonedBookings, 15 * 60 * 1000);

const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;
setInterval(() => {
    axios.get('https://openclaw-webhook-iz6s.onrender.com/').catch(() => {});
}, KEEP_ALIVE_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
