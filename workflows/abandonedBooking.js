const { sendLineNotification } = require('../services/lineService');
const { triggerAppsScript, cleanTaipeiTimestamp, cleanEventTitle } = require('../services/appsScript');

const THIRTY_MINUTES = 30 * 60 * 1000;

async function runAbandonedBookingCheck() {
    console.log('Running internal cron: Checking for abandoned bookings...');
    try {
        const response = await triggerAppsScript({ action: 'get_pending' });
        if (!response || response.status !== 'success' || !response.data) return;

        const pendingClients = response.data;
        const now = new Date().getTime();

        for (const client of pendingClients) {
            if (!client.timestamp) continue;
            const submittedTime = new Date(client.timestamp).getTime();
            const elapsedMs = now - submittedTime;

            if (elapsedMs > THIRTY_MINUTES) {
                const hoursElapsed = (elapsedMs / (1000 * 60 * 60)).toFixed(1);
                const formattedSubTime = cleanTaipeiTimestamp(client.timestamp);

                const message = `Abandoned Booking ➡️\n\nName: ${client.name}\nEmail: ${client.email}\nLINE ID: ${client.lineId || 'Not provided'}\n\n${cleanEventTitle(client.packageSelected || 'Not specified')}\n${client.bookingDateTime || 'Not specified'}\n\n${formattedSubTime}\nElapsed: ${hoursElapsed} hours \n\nLocation: ${client.location || 'Not provided'}\nProfession: ${client.profession || 'Not provided'}\n\nEnglish Reality: \n${client.englishReality || 'Not provided'}\n\n3-Month Goal: \n${client.goal3Month || 'Not provided'}\n\nConversation Topics: \n${client.conversationTopics || 'Not provided'}`;

                await sendLineNotification(message);

                await triggerAppsScript({
                    action: 'upsert_client',
                    email: client.email,
                    lineId: client.lineId,
                    scheduleStatus: 'Follow-Up Needed'
                });
            }
        }
    } catch (err) {
        console.error('Error in internal abandoned booking cron:', err.message);
    }
}

module.exports = { runAbandonedBookingCheck };
