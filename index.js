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

    // Support both Cal.com payload styles and direct test structures
    const payload = eventData.payload || eventData;
    const attendees = payload.attendees || (payload.responses && payload.responses.attendee ? [payload.responses.attendee] : []);
    
    if (attendees.length > 0 || payload.email || payload.attendeeEmail) {
        const attendee = attendees[0] || {};
        const clientName = attendee.name || payload.name || payload.clientName || 'Valued Client';
        const clientEmail = attendee.email || payload.email || payload.attendeeEmail || '';

        // Extract the custom LINE ID from Cal.com responses
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

        // Your active Tally #2 link with exact hidden field parameters
        const tallyBaseUrl = 'https://tally.so/r/lb26p6';
        const encodedName = encodeURIComponent(clientName);
        const encodedEmail = encodeURIComponent(clientEmail);
        const encodedLineId = encodeURIComponent(lineId);

        const personalizedTallyUrl = `${tallyBaseUrl}?name=${encodedName}&email=${encodedEmail}&line_id=${encodedLineId}`;
        
        console.log('Generated Personalized Tally #2 URL:', personalizedTallyUrl);

        // Send the email automatically via Resend API
        if (clientEmail) {
            try {
                const resendResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
                    },
                    body: JSON.stringify({
                        from: 'onboarding@resend.dev',
                        to: [clientEmail],
                        subject: 'Your Next Steps / Package Selection',
                        html: `<p>Hi ${clientName},</p><p>Thanks for booking a call! Please complete your package selection here: <a href="${personalizedTallyUrl}">Click here to select your package</a></p>`
                    })
                });

                const emailResult = await resendResponse.json();
                console.log('Resend API Response:', emailResult);
            } catch (error) {
                console.error('Failed to send email:', error);
            }
        } else {
            console.log('Skipped email: No client email address found in payload.');
        }
    } else {
        console.log('Webhook received, but no attendee/email data found in standard structure.');
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
