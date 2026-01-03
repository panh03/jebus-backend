const nodemailer = require('nodemailer');

// Tạo transporter Gmail


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
  },
  // Gmail STARTTLS
  secure: false,
  requireTLS: true,

  // timeout để khỏi treo startup
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});


// Verify khi start server
//transporter.verify((err) => {
//  if (err) {
//    console.error('❌ SMTP config error:', err.message);
 // } else {
 //   console.log('✅ SMTP server is ready to send emails');
 // }
//});

async function sendOtpEmail(toEmail, otp) {
  try {
    await transporter.sendMail({
      from: `"JEBus Support" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'JEBus - Mã xác minh OTP',
      html: `
        <h2>JEBus OTP</h2>
        <h1>${otp}</h1>
      `,
    });
  } catch (err) {
    console.warn('⚠️ SMTP send skipped:', err.message);
    // không throw -> backend không chết
  }
}


module.exports = { sendOtpEmail };