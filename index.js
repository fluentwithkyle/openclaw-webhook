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
            // Look for the custom field matching your LINE ID label
            // Cal.com often stores responses as an object or keys based on identifiers
            for (const key in responses) {
                if (responses[key] && (key.toLowerCase().includes('line') || (responses[key].label && responses[key].label.toLowerCase().includes('line')))) {
                    lineId = responses[key].value || responses[key];
                }
            }
        }

        console.log(`Client Name: ${clientName}`);
        console.log(`Client Email: ${clientEmail}`);
        console.log(`Client LINE ID: ${lineId}`);

        // Construct the personalized Tally #2 URL automatically
        // Replace 'YOUR_TALLY_ID' with your actual Tally #2 form ID when ready
        const tallyBaseUrl = 'https://tally.so/r/YOUR_TALLY_ID';
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
