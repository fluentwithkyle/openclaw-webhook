const SHEET_ID = '1--ScrsFamPAbBDaa6MThpKdl5RkzUTY5anq2K9OEAvo';

function getSheet(tabName) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(tabName || 'Clients');
}

function upsertClient(data) {
  const sheet = getSheet('Clients');
  const rows = sheet.getDataRange().getValues();
  
  let targetRowIndex = -1;
  const emailIn = data.email ? data.email.toString().toLowerCase().trim() : '';
  const lineIn = data.lineId ? data.lineId.toString().toLowerCase().trim() : '';

  for (let i = 1; i < rows.length; i++) {
    const rowEmail = rows[i][2] ? rows[i][2].toString().toLowerCase().trim() : '';
    const rowLine = rows[i][3] ? rows[i][3].toString().toLowerCase().trim() : '';
    
    if ((emailIn && rowEmail === emailIn) || (lineIn && rowLine === lineIn)) {
      targetRowIndex = i + 1;
      break;
    }
  }

  if (targetRowIndex > -1) {
    const existingRow = rows[targetRowIndex - 1];
    const curName = existingRow[1] || '';
    const curEmail = existingRow[2] || '';
    const curLine = existingRow[3] || '';

    let mergedName = curName;
    if (data.name && !curName.toLowerCase().includes(data.name.toLowerCase())) {
      mergedName = curName ? `${curName}, ${data.name}` : data.name;
    }

    let mergedEmail = curEmail;
    if (data.email && !curEmail.toLowerCase().includes(data.email.toLowerCase())) {
      mergedEmail = curEmail ? `${curEmail}, ${data.email}` : data.email;
    }

    let mergedLine = curLine;
    if (data.lineId && !curLine.toLowerCase().includes(data.lineId.toLowerCase())) {
      mergedLine = curLine ? `${curLine}, ${data.lineId}` : data.lineId;
    }

    sheet.getRange(targetRowIndex, 2).setValue(mergedName);
    sheet.getRange(targetRowIndex, 3).setValue(mergedEmail);
    sheet.getRange(targetRowIndex, 4).setValue(mergedLine);

    if (data.location) sheet.getRange(targetRowIndex, 5).setValue(data.location);
    if (data.profession) sheet.getRange(targetRowIndex, 6).setValue(data.profession);
    if (data.englishReality) sheet.getRange(targetRowIndex, 7).setValue(data.englishReality);
    if (data.goal3Month) sheet.getRange(targetRowIndex, 8).setValue(data.goal3Month);
    if (data.conversationTopics) sheet.getRange(targetRowIndex, 9).setValue(data.conversationTopics);
    if (data.packageSelected) sheet.getRange(targetRowIndex, 10).setValue(data.packageSelected);
    if (data.sessionType) sheet.getRange(targetRowIndex, 11).setValue(data.sessionType);
    if (data.guestName) sheet.getRange(targetRowIndex, 12).setValue(data.guestName);
    if (data.guestEmail) sheet.getRange(targetRowIndex, 13).setValue(data.guestEmail);
    if (data.guestLineId) sheet.getRange(targetRowIndex, 14).setValue(data.guestLineId);
    if (data.paymentStatus) sheet.getRange(targetRowIndex, 15).setValue(data.paymentStatus);
    if (data.sessionCredits !== undefined) sheet.getRange(targetRowIndex, 16).setValue(data.sessionCredits);
    if (data.scheduleStatus) sheet.getRange(targetRowIndex, 17).setValue(data.scheduleStatus);
    if (data.bookingDateTime) sheet.getRange(targetRowIndex, 18).setValue(data.bookingDateTime);
    if (data.cancellationStatus) sheet.getRange(targetRowIndex, 19).setValue(data.cancellationStatus);
    if (data.cancellationReason) sheet.getRange(targetRowIndex, 20).setValue(data.cancellationReason);
    if (data.bookingNotes) sheet.getRange(targetRowIndex, 21).setValue(data.bookingNotes);
    if (data.questionText) {
      const existingQ = existingRow[21] || '';
      const newQ = existingQ ? `${existingQ}\n---\n${data.questionText}` : data.questionText;
      sheet.getRange(targetRowIndex, 22).setValue(newQ);
    }

    return { status: 'success', row: targetRowIndex };
  } else {
    sheet.appendRow([
      data.timestamp || new Date(),
      data.name || '',
      data.email || '',
      data.lineId || '',
      data.location || '',
      data.profession || '',
      data.englishReality || '',
      data.goal3Month || '',
      data.conversationTopics || '',
      data.packageSelected || '',
      data.sessionType || '1-on-1',
      data.guestName || '',
      data.guestEmail || '',
      data.guestLineId || '',
      data.paymentStatus || 'Pending',
      data.sessionCredits || 0,
      data.scheduleStatus || 'Pending Booking',
      data.bookingDateTime || '',
      data.cancellationStatus || '',
      data.cancellationReason || '',
      data.bookingNotes || '',
      data.questionText || ''
    ]);
    return { status: 'success', row: sheet.getLastRow() };
  }
}

function getClientByEmailOrLine(email, lineId) {
  const sheet = getSheet('Clients');
  const rows = sheet.getDataRange().getValues();
  const eIn = email ? email.toString().toLowerCase().trim() : '';
  const lIn = lineId ? lineId.toString().toLowerCase().trim() : '';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rEmail = row[2] ? row[2].toString().toLowerCase().trim() : '';
    const rLine = row[3] ? row[3].toString().toLowerCase().trim() : '';

    if ((eIn && rEmail === eIn) || (lIn && rLine === lIn)) {
      return {
        timestamp: row[0],
        name: row[1],
        email: row[2],
        lineId: row[3],
        location: row[4],
        profession: row[5],
        englishReality: row[6],
        goal3Month: row[7],
        conversationTopics: row[8],
        packageSelected: row[9],
        sessionType: row[10],
        guestName: row[11],
        guestEmail: row[12],
        guestLineId: row[13]
      };
    }
  }
  return null;
}

function getPendingBookings() {
  const sheet = getSheet('Clients');
  const rows = sheet.getDataRange().getValues();
  const pending = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const scheduleStatus = row[16]; // Column Q: Schedule Status (Index 16)
    if (scheduleStatus && scheduleStatus.toString().toLowerCase() === 'pending booking') {
      pending.push({
        timestamp: row[0],
        name: row[1],
        email: row[2],
        lineId: row[3],
        location: row[4],
        profession: row[5],
        englishReality: row[6],
        goal3Month: row[7],
        conversationTopics: row[8],
        packageSelected: row[9]
      });
    }
  }
  return pending;
}

function getEmailTemplate(templateKey) {
  const sheet = getSheet('EmailTemplates');
  const rows = sheet.getDataRange().getValues();
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] && row[0].toString().trim().toLowerCase() === templateKey.toLowerCase()) {
      return {
        subject: row[1],
        body: row[2]
      };
    }
  }
  return null;
}
