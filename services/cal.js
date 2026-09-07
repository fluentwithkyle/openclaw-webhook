const { sendLineNotification } = require('./lineService');
const { triggerAppsScript, cleanTaipeiTimestamp, cleanEventTitle } = require('./appsScript');

async function handleCalWebhook(req, res) {
    console.log('[Webhook INBOUND] Processing global /webhook payload...');
    const eventData = req.body;
    const triggerEvent = eventData.triggerEvent || eventData.event || '';
    const payload = eventData.payload || eventData;
    const attendees = payload.attendees || [];
    
    console.log(`[Global Webhook Meta] TriggerEvent: ${triggerEvent}, Attendees count: ${attendees.length}`);

    if (attendees.length > 0 || payload.email) {
        const clientEmail = attendees[0]?.email || payload.email;
        const clientName = attendees[0]?.name || payload.name || 'Unknown Client';
        const rawEventTitle = payload.title || payload.eventType?.title || 'Meeting';
        const eventTitle = cleanEventTitle(rawEventTitle);
        
        const rawStartTime = payload.startTime || payload.start_time;
        const rawEndTime = payload.endTime || payload.end_time;
        
        let formattedTime = 'Not specified';
        if (rawStartTime && rawEndTime) {
            const endObj = new Date(rawEndTime);
            const endTimeStr = !isNaN(endObj.getTime()) ? endObj.toLocaleTimeString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            formattedTime = `${cleanTaipeiTimestamp(rawStartTime)} - ${endTimeStr}`;
        }

        const location = payload.location || '';
        const responses = payload.responses || payload.metadata || {};
        const userFields = payload.userFieldsResponses || {};
        
        let lineId = typeof responses.line_id === 'string' ? responses.line_id : (typeof responses.lineId === 'string' ? responses.lineId : '');
        
        function extractCalField(key) {
            let val = responses[key] || userFields[key] || '';
            if (val && typeof val === 'object') {
                val = val.value || val.text || val.label || JSON.stringify(val);
            }
            return typeof val === 'string' ? val.trim() : '';
        }

        let rawGuestField = extractCalField('1-on-2-session') || extractCalField('guest_name');
        let guestInfoInput = extractCalField('guest-info');

        let guestNameInput = '';
        let guestEmail = '';
        let guestLineId = '';

        if (rawGuestField && rawGuestField.toLowerCase() !== 'is this a 1-on-2 session?' && rawGuestField.toLowerCase() !== 'add guest name') {
            if (rawGuestField.includes('@')) {
                guestEmail = rawGuestField;
            } else {
                guestNameInput = rawGuestField;
            }
        }

        if (guestInfoInput && guestInfoInput.toLowerCase() !== 'guest email or line id') {
            if (guestInfoInput.includes('@')) {
                guestEmail = guestEmail || guestInfoInput;
            } else {
                guestLineId = guestInfoInput;
            }
        }

        let bookingNotes = extractCalField('notes-2') || payload.additionalNotes || payload.notes || responses.notes || '';
        if (bookingNotes && typeof bookingNotes === 'object') {
            bookingNotes = bookingNotes.text || bookingNotes.label || JSON.stringify(bookingNotes);
        }
        if (typeof bookingNotes === 'string') {
            bookingNotes = bookingNotes.trim();
        }
        if (bookingNotes.toLowerCase() === 'want to add anything?') {
            bookingNotes = '';
        }

        const sessionType = (guestNameInput || guestEmail || guestLineId) ? '1-on-2' : '1-on-1';

        let clientContext = { profession: 'Not provided', englishReality: 'Not provided', goal3Month: 'Not provided', conversationTopics: 'Not provided', lineId: lineId };
        if (clientEmail || lineId) {
            const lookupRes = await triggerAppsScript({
                action: 'get_client',
                email: clientEmail,
                lineId: lineId
            });
            if (lookupRes && lookupRes.status === 'success' && lookupRes.data) {
                clientContext = {
                    profession: lookupRes.data.profession || 'Not provided',
                    englishReality: lookupRes.data.englishReality || 'Not provided',
                    goal3Month: lookupRes.data.goal3Month || 'Not provided',
                    conversationTopics: lookupRes.data.conversationTopics || 'Not provided',
                    lineId: lookupRes.data.lineId || lineId
                };
            }
        }

        const resolvedLineId = clientContext.lineId || lineId || 'Not provided';
        const guestDisplay = (guestNameInput || guestEmail || guestLineId) ? ` w/ Guest: ${guestNameInput || guestEmail || guestLineId}` : '';

        const lineMessage = `Booking Created 😎\n\n${eventTitle}\n${formattedTime}\nSession Type: ${sessionType}${guestDisplay}\n\nLocation: ${location || 'Not provided'}\nLINE ID: ${resolvedLineId}\nEmail: ${clientEmail || 'Not provided'}\nGuest Email/Line: ${guestInfoInput || 'None'}\nNotes: ${bookingNotes || 'None'}\n\nProfession: ${clientContext.profession}\n\nEnglish Reality: \n${clientContext.englishReality}\n\n3-Month Goal: \n${clientContext.goal3Month}\n\nConversation Topics: \n${clientContext.conversationTopics}`;

        if (triggerEvent === 'BOOKING_CREATED' || !triggerEvent) {
            await sendLineNotification(lineMessage);
            await triggerAppsScript({
                action: 'upsert_client',
                email: clientEmail,
                lineId: resolvedLineId,
                name: clientName,
                scheduleStatus: 'Confirmed',
                location: location,
                bookingDateTime: formattedTime,
                packageSelected: eventTitle,
                sessionType: sessionType,
                guestName: guestNameInput,
                guestEmail: guestEmail,
                guestLineId: guestLineId,
                bookingNotes: bookingNotes
            });
        } else if (triggerEvent === 'BOOKING_CANCELLED') {
            const cancelReason = payload.cancellationReason || payload.reason || 'None provided';
            await triggerAppsScript({
                action: 'upsert_client',
                email: clientEmail,
                lineId: resolvedLineId,
                scheduleStatus: 'Cancelled',
                cancellationStatus: 'Cancelled',
                cancellationReason: cancelReason
            });

            const cancelMessage = `❌ Canceled Booking ❌\n\nReason: \n${cancelReason}\n\nName: ${clientName}\nEmail: ${clientEmail || 'Not provided'}\nLINE ID: ${resolvedLineId}\n\n${eventTitle}\n${formattedTime}\n\nLocation: ${location}\n\nProfession: ${clientContext.profession}\n\nEnglish Reality: \n${clientContext.englishReality}\n\n3-Month Goal: \n${clientContext.goal3Month}\n\nConversation Topics: \n${clientContext.conversationTopics}`;

            await sendLineNotification(cancelMessage);
        }

        const isFreeIntro = eventTitle.toLowerCase().includes('free intro chat');
        if (isFreeIntro && triggerEvent === 'MEETING_ENDED' && clientEmail) {
            const targetLineId = resolvedLineId;
            const personalizedTallyUrl = `https://tally.so/r/lb26p6?name=${encodeURIComponent(clientName)}&email=${encodeURIComponent(clientEmail)}&line_id=${encodeURIComponent(targetLineId)}`;
            const firstName = clientName.split(' ')[0] || clientName;

            const templateRes = await triggerAppsScript({
                action: 'get_template',
                templateKey: 'intro_followup'
            });

            if (templateRes && templateRes.status === 'success' && templateRes.data) {
                let subject = templateRes.data.subject;
                let bodyHtml = templateRes.data.body;

                bodyHtml = bodyHtml.replace(/{{firstName}}/g, firstName)
                                   .replace(/{{tallyUrl}}/g, personalizedTallyUrl);

                await triggerAppsScript({
                    action: 'send_email',
                    email: clientEmail,
                    subject: subject,
                    htmlBody: bodyHtml
                });
            }
        }
    }
    
    return res.status(200).json({ status: 'success' });
}

module.exports = { handleCalWebhook };
