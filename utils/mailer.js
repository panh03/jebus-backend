const nodemailer = require('nodemailer');

// Tạo transporter Gmail

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
  },
  tls: {
    rejectUnauthorized: false, // 🔥 FIX lỗi self-signed certificate
  },
});

// Verify khi start server
transporter.verify((err) => {
  if (err) {
    console.error('❌ SMTP config error:', err.message);
  } else {
    console.log('✅ SMTP server is ready to send emails');
  }
});

async function sendOtpEmail(toEmail, otp) {
  await transporter.sendMail({
    from: `"JEBus Support" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'JEBus - Mã xác minh OTP',
    html: `
      <div style="font-family: Arial, sans-serif">
        <h2 style="color:#EB2188">JEBus - Xác minh tài khoản</h2>
        <p>Mã OTP của bạn là:</p>
        <h1 style="letter-spacing:4px">${otp}</h1>
        <p>Mã có hiệu lực trong <b>5 phút</b>.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail };