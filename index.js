const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

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
// Tally #2 Webhook Route: Captures package selection after intro meeting
// ==========================================
app.post('/tally-webhook', async (req, res) => {
  try {
    const payload = req.body;
    const submission = payload.data || payload;
    
    const clientName = submission.fields?.find(f => f.label === "Name")?.value || submission.name;
    const clientEmail = submission.fields?.find(f => f.label === "Email")?.value || submission.email;
    const lineId = submission.fields?.find(f => f.label === "LINE ID")?.value || submission.line_id;
    const selectedPackage = submission.fields?.find(f => f.label === "Package Selection")?.value || submission.package;

    console.log(`Received Tally #2 submission for ${clientName} - Package: ${selectedPackage}`);

    res.status(200).json({ status: 'success', message: 'Tally #2 payload received' });
  } catch (error) {
    console.error('Error processing Tally #2 webhook:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
