const { sendLineNotification } = require('./lineService');
const { triggerAppsScript } = require('./appsScript');

async function handleTallyWebhook(req, res) {
    console.log('[Webhook INBOUND] Processing /tally-webhook payload...');
    try {
        const eventData = req.body;
        const payloadData = eventData.data || eventData;
        const fields = payloadData.fields || [];

        let clientName = '';
        let clientEmail = '';
        let clientLineId = '';
        let selectedPackage = 'Not specified';
        let location = '';
        let profession = '';
        let englishReality = '';
        let goal3Month = '';
        let conversationTopics = '';
        let questionText = '';
        let reachMethod = '';

        fields.forEach(field => {
            const label = (field.label || '').trim();
            const labelLower = label.toLowerCase();
            const value = field.value;
            
            if (value === undefined || value === null) return;

            let extracted = [];
            const valuesArr = Array.isArray(value) ? value : [value];

            valuesArr.forEach(v => {
                if (typeof v === 'string' || typeof v === 'number') {
                    if (field.options && Array.isArray(field.options)) {
                        const matchedOpt = field.options.find(opt => opt.id === v || opt.text === v);
                        extracted.push(matchedOpt ? matchedOpt.text : String(v));
                    } else {
                        extracted.push(String(v));
                    }
                } else if (typeof v === 'object' && v !== null) {
                    extracted.push(v.text || v.id || '');
                }
            });

            const valStr = extracted.filter(Boolean).join(', ').trim();
            if (!valStr || valStr.toLowerCase() === 'false') return;

            const valLower = valStr.toLowerCase();

            if (labelLower.includes('name') || labelLower.includes('full name') || labelLower.includes('your name')) {
                clientName = valStr;
            } else if (labelLower.includes('email') || labelLower.includes('e-mail')) {
                clientEmail = valStr;
            } else if (labelLower.includes('line') || labelLower.includes('id') || labelLower.includes('messaging app')) {
                clientLineId = valStr;
            } else if (labelLower.includes('reach you') || labelLower.includes('how should i reach')) {
                reachMethod = valStr;
            } else if (labelLower.includes('location') || labelLower.includes('address')) {
                location = valStr;
            } else if (labelLower.includes('profession') || labelLower.includes('field') || labelLower.includes('job')) {
                profession = valStr;
            } else if (labelLower.includes('reality') || labelLower.includes('statement best describes')) {
                englishReality = valStr;
            } else if (labelLower.includes('goal') || labelLower.includes('three months') || labelLower.includes('3-month')) {
                goal3Month = valStr;
            } else if (labelLower.includes('happily spend') || labelLower.includes('topic') || labelLower.includes('conversation')) {
                conversationTopics = valStr;
            } else if (labelLower.includes('question') || labelLower.includes('ask me anything')) {
                questionText = valStr;
            } else {
                if (valLower.includes('free-intro-chat') || valLower.includes('free intro')) selectedPackage = 'Free Intro Chat';
                else if (valLower.includes('intensive-retainer')) selectedPackage = 'Weekly Intensive Retainer';
                else if (valLower.includes('monthly-retainer')) selectedPackage = 'Monthly Retainer + LINE Support';
                else if (valLower.includes('flex-pass')) selectedPackage = 'Flex Pass';
                else if (valLower.includes('deep-dive')) selectedPackage = 'Deep Dive';
                else if (valLower.includes('single-session')) selectedPackage = 'Single Session';
                else if (labelLower.includes('package') || labelLower.includes('pass') || labelLower.includes('select')) selectedPackage = valStr;
            }
        });

        if (reachMethod) {
            if (reachMethod.includes('@')) {
                clientEmail = clientEmail || reachMethod;
            } else {
                clientLineId = clientLineId || reachMethod;
            }
        }

        if (payloadData.query) {
            clientName = payloadData.query.name || clientName;
            clientEmail = payloadData.query.email || clientEmail;
            clientLineId = payloadData.query.line_id || clientLineId;
        }

        const isTallyZero = !clientEmail && !clientLineId && !clientName && fields.length === 0;
        if (isTallyZero) {
            console.log('[Tally Zero] Received empty submission or page load ping. Skipping CRM log.');
            return res.status(200).json({ status: 'success', message: 'Tally 0 ignored successfully' });
        }

        if (questionText) {
            console.log('[Tally Question] Processing "Have a Question?" submission...');
            const qMessage = `Incoming Question...\n\nQuestion: \n${questionText}\n\nName: ${clientName || 'Not provided'}\nEmail: ${clientEmail || 'Not provided'}\nLINE ID: ${clientLineId || 'Not provided'}`;

            await sendLineNotification(qMessage);
            await triggerAppsScript({
                action: 'upsert_client',
                timestamp: new Date().toISOString(),
                name: clientName || 'Unknown Questioner',
                email: clientEmail,
                lineId: clientLineId,
                scheduleStatus: 'Follow-Up Needed',
                questionText: questionText
            });

            return res.status(200).json({ status: 'success', message: 'Question processed and notified' });
        }

        let credits = 0;
        const pkgLower = selectedPackage.toLowerCase();
        if (pkgLower.includes('intensive') || pkgLower.includes('monthly') || pkgLower.includes('flex')) credits = 4;
        else if (pkgLower.includes('deep dive') || pkgLower.includes('single session') || pkgLower.includes('intro')) credits = 1;

        console.log(`[Tally Parsed Data] Upserting Client -> Name: ${clientName}, Email: ${clientEmail}, Line ID: ${clientLineId}, Package: ${selectedPackage}`);

        await triggerAppsScript({
            action: 'upsert_client',
            timestamp: new Date().toISOString(),
            name: clientName,
            email: clientEmail,
            lineId: clientLineId,
            location: location,
            profession: profession,
            englishReality: englishReality,
            goal3Month: goal3Month,
            conversationTopics: conversationTopics,
            packageSelected: selectedPackage,
            paymentStatus: 'Pending',
            sessionCredits: credits,
            scheduleStatus: 'Pending Booking'
        });

        console.log('[Webhook OUTBOUND SUCCESS] Tally data upserted to CRM.');
        return res.status(200).json({ status: 'success', message: 'Upserted Tally data to CRM' });
    } catch (err) {
        console.error('Error processing Tally webhook:', err.message);
        return res.status(500).json({ status: 'error', message: err.message });
    }
}

module.exports = { handleTallyWebhook };
