const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { findUserByEmail,findUserByPhone, findUserByPhoneFull,createUser } = require('../models/userModel');
const {createResetRequestByEmail,findLatestValidResetByEmail,markResetUsed,} = require('../models/passwordResetModel');
const { sendOtpEmail } = require('../utils/mailer');





const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password, phoneNumber } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    const existingPhone = await findUserByPhone(phoneNumber);
    if (existingPhone) {
      return res.status(409).json({ message: 'Phone number already registered' });
}


    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await createUser({
      fullName,
      email,
      passwordHash,
      phoneNumber,
    });

    const token = generateToken(newUser);

    return res.status(201).json({
      message: 'User registered successfully',
      data: {
        user: newUser,
        token,
      },
    });
  } catch (err) {
  console.error(err);

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'Email or phone already registered' });
  }

  return res.status(500).json({ message: 'Server error' });
}

});

// (sau này sẽ thêm /login, /me ở đây)
// ================== LOGIN (HOÀN CHỈNH) ==================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1) Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // 2) Find user by email (có password_hash)
    const user = await findUserByEmail(email.trim());
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // 3) Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // 4) Create JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // 5) Response (KHÔNG trả password_hash)
    return res.status(200).json({
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          phoneNumber: user.phone_number,
          role: user.role,
        },
        token,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ================== FORGOT PASSWORD (OTP via email) ==================
function generateOtp4() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// POST /api/auth/forgot-password-email
router.post('/forgot-password-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const mail = String(email).trim().toLowerCase();

    // ✅ Không lộ email tồn tại hay không
    const user = await findUserByEmail(mail);

    if (user) {
      // (Tuỳ chọn) chống spam: nếu OTP gần đây vẫn còn hiệu lực thì không tạo mới
      const existing = await findLatestValidResetByEmail(mail);
      if (existing) {
        // vẫn trả 200 để UX mượt, không lộ thông tin
        return res.status(200).json({
          message: 'If email exists, OTP has been sent',
        });
      }

      const otp = generateOtp4();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

      // 1) Lưu OTP vào DB
      await createResetRequestByEmail(mail, otp, expiresAt);

      // 2) Gửi email real-time
      await sendOtpEmail(mail, otp);

      console.log('[OTP EMAIL SENT]', mail);
    }

    return res.status(200).json({
      message: 'If email exists, OTP has been sent',
    });
  } catch (err) {
    console.error('Forgot password email error:', err);
    return res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
});



// ================== VERIFY OTP (EMAIL) ==================
// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'email and otp are required' });
    }

    const mail = String(email).trim().toLowerCase();

    const resetRow = await findLatestValidResetByEmail(mail);
    if (!resetRow) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    if (String(resetRow.otp) !== String(otp)) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // OTP đúng => mark used để OTP 1 lần
    await markResetUsed(resetRow.id);

    return res.status(200).json({ message: 'OTP verified' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});





// ================== RESET PASSWORD (OTP) ==================
// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword, confirmNewPassword } = req.body;

    if (!email || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        message: 'email, newPassword, confirmNewPassword are required',
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const mail = String(email).trim().toLowerCase();

    const user = await findUserByEmail(mail);
    if (!user) {
      // không lộ user
      return res.status(200).json({ message: 'Password reset successful' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);

    await pool.query(
      `UPDATE users SET password_hash = ? WHERE email = ?`,
      [newHash, mail]
    );

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});
module.exports = router;

