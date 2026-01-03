const pool = require('../config/db');

async function createResetRequestByEmail(email, otp, expiresAt) {
  if (typeof email !== 'string') throw new Error('Email must be a string');

  const mail = email.trim().toLowerCase();

  const [result] = await pool.query(
    `INSERT INTO password_resets (email, otp, expires_at, used)
     VALUES (?, ?, ?, 0)`,
    [mail, String(otp), expiresAt]
  );
  return result.insertId;
}

async function findLatestValidResetByEmail(email) {
  const mail = email.trim().toLowerCase();
  const [rows] = await pool.query(
    `SELECT id, email, otp, expires_at, used, created_at
     FROM password_resets
     WHERE email = ?
       AND used = 0
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [mail]
  );
  return rows[0];
}

async function markResetUsed(id) {
  await pool.query(`UPDATE password_resets SET used = 1 WHERE id = ?`, [id]);
}

module.exports = {
  createResetRequestByEmail,
  findLatestValidResetByEmail,
  markResetUsed,
};
