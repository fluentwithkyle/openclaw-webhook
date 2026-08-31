const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  res.status(200).send('Webhook received successfully');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
