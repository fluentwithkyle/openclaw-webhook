const axios = require('axios');
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_AUTH_SECRET = process.env.APPS_SCRIPT_AUTH_SECRET;

async function triggerAppsScript(payload) {
   if (!APPS_SCRIPT_URL) {
     console.error('[Apps Script ERROR] APPS_SCRIPT_URL is not configured');
     return;
   }

   if (!APPS_SCRIPT_AUTH_SECRET) {
     console.error('[Apps Script ERROR] APPS_SCRIPT_AUTH_SECRET is not configured');
     return;
   }

   const authenticatedPayload = { ...payload, authSecret: APPS_SCRIPT_AUTH_SECRET };

   console.log(`[Apps Script OUTBOUND] Action: ${payload.action}`);
   try {
     const response = await axios.post(APPS_SCRIPT_URL, authenticatedPayload, {
       headers: { 'Content-Type': 'application/json' }
     });
     console.log(`[Apps Script INBOUND] Action: ${payload.action} Status: ${response.status}`);
     return response.data;
   } catch (error) {
     console.error(`[Apps Script ERROR] Action: ${payload.action} Failed:`, error.message);
   }
}

function cleanTaipeiTimestamp(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const taipeiDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const mm = String(taipeiDate.getMonth() + 1).padStart(2, '0');
    const dd = String(taipeiDate.getDate()).padStart(2, '0');
    const yy = String(taipeiDate.getFullYear()).slice(-2);
    const hh = String(taipeiDate.getHours()).padStart(2, '0');
    const min = String(taipeiDate.getMinutes()).padStart(2, '0');
    return `${mm}_${dd}_${yy} ${hh}:${min}`;
}

function cleanEventTitle(title) {
    if (!title) return 'Meeting';
    return title.split('|')[0].trim();
}

module.exports = { triggerAppsScript, cleanTaipeiTimestamp, cleanEventTitle };
