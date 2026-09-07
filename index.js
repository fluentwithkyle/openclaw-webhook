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

// Helper: Format timestamps to Taipei time (24h, no seconds: MM_DD_YY HH:MM)
function cleanTaipeiTimestamp(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const taipeiDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const mm = String(taipeiDate.getMonth() + 1).padStart(2, '0');
    const dd = String(taipeiDate.getDate()).padStart(2, '0');
    const yy = String(taipeiDate.getFullYear()).slice(-2);
    const hh = String(taipeiDate.getHours()).padStart(2, '0');
    const min = String(taipeiDate.getMinutes()).padStart(2, '0');
    return `${mm}_${dd}_${yy} ${hh}:${min}`;
}

// Clean event titles by removing subtitles like "| Fluent With Kyle"
function cleanEventTitle(title) {
    if (!title) return 'Meeting';
    return title.split('|')[0].trim();
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
                const formattedSubTime = cleanTaipeiTimestamp(client.timestamp);

                const message = `Abandoned Booking ➡️

Name: ${client.name}
Email: ${client.email}
LINE ID: ${client.lineId || 'Not provided'}

${cleanEventTitle(client.packageSelected || 'Not specified')}
${client.bookingDateTime || 'Not specified'}

${formattedSubTime}
Elapsed: ${hoursElapsed} hours 

Location: ${client.location || 'Not provided'}
Profession: ${client.profession || 'Not provided'}

English Reality: 
${client.englishReality || 'Not provided'}

3-Month Goal: 
${client.goal3Month || 'Not provided'}

Conversation Topics: 
${client.conversationTopics || 'Not provided'}`;

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
        let reachMethod = '';

        fields.forEach(field => {
            const label = (field.label || '').trim();
            const labelLower = label.toLowerCase();
            const value = field.value;
            
            if (value === undefined || value === null) return;

            let extracted = [];
            const valuesArr = Array.isArray(value) ? value : [value];

            valuesArr.forEach(v => {
                if (typeof v === 'string' || typeof v === 'number') {
                    if (field.options && Array.isArray(field.options)) {
                        const matchedOpt = field.options.find(opt => opt.id === v || opt.text === v);
                        extracted.push(matchedOpt ? matchedOpt.text : String(v));
                    } else {
                        extracted.push(String(v));
                    }
                } else if (typeof v === 'object' && v !== null) {
                    extracted.push(v.text || v.id || '');
                }
            });

            const valStr = extracted.filter(Boolean).join(', ').trim();
            if (!valStr || valStr.toLowerCase() === 'false') return;

            const valLower = valStr.toLowerCase();

            if (labelLower.includes('name') || labelLower.includes('full name') || labelLower.includes('your name')) {
                clientName = valStr;
            } else if (labelLower.includes('email') || labelLower.includes('e-mail')) {
                clientEmail = valStr;
            } else if (labelLower.includes('line') || labelLower.includes('id') || labelLower.includes('messaging app')) {
                clientLineId = valStr;
            } else if (labelLower.includes('reach you') || labelLower.includes('how should i reach')) {
                reachMethod = valStr;
            } else if (labelLower.includes('location') || labelLower.includes('address')) {
                location = valStr;
            } else if (labelLower.includes('profession') || labelLower.includes('field') || labelLower.includes('job')) {
                profession = valStr;
            } else if (labelLower.includes('reality') || labelLower.includes('statement best describes')) {
                englishReality = valStr;
            } else if (labelLower.includes('goal') || labelLower.includes('three months') || labelLower.includes('3-month')) {
                goal3Month = valStr;
            } else if (labelLower.includes('happily spend') || labelLower.includes('topic') || labelLower.includes('conversation')) {
                conversationTopics = valStr;
            } else if (labelLower.includes('question') || labelLower.includes('ask me anything')) {
                questionText = valStr;
            } else {
                if (valLower.includes('free-intro-chat') || valLower.includes('free intro')) selectedPackage = 'Free Intro Chat';
                else if (valLower.includes('intensive-retainer')) selectedPackage = 'Weekly Intensive Retainer';
                else if (valLower.includes('monthly-retainer')) selectedPackage = 'Monthly Retainer + LINE Support';
                else if (valLower.includes('flex-pass')) selectedPackage = 'Flex Pass';
                else if (valLower.includes('deep-dive')) selectedPackage = 'Deep Dive';
                else if (valLower.includes('single-session')) selectedPackage = 'Single Session';
                else if (labelLower.includes('package') || labelLower.includes('pass') || labelLower.includes('select')) selectedPackage = valStr;
            }
        });

        if (reachMethod) {
            if (reachMethod.includes('@')) {
                clientEmail = clientEmail || reachMethod;
            } else {
                clientLineId = clientLineId || reachMethod;
            }
        }

        if (payloadData.query) {
            clientName = payloadData.query.name || clientName;
            clientEmail = payloadData.query.email || clientEmail;
            clientLineId = payloadData.query.line_id || clientLineId;
        }

        const isTallyZero = !clientEmail && !clientLineId && !clientName && fields.length === 0;
        if (isTallyZero) {
            console.log('[Tally Zero] Received empty submission or page load ping. Skipping CRM log.');
            return res.status(200).json({ status: 'success', message: 'Tally 0 ignored successfully' });
        }

        const isQuestionSubmission = !!questionText;

        if (isQuestionSubmission) {
            console.log('[Tally Question] Processing "Have a Question?" submission...');
            const qMessage = `Incoming Question...

Question: 
${questionText}

Name: ${clientName || 'Not provided'}
Email: ${clientEmail || 'Not provided'}
LINE ID: ${clientLineId || 'Not provided'}`;

            await sendLineNotification(qMessage);

            await triggerAppsScript({
                action: 'upsert_client',
                timestamp: new Date().toISOString(),
                name: clientName || 'Unknown Questioner',
                email: clientEmail,
                lineId: clientLineId,
                scheduleStatus: 'Follow-Up Needed',
                questionText: questionText
            });

            return res.status(200).json({ status: 'success', message: 'Question processed and notified' });
        }

        let credits = 0;
        const pkgLower = selectedPackage.toLowerCase();
        if (pkgLower.includes('intensive') || pkgLower.includes('monthly') || pkgLower.includes('flex')) credits = 4;
        else if (pkgLower.includes('deep dive') || pkgLower.includes('single session') || pkgLower.includes('intro')) credits = 1;

        console.log(`[Tally Parsed Data] Upserting Client -> Name: ${clientName}, Email: ${clientEmail}, Line ID: ${clientLineId}, Package: ${selectedPackage}`);

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
        const rawEventTitle = payload.title || payload.eventType?.title || 'Meeting';
        const eventTitle = cleanEventTitle(rawEventTitle);
        
        const rawStartTime = payload.startTime || payload.start_time;
        const rawEndTime = payload.endTime || payload.end_time;
        
        let formattedTime = 'Not specified';
        if (rawStartTime && rawEndTime) {
            const endObj = new Date(rawEndTime);
            const endTimeStr = !isNaN(endObj.getTime()) ? endObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            formattedTime = `${cleanTaipeiTimestamp(rawStartTime)} - ${endTimeStr}`;
        }

        const location = payload.location || '';
        const responses = payload.responses || payload.metadata || {};
        const userFields = payload.userFieldsResponses || {};
        
        let lineId = typeof responses.line_id === 'string' ? responses.line_id : (typeof responses.lineId === 'string' ? responses.lineId : '');
        
        // Helper to extract values robustly from Cal.com responses or userFieldsResponses
        function extractCalField(key) {
            let val = responses[key] || userFields[key] || '';
            if (val && typeof val === 'object') {
                val = val.value || val.text || val.label || JSON.stringify(val);
            }
            return typeof val === 'string' ? val.trim() : '';
        }

        // Safely extract Cal.com custom questions using identifiers
        let guestNameInput = extractCalField('1-on-2-session');
        if (!guestNameInput) {
            guestNameInput = extractCalField('guest_name');
        }
        if (guestNameInput.toLowerCase() === 'is this a 1-on-2 session?' || guestNameInput.toLowerCase() === 'add guest name') {
            guestNameInput = '';
        }

        let guestInfoInput = extractCalField('guest-info');
        if (guestInfoInput.toLowerCase() === 'guest email or line id') {
            guestInfoInput = '';
        }

        let bookingNotes = extractCalField('notes-2');
        if (!bookingNotes) {
            bookingNotes = payload.additionalNotes || payload.notes || responses.notes || '';
        }
        if (bookingNotes && typeof bookingNotes === 'object') {
            bookingNotes = bookingNotes.text || bookingNotes.label || JSON.stringify(bookingNotes);
        }
        if (typeof bookingNotes === 'string') {
            bookingNotes = bookingNotes.trim();
        }
        if (bookingNotes.toLowerCase() === 'want to add anything?') {
            bookingNotes = '';
        }

        let guestEmail = '';
        let guestLineId = '';
        if (guestInfoInput) {
            if (guestInfoInput.includes('@')) {
                guestEmail = guestInfoInput;
            } else {
                guestLineId = guestInfoInput;
            }
        }

        const sessionType = guestNameInput ? '1-on-2' : '1-on-1';

        let clientContext = { profession: 'Not provided', englishReality: 'Not provided', goal3Month: 'Not provided', conversationTopics: 'Not provided', lineId: lineId };
        if (clientEmail || lineId) {
            const lookupRes = await triggerAppsScript({
                action: 'get_client',
                email: clientEmail,
                lineId: lineId
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

        const resolvedLineId = clientContext.lineId || lineId || 'Not provided';
        const guestDisplay = guestNameInput ? ` w/ Guest: ${guestNameInput}` : '';

        const lineMessage = `Booking Created 😎

${eventTitle}
${formattedTime}
Session Type: ${sessionType}${guestDisplay}

Location: ${location || 'Not provided'}
LINE ID: ${resolvedLineId}
Email: ${clientEmail || 'Not provided'}
Guest Email/Line: ${guestInfoInput || 'None'}
Notes: ${bookingNotes || 'None'}

Profession: ${clientContext.profession}

English Reality: 
${clientContext.englishReality}

3-Month Goal: 
${clientContext.goal3Month}

Conversation Topics: 
${clientContext.conversationTopics}`;

        if (triggerEvent === 'BOOKING_CREATED' || !triggerEvent) {
            await sendLineNotification(lineMessage);
            await triggerAppsScript({
                action: 'upsert_client',
                email: clientEmail,
                lineId: resolvedLineId,
                name: clientName,
                scheduleStatus: 'Confirmed',
                location: location,
                bookingDateTime: formattedTime,
                packageSelected: eventTitle,
                sessionType: sessionType,
                guestName: guestNameInput,
                guestEmail: guestEmail,
                guestLineId: guestLineId,
                bookingNotes: bookingNotes
            });
        } else if (triggerEvent === 'BOOKING_CANCELLED') {
            const cancelReason = payload.cancellationReason || payload.reason || 'None provided';
            await triggerAppsScript({
                action: 'upsert_client',
                email: clientEmail,
                lineId: resolvedLineId,
                scheduleStatus: 'Cancelled',
                cancellationStatus: 'Cancelled',
                cancellationReason: cancelReason
            });

            const cancelMessage = `❌ Canceled Booking ❌

Reason: 
${cancelReason}

Name: ${clientName}
Email: ${clientEmail || 'Not provided'}
LINE ID: ${resolvedLineId}

${eventTitle}
${formattedTime}

Location: ${location}

Profession: ${clientContext.profession}

English Reality: 
${clientContext.englishReality}

3-Month Goal: 
${clientContext.goal3Month}

Conversation Topics: 
${clientContext.conversationTopics}`;

            await sendLineNotification(cancelMessage);
        }

        const isFreeIntro = eventTitle.toLowerCase().includes('free intro chat');
        if (isFreeIntro && triggerEvent === 'MEETING_ENDED' && clientEmail) {
            const targetLineId = resolvedLineId;
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
