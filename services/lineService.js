const axios = require('axios');

async function sendLineNotification(text) {
   const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
   const userId = process.env.LINE_USER_ID;

   if (!token || !userId) {
     console.log('LINE credentials missing; skipping push notification.');
     return;
   }

   try {
     await axios.post(
       'https://api.line.me/v2/bot/message/push',
       { to: userId, messages: [{ type: 'text', text: text }] },
       { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }
     );
     console.log('LINE notification sent successfully.');
   } catch (error) {
     console.error('Error sending LINE notification:', error.response?.data || error.message);
   }
}

module.exports = { sendLineNotification };
