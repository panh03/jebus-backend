const pool = require('../config/db');

/**
 * Find user by email (dùng cho login + register check)
 */
async function findUserByEmail(email) {
  const [rows] = await pool.query(
    `SELECT 
        id,
        full_name,
        email,
        password_hash,
        phone_number,
        role
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  return rows[0];
}

/**
 * Find user by phone number (dùng cho register check)
 */
async function findUserByPhone(phoneNumber) {
  const [rows] = await pool.query(
    `SELECT id
     FROM users
     WHERE phone_number = ?
     LIMIT 1`,
    [phoneNumber]
  );
  return rows[0];
}
async function findUserByPhoneFull(phoneNumber) {
  const [rows] = await pool.query(
    `SELECT id, email, full_name, phone_number, role
     FROM users
     WHERE phone_number = ?
     LIMIT 1`,
    [phoneNumber]
  );
  return rows[0];
}


/**
 * Create new user
 */
async function createUser({ fullName, email, phoneNumber, passwordHash }) {
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, phone_number, password_hash)
     VALUES (?, ?, ?, ?)`,
    [fullName, email, phoneNumber, passwordHash]
  );

  return {
    id: result.insertId,
    fullName,
    email,
    phoneNumber,
    role: 'USER',
  };
}

module.exports = {
  findUserByEmail,
  findUserByPhone,
  findUserByPhoneFull,
  createUser,
};
