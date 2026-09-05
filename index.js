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

                const message = `ABANDONED BOOKING ALERT
Name: ${client.name}
Email: ${client.email}
LINE ID: ${client.lineId || 'Not provided'}
Package: ${client.packageSelected || 'Not specified'}
Submitted At: ${client.timestamp}
Elapsed: ${hoursElapsed} hours without booking.
Location: ${client.location || 'Not provided'}
Profession: ${client.profession || 'Not provided'}
English Reality: ${client.englishReality || 'Not provided'}
3-Month Goal: ${client.goal3Month || 'Not provided'}
Conversation Topics: ${client.conversationTopics || 'Not provided'}`;

                await sendLineNotification(message);

                // Update status in CRM so it doesn't alert again
                await triggerAppsScript({
                    action: 'update_status',
                    email: client.email,
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

app.post('/abandoned-alert', async (req, res) => {
   try {
     const { name, email, lineId, packageSelected, timestamp, hoursElapsed, location, profession, englishReality, goal3Month, conversationTopics } = req.body;
          
     const message = `ABANDONED BOOKING ALERT
Name: ${name}
Email: ${email}
LINE ID: ${lineId || 'Not provided'}
Package: ${packageSelected || 'Not specified'}
Submitted At: ${timestamp || 'Unknown'}
Elapsed: ${hoursElapsed} hours without booking.
Location: ${location || 'Not provided'}
Profession: ${profession || 'Not provided'}
English Reality: ${englishReality || 'Not provided'}
3-Month Goal: ${goal3Month || 'Not provided'}
Conversation Topics: ${conversationTopics || 'Not provided'}`;

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
            const label = (field.label || '').toLowerCase();
            const value = field.value;
            if (!value) return;

            const valStr = Array.isArray(value) ? value.join(', ') : String(value);
            const valLower = valStr.toLowerCase();

            if (label.includes('name')) clientName = valStr;
            else if (label.includes('email')) clientEmail = valStr;
            else if (label.includes('line')) clientLineId = valStr;
            else if (label.includes('location') || label.includes('address')) location = valStr;
            else if (label.includes('profession') || label.includes('field') || label.includes('job')) profession = valStr;
            else if (label.includes('reality') || label.includes('current english')) englishReality = valStr;
            else if (label.includes('goal') || label.includes('3-month')) goal3Month = valStr;
            else if (label.includes('topic') || label.includes('conversation')) conversationTopics = valStr;
            else {
                if (valLower.includes('free-intro-chat') || valLower.includes('free intro')) selectedPackage = 'Free Intro Chat';
                else if (valLower.includes('intensive-retainer')) selectedPackage = 'Weekly Intensive Retainer';
                else if (valLower.includes('monthly-retainer')) selectedPackage = 'Monthly Retainer + LINE Support';
                else if (valLower.includes('flex-pass')) selectedPackage = 'Flex Pass';
                else if (valLower.includes('deep-dive')) selectedPackage = 'Deep Dive';
                else if (valLower.includes('single-session')) selectedPackage = 'Single Session';
                else if (label.includes('package') || label.includes('pass') || label.includes('select')) selectedPackage = valStr;
            }
        });

        if (payloadData.query) {
            clientName = payloadData.query.name || clientName;
            clientEmail = payloadData.query.email || clientEmail;
            clientLineId = payloadData.query.line_id || clientLineId;
        }

        let credits = 0;
        const pkgLower = selectedPackage.toLowerCase();
        if (pkgLower.includes('intensive') || pkgLower.includes('monthly') || pkgLower.includes('flex')) credits = 4;
        else if (pkgLower.includes('deep dive') || pkgLower.includes('single session') || pkgLower.includes('intro')) credits = 1;

        await triggerAppsScript({
            action: 'append_row',
            timestamp: new Date().toISOString(),
            name: clientName,
            email: clientEmail,
            lineId: clientLineId,
            location: location,
            profession: profession,
            englishReality: englishReality,
            goal3Month: goal3Month,
            conversationTopics: conversationTopics,
            packageSelected: selectedPackage,
            paymentStatus: 'Pending',
            sessionCredits: credits,
            scheduleStatus: 'Pending Booking'
        });

        res.status(200).json({ status: 'success', message: 'Logged Tally data to CRM' });
    } catch (err) {
        console.error('Error processing Tally webhook:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/cal-webhook', async (req, res) => {
  try {
    const payload = req.body.payload || req.body;
    const email = payload.attendees?.[0]?.email || payload.email;
          
    if (!email) return res.status(400).json({ error: 'Attendee email not found' });

    const location = payload.location || 'Online / None Specified';
    const rawStartTime = payload.startTime || '';
    const rawEndTime = payload.endTime || '';
            
    let bookingDateTime = 'Not specified';
    if (rawStartTime && rawEndTime) {
        bookingDateTime = `${new Date(rawStartTime).toLocaleString()} - ${new Date(rawEndTime).toLocaleTimeString()}`;
    }

    const triggerEvent = req.body.triggerEvent || '';
    if (triggerEvent === 'BOOKING_CANCELLED') {
        const cancelReason = payload.cancellationReason || payload.reason || 'None provided';
        await triggerAppsScript({
          action: 'update_status',
          email: email,
          scheduleStatus: 'Cancelled',
          cancellationStatus: 'Cancelled',
          cancellationReason: cancelReason
        });
        await sendLineNotification(`CANCELLATION ALERT\nEmail: ${email}\nReason: ${cancelReason}`);
    } else {
        await triggerAppsScript({
          action: 'update_status',
          email: email,
          scheduleStatus: 'Confirmed',
          location: location,
          bookingDateTime: bookingDateTime
        });
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error handling Cal.com webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook', async (req, res) => {
    const eventData = req.body;
    const triggerEvent = eventData.triggerEvent || eventData.event || '';
    const payload = eventData.payload || eventData;
    const attendees = payload.attendees || [];
    
    if (attendees.length > 0 || payload.email) {
        const clientEmail = attendees[0]?.email || payload.email;
        const clientName = attendees[0]?.name || payload.name || 'Unknown Client';
        const eventTitle = payload.title || payload.eventType?.title || 'Meeting';
        const rawStartTime = payload.startTime || payload.start_time;
        const rawEndTime = payload.endTime || payload.end_time;
        
        let formattedTime = 'Not specified';
        if (rawStartTime && rawEndTime) {
            formattedTime = `${new Date(rawStartTime).toLocaleString()} - ${new Date(rawEndTime).toLocaleTimeString()}`;
        }

        const location = payload.location || 'Online / None Specified';
        const responses = payload.responses || payload.metadata || {};
        
        let lineId = responses.line_id || responses.lineId || '';
        let profession = responses.profession || 'Not provided';
        let englishReality = responses.english_reality || 'Not provided';
        let goal3Month = responses.goal_3_month || 'Not provided';
        let conversationTopics = responses.conversation_topics || 'Not provided';
        let notes = payload.additionalNotes || payload.notes || 'None';
        let guestsStr = payload.additionalGuests?.length ? payload.additionalGuests.join(', ') : 'None';

        const lineMessage = `Event Type: ${eventTitle}
Name: ${clientName}
Date/Start-End Time: ${formattedTime}
Location: ${location}
LINE ID: ${lineId || 'Not provided'}
Email: ${clientEmail}
Notes: ${notes}
Additional Guests: ${guestsStr}

--- CLIENT DIAGNOSTIC CONTEXT ---
Profession: ${profession}
English Reality: ${englishReality}
3-Month Goal: ${goal3Month}
Conversation Topics: ${conversationTopics}`;

        if (triggerEvent === 'BOOKING_CREATED' || !triggerEvent) {
            await sendLineNotification(lineMessage);
            if (clientEmail) {
                await triggerAppsScript({
                    action: 'update_status',
                    email: clientEmail,
                    scheduleStatus: 'Confirmed',
                    location: location,
                    bookingDateTime: formattedTime
                });
            }
        } else if (triggerEvent === 'BOOKING_CANCELLED') {
            const cancelReason = payload.cancellationReason || 'None provided';
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
            const firstName = clientName.split(' ')[0] || clientName;

            // Fetch template dynamically from Google Sheets via Apps Script
            const templateRes = await triggerAppsScript({
                action: 'get_template',
                templateKey: 'intro_followup'
            });

            if (templateRes && templateRes.status === 'success' && templateRes.data) {
                let subject = templateRes.data.subject;
                let bodyHtml = templateRes.data.body;

                // Replace placeholders with client data
                bodyHtml = bodyHtml.replace(/{{firstName}}/g, firstName)
                                   .replace(/{{tallyUrl}}/g, personalizedTallyUrl);

                await triggerAppsScript({
                    action: 'send_email',
                    email: clientEmail,
                    subject: subject,
                    htmlBody: bodyHtml
                });
            } else {
                console.error('Failed to fetch email template from Google Sheets.');
            }
        }
    }
    
    res.status(200).json({ status: 'success' });
});


const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;
setInterval(() => {
    axios.get('https://openclaw-webhook-iz6s.onrender.com/').catch(() => {});
}, KEEP_ALIVE_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
