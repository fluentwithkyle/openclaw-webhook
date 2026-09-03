const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// ==========================================
// LINE Notification Helper
// ==========================================
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

// ==========================================
// Server Health Check Route
// ==========================================
app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

// ==========================================
// Primary Webhook Route (Cal.com & Tally)
// ==========================================
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

        console.log(`Event Title: ${eventTitle}`);
        console.log(`Trigger Type: ${triggerEvent}`);
        console.log(`Parsed Client Name: ${clientName}`);
        console.log(`Parsed Client Email: ${clientEmail}`);
        console.log(`Parsed Client LINE ID: ${lineId}`);
        console.log(`Parsed Tally Questions: ${tallyQuestions}`);

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
            try {
                const scriptResponse = await fetch('https://script.google.com/macros/s/AKfycbzh7dEtGMxxYhZuiqOxw1LByPjA4xZM6_W8c-PCK_K10tmDazmt4kefFAVMW1r8T47D/exec', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: clientEmail,
                        name: clientName,
                        tallyUrl: personalizedTallyUrl
                    })
                });

                const scriptResult = await scriptResponse.json();
                console.log('Google Apps Script Email Response:', scriptResult);
            } catch (error) {
                console.error('Failed to send email via Google Apps Script:', error);
            }
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
