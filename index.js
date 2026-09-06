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
   console.log(`[Apps Script OUTBOUND] Action: ${payload.action}`, JSON.stringify(payload, null, 2));
   try {
     const response = await axios.post(APPS_SCRIPT_URL, payload, {
       headers: { 'Content-Type': 'application/json' }
     });
     console.log(`[Apps Script INBOUND] Action: ${payload.action} Response:`, JSON.stringify(response.data, null, 2));
     return response.data;
   } catch (error) {
     console.error(`[Apps Script ERROR] Action: ${payload.action} Failed:`, error.message);
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

app.post('/abandoned-alert', async (req, res) => {
   console.log('[Webhook INBOUND] Hit /abandoned-alert with body:', JSON.stringify(req.body, null, 2));
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
    console.log('[Webhook INBOUND] Processing /tally-webhook payload...');
    try {
        const eventData = req.body;
        const payloadData = eventData.data || eventData;
        const fields = payloadData.fields || [];

        let clientName = '';
        let clientEmail = '';
        let clientLineId = '';
        let selectedPackage = 'Not specified';
        let location = '';
        let profession = '';
        let englishReality = '';
        let goal3Month = '';
        let conversationTopics = '';
        let questionText = '';

        function getFieldText(field) {
            const value = field.value;
            if (value === undefined || value === null) return '';
            
            if (typeof value === 'boolean') {
                return value ? field.label : '';
            }

            if (field.options && Array.isArray(field.options)) {
                const valArray = Array.isArray(value) ? value : [value];
                const matchedTexts = field.options
                    .filter(opt => valArray.includes(opt.id) || valArray.includes(opt.text))
                    .map(opt => opt.text);
                if (matchedTexts.length > 0) {
                    return matchedTexts.join(', ');
                }
            }

            if (Array.isArray(value)) {
                return value.join(', ');
            }
            return String(value);
        }

        fields.forEach(field => {
            const label = (field.label || '').toLowerCase();
            const valStr = getFieldText(field);
            if (!valStr || valStr === 'false') return;

            const valLower = valStr.toLowerCase();

            if (label.includes('name') || label.includes('full name') || label.includes('your name')) {
                clientName = valStr;
            } else if (label.includes('email') || label.includes('e-mail')) {
                clientEmail = valStr;
            } else if (label.includes('line') || label.includes('id') || label.includes('app id')) {
                clientLineId = valStr;
            } else if (label.includes('location') || label.includes('address')) {
                location = valStr;
            } else if (label.includes('profession') || label.includes('field') || label.includes('job') || label.includes('manager')) {
                profession = valStr;
            } else if (label.includes('reality') || label.includes('statement best describes') || label.includes('current english')) {
                englishReality = valStr;
            } else if (label.includes('goal') || label.includes('three months') || label.includes('3-month') || label.includes('difficult today')) {
                goal3Month = valStr;
            } else if (label.includes('happily spend') || label.includes('topic') || label.includes('conversation')) {
                conversationTopics = valStr;
            } else if (label === 'have a question?' || label.includes('your question') || (label.includes('question') && !label.includes('goal') && !label.includes('topic'))) {
                questionText = valStr;
            } else {
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

        const isTallyZero = !clientEmail && !clientName && fields.length === 0;
        if (isTallyZero) {
            console.log('[Tally Zero] Received empty submission or page load ping. Skipping CRM log.');
            return res.status(200).json({ status: 'success', message: 'Tally 0 ignored successfully' });
        }

        const isQuestionSubmission = !!questionText && !profession && !englishReality && !goal3Month;

        if (isQuestionSubmission) {
            console.log('[Tally Question] Processing "Have a Question?" submission...');
            const qMessage = `QUESTION RECEIVED!
Name: ${clientName || 'Not provided'}
Email: ${clientEmail || 'Not provided'}
LINE ID: ${clientLineId || 'Not provided'}
Question: ${questionText}`;

            await sendLineNotification(qMessage);

            await triggerAppsScript({
                action: 'append_row',
                timestamp: new Date().toISOString(),
                name: clientName || 'Unknown Questioner',
                email: clientEmail || 'no-email-' + Date.now(),
                lineId: clientLineId,
                packageSelected: 'Question Received',
                paymentStatus: 'N/A',
                sessionCredits: 0,
                scheduleStatus: 'Question Received',
                questionText: questionText
            });

            return res.status(200).json({ status: 'success', message: 'Question processed and notified' });
        }

        let credits = 0;
        const pkgLower = selectedPackage.toLowerCase();
        if (pkgLower.includes('intensive') || pkgLower.includes('monthly') || pkgLower.includes('flex')) credits = 4;
        else if (pkgLower.includes('deep dive') || pkgLower.includes('single session') || pkgLower.includes('intro')) credits = 1;

        console.log(`[Tally Parsed Data] Upserting Client -> Name: ${clientName}, Email: ${clientEmail}, Package: ${selectedPackage}`);

        await triggerAppsScript({
            action: 'upsert_client',
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

        console.log('[Webhook OUTBOUND SUCCESS] Tally data upserted to CRM.');
        res.status(200).json({ status: 'success', message: 'Upserted Tally data to CRM' });
    } catch (err) {
        console.error('Error processing Tally webhook:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});


app.post('/webhook', async (req, res) => {
    console.log('[Webhook INBOUND] Processing global /webhook payload...');
    const eventData = req.body;
    const triggerEvent = eventData.triggerEvent || eventData.event || '';
    const payload = eventData.payload || eventData;
    const attendees = payload.attendees || [];
    
    console.log(`[Global Webhook Meta] TriggerEvent: ${triggerEvent}, Attendees count: ${attendees.length}`);

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
        let notes = payload.additionalNotes || payload.notes || 'None';
        let guestsStr = payload.additionalGuests?.length ? payload.additionalGuests.join(', ') : 'None';

        // Fetch client diagnostic context from CRM via Apps Script using email reference
        let clientContext = { profession: 'Not provided', englishReality: 'Not provided', goal3Month: 'Not provided', conversationTopics: 'Not provided', lineId: lineId };
        if (clientEmail) {
            const lookupRes = await triggerAppsScript({
                action: 'get_client_by_email',
                email: clientEmail
            });
            if (lookupRes && lookupRes.status === 'success' && lookupRes.data) {
                clientContext = {
                    profession: lookupRes.data.profession || 'Not provided',
                    englishReality: lookupRes.data.englishReality || 'Not provided',
                    goal3Month: lookupRes.data.goal3Month || 'Not provided',
                    conversationTopics: lookupRes.data.conversationTopics || 'Not provided',
                    lineId: lookupRes.data.lineId || lineId
                };
            }
        }

        const lineMessage = `Event Type: ${eventTitle}
Name: ${clientName}
Date/Start-End Time: ${formattedTime}
Location: ${location}
LINE ID: ${clientContext.lineId || 'Not provided'}
Email: ${clientEmail}
Notes: ${notes}
Additional Guests: ${guestsStr}

--- CLIENT DIAGNOSTIC CONTEXT ---
Profession: ${clientContext.profession}
English Reality: ${clientContext.englishReality}
3-Month Goal: ${clientContext.goal3Month}
Conversation Topics: ${clientContext.conversationTopics}`;

        if (triggerEvent === 'BOOKING_CREATED' || !triggerEvent) {
            await sendLineNotification(lineMessage);
            if (clientEmail) {
                await triggerAppsScript({
                    action: 'update_status',
                    email: clientEmail,
                    scheduleStatus: 'Confirmed',
                    location: location,
                    bookingDateTime: formattedTime,
                    bookingNotes: notes
                });
            }
        } else if (triggerEvent === 'BOOKING_CANCELLED') {
            const cancelReason = payload.cancellationReason || payload.reason || 'None provided';
            await triggerAppsScript({
                action: 'update_status',
                email: clientEmail,
                scheduleStatus: 'Cancelled',
                cancellationStatus: 'Cancelled',
                cancellationReason: cancelReason
            });

            const cancelMessage = `CANCELLATION ALERT
Name: ${clientName}
Email: ${clientEmail}
LINE ID: ${clientContext.lineId || 'Not provided'}
Package / Event: ${eventTitle}
Profession: ${clientContext.profession}
English Reality: ${clientContext.englishReality}
3-Month Goal: ${clientContext.goal3Month}
Conversation Topics: ${clientContext.conversationTopics}
Reason: ${cancelReason}`;

            await sendLineNotification(cancelMessage);
        }

        const isFreeIntro = eventTitle.toLowerCase().includes('free intro chat');
        if (isFreeIntro && triggerEvent === 'MEETING_ENDED' && clientEmail) {
            console.log(`[Meeting Ended Trigger] Free intro meeting ended for ${clientEmail}. Preparing personalized Tally email...`);
            const targetLineId = clientContext.lineId || lineId;
            const personalizedTallyUrl = `https://tally.so/r/lb26p6?name=${encodeURIComponent(clientName)}&email=${encodeURIComponent(clientEmail)}&line_id=${encodeURIComponent(targetLineId)}`;
            const firstName = clientName.split(' ')[0] || clientName;

            const templateRes = await triggerAppsScript({
                action: 'get_template',
                templateKey: 'intro_followup'
            });

            if (templateRes && templateRes.status === 'success' && templateRes.data) {
                let subject = templateRes.data.subject;
                let bodyHtml = templateRes.data.body;

                bodyHtml = bodyHtml.replace(/{{firstName}}/g, firstName)
                                   .replace(/{{tallyUrl}}/g, personalizedTallyUrl);

                await triggerAppsScript({
                    action: 'send_email',
                    email: clientEmail,
                    subject: subject,
                    htmlBody: bodyHtml
                });
                console.log(`[Email Sent] Follow-up email successfully dispatched to ${clientEmail}`);
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
