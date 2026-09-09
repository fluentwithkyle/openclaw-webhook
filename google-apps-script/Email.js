function sendClientEmail(data) {
  const recipient = data.email;
  const subject = data.subject || "Let's continue your English journey!";
  const htmlBody = data.htmlBody || "<p>Thank you for chatting!</p>";
  
  GmailApp.sendEmail(recipient, subject, "", {
    htmlBody: htmlBody,
    name: "Kyle from Fluent with Kyle"
  });
}
