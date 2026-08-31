const express = require('express');
const app = express();

// This allows your server to read incoming JSON data from Cal.com
app.use(express.json());

// A simple test route to check if your server is awake
app.get('/', (req, res) => {
    res.send('OpenClaw webhook server is running!');
});

// The main webhook endpoint where Cal.com will send data
app.post('/webhook', (req, res) => {
    const eventData = req.body;
    
    console.log('--- RECEIVED WEBHOOK ---');
    console.log(JSON.stringify(eventData, null, 2));
    
    // Send a success response back to Cal.com
    res.status(200).json({ status: 'success', message: 'Webhook received successfully' });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
