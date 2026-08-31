const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

app.post('/webhook', (req, res) => {
    const eventData = req.body;
    
    console.log('--- RECEIVED WEBHOOK EVENT ---');
    console.log('Trigger Event:', eventData.triggerEvent);

    if (eventData.payload && eventData.payload.attendees) {
        const attendee = eventData.payload.attendees[0];
        const clientName = attendee.name || '';
        const clientEmail = attendee.email || '';

        // Extract the custom LINE ID from Cal.com responses
        let lineId = '';
        const responses = eventData.payload.responses;
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

        console.log(`Client Name: ${clientName}`);
        console.log(`Client Email: ${clientEmail}`);
        console.log(`Client LINE ID: ${lineId}`);

        // Your active Tally #2 link with exact hidden field parameters
        const tallyBaseUrl = 'https://tally.so/r/lb26p6';
        const encodedName = encodeURIComponent(clientName);
        const encodedEmail = encodeURIComponent(clientEmail);
        const encodedLineId = encodeURIComponent(lineId);

        const personalizedTallyUrl = `${tallyBaseUrl}?name=${encodedName}&email=${encodedEmail}&line_id=${encodedLineId}`;
        
        console.log('Generated Personalized Tally #2 URL:');
        console.log(personalizedTallyUrl);
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
