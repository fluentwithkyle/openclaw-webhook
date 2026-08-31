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

    // Check if it's a booking payload with attendees
    if (eventData.payload && eventData.payload.attendees) {
        const attendee = eventData.payload.attendees[0];
        const clientName = attendee.name;
        const clientEmail = attendee.email;

        console.log(`Client Name: ${clientName}`);
        console.log(`Client Email: ${clientEmail}`);

        // Extract custom answers (like LINE ID) if present in the payload
        const responses = eventData.payload.responses;
        if (responses) {
            // Cal.com stores custom field inputs inside responses
            console.log('Custom Responses:', JSON.stringify(responses, null, 2));
        }
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
