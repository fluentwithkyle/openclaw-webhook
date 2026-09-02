const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// ==========================================
// LINE Notification Helper
// Sends direct push messages to your personal LINE account using API credentials
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
// A basic endpoint to verify that the server is online and running on Render
// ==========================================
app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

// ==========================================
// Primary Webhook Route (Cal.com / Tally #1)
// Parses incoming booking payloads, generates a personalized Tally URL, 
// triggers your Google Apps Script email automation, and alerts your LINE account
// ==========================================
app.post('/webhook', async (req, res) => {
    const eventData = req.body;
    
    console.log('--- RAW WEBHOOK BODY ---');
    console.log(JSON.stringify(eventData, null, 2));

    const payload = eventData.payload || eventData;
    const attendees = payload.attendees || (payload.responses && payload.responses.attendee ? [payload.responses.attendee] : []);
    
    if (attendees.length > 0 || payload.email || payload.attendeeEmail) {
        const attendee = attendees[0] || {};
        const clientName = attendee.name || payload.name || payload.clientName || 'Valued Client';
        const clientEmail = attendee.email || payload.email || payload.attendeeEmail || '';

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

        console.log(`Parsed Client Name: ${clientName}`);
        console.log(`Parsed Client Email: ${clientEmail}`);
        console.log(`Parsed Client LINE ID: ${lineId}`);

        const tallyBaseUrl = 'https://tally.so/r/lb26p6';
        const encodedName = encodeURIComponent(clientName);
        const encodedEmail = encodeURIComponent(clientEmail);
        const encodedLineId = encodeURIComponent(lineId);

        const personalizedTallyUrl = `${tallyBaseUrl}?name=${encodedName}&email=${encodedEmail}&line_id=${encodedLineId}`;
        
        console.log('Generated Personalized Tally #2 URL:', personalizedTallyUrl);

        // Send instant LINE notification to your personal account
        await sendLineNotification(`📅 New Booking/Submission!\nName: ${clientName}\nEmail: ${clientEmail}`);

        // Send the email automatically via Google Apps Script Web App
        if (clientEmail) {
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
                console.log('Google Apps Script Response:', scriptResult);
            } catch (error) {
                console.error('Failed to send email via Google Apps Script:', error);
            }
        } else {
            console.log('Skipped email: No client email address found in payload.');
        }
    } else {
        console.log('Webhook received, but no attendee/email data found in standard structure.');
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });
});

// ==========================================
// Server Port Listener
// Binds the Express application to the environment-assigned port (defaulting to 3000)
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
