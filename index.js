/* ==========================================================================
   OPENCLAW AUTOMATIONS - RENDER BACKEND SERVER
   - Purpose: Central webhook router for Cal.com & Tally, triggers LINE 
     notifications, communicates with Google Apps Script for Gmail, and logs 
     client data into your Google Sheet CRM.
   ========================================================================== */

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
// Tally Webhook Route (Handles intake forms & package selections)
// ==========================================================================
app.post('/tally-webhook', async (req, res) => {
    try {
        const eventData = req.body;
        console.log('--- RAW TALLY WEBHOOK BODY ---');
        console.log(JSON.stringify(eventData, null, 2));

        // Tally nests form responses inside data.fields
        const payloadData = eventData.data || eventData;
        const fields = payloadData.fields || [];

        let clientName = 'Unknown Client';
        let clientEmail = '';
        let clientLineId = '';
        let selectedPackage = 'Not specified';

        // Loop through Tally's fields array to extract answers and detect packages via URL slugs or labels
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
            } else {
                // Map Cal.com URL slugs and direct package text to official package names
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

        // Fallbacks if query parameters were passed in the Tally URL
        if (payloadData.query) {
            clientName = payloadData.query.name || clientName;
            clientEmail = payloadData.query.email || clientEmail;
            clientLineId = payloadData.query.line_id || clientLineId;
        }

        // Dynamically compute session credits based on your exact tier rules
        let credits = 0;
        const pkgLower = selectedPackage.toLowerCase();
        if (pkgLower.includes('intensive') || pkgLower.includes('monthly') || pkgLower.includes('flex')) {
            credits = 4;
        } else if (pkgLower.includes('deep dive') || pkgLower.includes('single session') || pkgLower.includes('intro')) {
            credits = 1;
        }

        // Send instruction to Google Apps Script to append the row into the 'Clients' tab
        await triggerAppsScript({
            action: 'append_row',
            timestamp: new Date().toISOString(),
            name: clientName,
            email: clientEmail,
            lineId: clientLineId,
            packageSelected: selectedPackage,
            paymentStatus: 'Pending',
            sessionCredits: credits
        });

        res.status(200).json({ status: 'success', message: 'Logged to Google Sheet via Apps Script' });
    } catch (err) {
        console.error('Error processing Tally webhook:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
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
    const eventTitle = payload.title || payload.eventType?.title || 'Unknown Event';
    
    const attendees = payload.attendees || (payload.responses && payload.responses.attendee ? [payload.responses.attendee] : []);
    
    if (attendees.length > 0 || payload.email || payload.attendeeEmail) {
        const attendee = attendees[0] || {};
        const clientName = attendee.name || payload.name || payload.clientName || 'Valued Client';
        const clientEmail = attendee.email || payload.email || payload.attendeeEmail || '';

        const rawStartTime = payload.startTime || '';
        const rawEndTime = payload.endTime || '';
        const location = payload.location || 'Online / None Specified';
        const notes = payload.additionalNotes || payload.description || 'None';
        
        let formattedTime = 'Not specified';
        if (rawStartTime && rawEndTime) {
            const startObj = new Date(rawStartTime);
            const endObj = new Date(rawEndTime);
            formattedTime = `${startObj.toLocaleString()} - ${endObj.toLocaleTimeString()}`;
        }

        let guestsStr = 'None';
        if (payload.guests && Array.isArray(payload.guests) && payload.guests.length > 0) {
            guestsStr = payload.guests.join(', ');
        } else if (attendees.length > 1) {
            guestsStr = attendees.slice(1).map(a => a.email || a.name).join(', ');
        }

        let lineId = '';
        const responses = payload.responses;
        if (responses) {
           for (const key in responses.answers || responses) {
                const answerObj = responses.answers ? responses.answers[key] : responses[key];
                const label = answerObj && answerObj.label ? answerObj.label.toLowerCase() : '';
                const val = answerObj && answerObj.value !== undefined ? answerObj.value : answerObj;
        
                if (key.toLowerCase().includes('line') || label.includes('line')) {
                   lineId = val;
                   break;
                }
            }
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

        const lineMessage = 
`Event Type: ${eventTitle}

Name: ${clientName}

Date/Start-End Time: ${formattedTime}

Location: ${location}

Line ID: ${lineId || 'Not provided'}

Email: ${clientEmail}

Notes: ${notes}

Additional Guests: ${guestsStr}

Tally Questions:
${tallyQuestions || 'Not provided'}`;

        // 1. LINE Notification Logic (Fires only on booking creation)
        if (triggerEvent === 'BOOKING_CREATED' || !triggerEvent) {
            await sendLineNotification(lineMessage);
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

// ==========================================
// Server Port Listener
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
