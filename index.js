// ==========================================================================
// OPENCLAW AUTOMATIONS - RENDER BACKEND SERVER
// - Purpose: Central webhook router for Cal.com & Tally, triggers LINE 
//   notifications, communicates with Google Apps Script for Gmail, and logs 
//   client data into your Google Sheet CRM.
// ==========================================================================

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Google Apps Script Web App URL (Acts as your free bridge to Gmail and Google Sheets)
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzh7dEtGMxxYhZuiqOxw1LByPjA4xZM6_W8c-PCK_K10tmDazmt4kefFAVMW1r8T47D/exec';

// ==========================================================================
// LINE Notification Helper
// ==========================================================================
async function sendLineNotification(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    console.log('LINE credentials missing from environment variables; skipping push notification.');
    return;
  }

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: [{ type: 'text', text: text }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );
    console.log('LINE notification sent successfully.');
  } catch (error) {
    console.error('Error sending LINE notification:', error.response?.data || error.message);
  }
}

// ==========================================================================
// Google Apps Script Bridge Helper
// - Sends instructions to your Apps Script to either send emails or append rows.
// ==========================================================================
async function triggerAppsScript(payload) {
  try {
    const response = await axios.post(APPS_SCRIPT_URL, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Google Apps Script Bridge Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to communicate with Google Apps Script:', error.message);
  }
}

// ==========================================================================
// Server Health Check Route
// ==========================================================================
app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

// ==========================================================================
// Abandoned Booking Alert Route
// ==========================================================================
app.post('/abandoned-alert', async (req, res) => {
  try {
    const { name, email, lineId, packageSelected, timestamp, hoursElapsed } = req.body;
    
    const message = 
`ABANDONED BOOKING ALERT

Name: ${name}
Email: ${email}
LINE ID: ${lineId || 'Not provided'}
Package: ${packageSelected || 'Not specified'}
Submitted At: ${timestamp || 'Unknown'}
Elapsed: ${hoursElapsed} hours without booking.`;

    await sendLineNotification(message);
    res.status(200).json({ status: 'success', message: 'Abandoned alert sent' });
  } catch (error) {
    console.error('Error handling abandoned alert:', error);
    res.status(500).json({ error: error.message });
  }
});


// ==========================================================================
// Tally Webhook Route (Handles intake forms & package selections)
// ==========================================================================
app.post('/tally-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        console.log('--- RAW TALLY WEBHOOK BODY ---');
        console.log(JSON.stringify(eventData, null, 2));

        const payloadData = eventData.data || eventData;
        const fields = payloadData.fields || [];

        let clientName = 'Unknown Client';
        let clientEmail = '';
        let clientLineId = '';
        let selectedPackage = 'Not specified';
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

            if (label.includes('name')) {
                clientName = valStr;
            } else if (label.includes('email')) {
                clientEmail = valStr;
            } else if (label.includes('line')) {
                clientLineId = valStr;
            } else if (label.includes('profession') || label.includes('field') || label.includes('job')) {
                profession = valStr;
            } else if (label.includes('reality') || label.includes('current english')) {
                englishReality = valStr;
            } else if (label.includes('goal') || label.includes('3-month')) {
                goal3Month = valStr;
            } else if (label.includes('topic') || label.includes('conversation')) {
                conversationTopics = valStr;
            } else {
                if (valLower.includes('free-intro-chat') || valLower.includes('free intro')) {
                    selectedPackage = 'Free Intro Chat';
                } else if (valLower.includes('intensive-retainer') || valLower.includes('intensive retainer')) {
                    selectedPackage = 'Weekly Intensive Retainer';
                } else if (valLower.includes('monthly-retainer') || valLower.includes('monthly retainer')) {
                    selectedPackage = 'Monthly Retainer + LINE Support';
                } else if (valLower.includes('flex-pass') || valLower.includes('flex pass')) {
                    selectedPackage = 'Flex Pass';
                } else if (valLower.includes('deep-dive') || valLower.includes('deep dive')) {
                    selectedPackage = 'Deep Dive';
                } else if (valLower.includes('single-session') || valLower.includes('single session')) {
                    selectedPackage = 'Single Session';
                } else if (label.includes('package') || label.includes('pass') || label.includes('select') || label.includes('choose') || label.includes('booking url')) {
                    selectedPackage = valStr;
                }
            }
        });

        if (payloadData.query) {
            clientName = payloadData.query.name || clientName;
            clientEmail = payloadData.query.email || clientEmail;
            clientLineId = payloadData.query.line_id || clientLineId;
        }

        let credits = 0;
        const pkgLower = selectedPackage.toLowerCase();
        if (pkgLower.includes('intensive') || pkgLower.includes('monthly') || pkgLower.includes('flex')) {
            credits = 4;
        } else if (pkgLower.includes('deep dive') || pkgLower.includes('single session') || pkgLower.includes('intro')) {
            credits = 1;
        }

        await triggerAppsScript({
            action: 'append_row',
            timestamp: new Date().toISOString(),
            name: clientName,
            email: clientEmail,
            lineId: clientLineId,
            profession: profession,
            englishReality: englishReality,
            goal3Month: goal3Month,
            conversationTopics: conversationTopics,
            packageSelected: selectedPackage,
            paymentStatus: 'Pending',
            sessionCredits: credits,
            scheduleStatus: 'Pending Booking'
        });

        res.status(200).json({ status: 'success', message: 'Logged expanded Tally data to Google Sheet' });
    } catch (err) {
        console.error('Error processing Tally webhook:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});



// ======================================================================== ==
// Cal.com Booking Confirmation Webhook Route (Updates status, location, & time)
// ======================================================================== ==
app.post('/cal-webhook', async (req, res) => {
  try {
    const payload = req.body.payload || req.body;
    const email = payload.attendees?.[0]?.email || payload.email;
          
    if (!email) {
      return res.status(400).json({ error: 'Attendee email not found in webhook payload' });
    }

    const location = payload.location || 'Online / None Specified';
    const rawStartTime = payload.startTime || '';
    const rawEndTime = payload.endTime || '';
            
    let bookingDateTime = 'Not specified';
    if (rawStartTime && rawEndTime) {
        const startObj = new Date(rawStartTime);
        const endObj = new Date(rawEndTime);
        bookingDateTime = `${startObj.toLocaleString()} - ${endObj.toLocaleTimeString()}`;
    }

    const result = await triggerAppsScript({
      action: 'update_status',
      email: email,
      scheduleStatus: 'Confirmed',
      location: location,
      bookingDateTime: bookingDateTime
    });

    res.status(200).json({ status: 'success', result });
  } catch (error) {
    console.error('Error handling Cal.com webhook:', error);
    res.status(500).json({ error: error.message });
  }
});


// ==========================================================================
// Primary Webhook Route (Cal.com Bookings & Meetings)
// ==========================================================================
app.post('/webhook', async (req, res) => {
    const eventData = req.body;
          
    console.log('--- RAW WEBHOOK BODY ---');
    console.log(JSON.stringify(eventData, null, 2));

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
            const startObj = new Date(rawStartTime);
            const endObj = new Date(rawEndTime);
            formattedTime = `${startObj.toLocaleString()} - ${endObj.toLocaleTimeString()}`;
        }

        const location = payload.location || 'Online / None Specified';
        const responses = payload.responses || payload.metadata || {};
        
        let lineId = responses.line_id || responses.lineId || '';
        let profession = responses.profession || responses.field || 'Not provided';
        let englishReality = responses.english_reality || responses.englishReality || 'Not provided';
        let goal3Month = responses.goal_3_month || responses.goal3Month || 'Not provided';
        let conversationTopics = responses.conversation_topics || responses.conversationTopics || 'Not provided';
        let notes = payload.additionalNotes || payload.notes || 'None';
        
        let guestsStr = 'None';
        if (payload.additionalGuests && payload.additionalGuests.length > 0) {
            guestsStr = payload.additionalGuests.join(', ');
        }

        let tallyQuestions = 'Not provided';
        if (responses) {
            const targetAnswer = responses.tally_questions || responses.answers?.tally_questions;
            if (targetAnswer) {
                tallyQuestions = typeof targetAnswer === 'object' ? targetAnswer.value : targetAnswer;
            } else {
                for (const key in responses.answers || responses) {
                    const answerObj = responses.answers ? responses.answers[key] : responses[key];
                    const val = answerObj && answerObj.value !== undefined ? answerObj.value : answerObj;
                    if (key.toLowerCase().includes('tally')) {
                        tallyQuestions = Array.isArray(val) ? val.join(', ') : val;
                        break;
                    }
                }
            }
        }

        const tallyBaseUrl = 'https://tally.so/r/lb26p6';
        const encodedName = encodeURIComponent(clientName);
        const encodedEmail = encodeURIComponent(clientEmail);
        const encodedLineId = encodeURIComponent(lineId);
        const personalizedTallyUrl = `${tallyBaseUrl}?name=${encodedName}&email=${encodedEmail}&line_id=${encodedLineId}`;

        const lineMessage = `Event Type: ${eventTitle}

Name: ${clientName}

Date/Start-End Time: ${formattedTime}

Location: ${location}

Line ID: ${lineId || 'Not provided'}

Email: ${clientEmail}

Notes: ${notes}

Additional Guests: ${guestsStr}

Tally Questions:
${tallyQuestions || 'Not provided'}

--- CLIENT DIAGNOSTIC CONTEXT ---
Profession: ${profession}
English Reality: ${englishReality}
3-Month Goal: ${goal3Month}
Conversation Topics: ${conversationTopics}`;

        // 1. LINE Notification Logic & CRM Update (Fires only on booking creation)
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
        }

        // 2. Google Apps Script Email Logic (Fires only when Free Intro Chat meeting ends)
        const isFreeIntro = eventTitle.toLowerCase().includes('free intro chat');
        const shouldSendEmail = isFreeIntro && triggerEvent === 'MEETING_ENDED';

        if (shouldSendEmail && clientEmail) {
            await triggerAppsScript({
                action: 'send_email',
                name: clientName,
                email: clientEmail,
                tallyUrl: personalizedTallyUrl
            });
        } else {
            console.log(`Skipped email: Condition not met (Is Free Intro: ${isFreeIntro}, Trigger: ${triggerEvent})`);
        }
    } else {
        console.log('Webhook received, but no attendee/email data found.');
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });
});


// Self-ping to keep Render free tier awake every 14 minutes (14 * 60 * 1000 ms)
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;
setInterval(() => {
    axios.get('https://openclaw-webhook-iz6s.onrender.com/')
        .then(() => console.log('Keep-alive ping sent successfully.'))
        .catch(err => console.error('Keep-alive ping failed:', err.message));
}, KEEP_ALIVE_INTERVAL);


// ==========================================
// Server Port Listener
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
