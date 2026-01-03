// routes/seatBookingRoutes.js
const router = require("express").Router();
const db = require("../config/db");

const HOLD_MINUTES = 10;

async function cleanupExpiredHolds(tripId, date) {
  await db.query(
    `UPDATE seat_locks
     SET status='RELEASED'
     WHERE trip_id=? AND travel_date=?
       AND status='HELD'
       AND expires_at <= NOW()`,
    [tripId, date]
  );
}

// GET /api/trips/:tripId/seat-map?date=YYYY-MM-DD
router.get("/:tripId/seat-map", async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: "date is required (YYYY-MM-DD)" });

    await cleanupExpiredHolds(tripId, date);

    const [tpl] = await db.query(
      `SELECT seat_code, floor, sort_order
       FROM seat_templates
       ORDER BY sort_order`
    );

    const [booked] = await db.query(
      `SELECT seat_code FROM booked_seats
       WHERE trip_id=? AND travel_date=?`,
      [tripId, date]
    );
    const bookedSet = new Set(booked.map(x => x.seat_code));

    const [held] = await db.query(
      `SELECT seat_code FROM seat_locks
       WHERE trip_id=? AND travel_date=?
         AND status='HELD'
         AND expires_at > NOW()`,
      [tripId, date]
    );
    const heldSet = new Set(held.map(x => x.seat_code));

    const floors = { LOWER: [], UPPER: [] };

    for (const s of tpl) {
      let status = "available";
      if (bookedSet.has(s.seat_code)) status = "booked";
      else if (heldSet.has(s.seat_code)) status = "held";

      floors[s.floor].push({ code: s.seat_code, status, sortOrder: s.sort_order });
    }

    res.json({ tripId, date, totalSeats: tpl.length, holdMinutes: HOLD_MINUTES, floors });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/trips/:tripId/hold-seats
router.post("/:tripId/hold-seats", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const tripId = Number(req.params.tripId);
    const { date, seatCodes, userId = null } = req.body;

    if (!date || !Array.isArray(seatCodes) || seatCodes.length === 0) {
      return res.status(400).json({ message: "date and seatCodes[] are required" });
    }

    const seats = [...new Set(seatCodes.map(x => String(x).trim().toUpperCase()))];

    await conn.beginTransaction();

    await conn.query(
      `UPDATE seat_locks
       SET status='RELEASED'
       WHERE trip_id=? AND travel_date=?
         AND status='HELD'
         AND expires_at <= NOW()`,
      [tripId, date]
    );

    const [tpl] = await conn.query(
      `SELECT seat_code FROM seat_templates WHERE seat_code IN (${seats.map(() => "?").join(",")})`,
      seats
    );
    if (tpl.length !== seats.length) {
      await conn.rollback();
      return res.status(400).json({ message: "Invalid seat code in seatCodes" });
    }

    const [alreadyBooked] = await conn.query(
      `SELECT seat_code FROM booked_seats
       WHERE trip_id=? AND travel_date=?
         AND seat_code IN (${seats.map(() => "?").join(",")})`,
      [tripId, date, ...seats]
    );
    if (alreadyBooked.length) {
      await conn.rollback();
      return res.status(409).json({
        message: "Some seats are already booked",
        seats: alreadyBooked.map(x => x.seat_code)
      });
    }

    const [alreadyHeld] = await conn.query(
      `SELECT seat_code FROM seat_locks
       WHERE trip_id=? AND travel_date=?
         AND status='HELD' AND expires_at > NOW()
         AND seat_code IN (${seats.map(() => "?").join(",")})`,
      [tripId, date, ...seats]
    );
    if (alreadyHeld.length) {
      await conn.rollback();
      return res.status(409).json({
        message: "Some seats are being held",
        seats: alreadyHeld.map(x => x.seat_code)
      });
    }

    await conn.query(
      `INSERT INTO seat_locks (trip_id, travel_date, seat_code, user_id, expires_at, status)
       VALUES ${seats.map(() => "(?,?,?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 'HELD')").join(",")}`,
      seats.flatMap(code => [tripId, date, code, userId, HOLD_MINUTES])
    );

    await conn.query(
      `INSERT INTO seat_inventory (trip_id, travel_date, reserved_seats, locked_seats)
       VALUES (?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE trip_id=trip_id`,
      [tripId, date]
    );

    await conn.query(
      `UPDATE seat_inventory
       SET locked_seats = locked_seats + ?
       WHERE trip_id=? AND travel_date=?`,
      [seats.length, tripId, date]
    );

    await conn.commit();

    res.json({ tripId, date, seatCodes: seats, holdMinutes: HOLD_MINUTES });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: e.message });
  } finally {
    conn.release();
  }
});

// POST /api/trips/:tripId/confirm-booking
router.post("/:tripId/confirm-booking", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const tripId = Number(req.params.tripId);
    const { date, seatCodes, bookingCode, userId = null } = req.body;

    if (!date || !Array.isArray(seatCodes) || seatCodes.length === 0 || !bookingCode) {
      return res.status(400).json({ message: "date, seatCodes[], bookingCode are required" });
    }

    const seats = [...new Set(seatCodes.map(x => String(x).trim().toUpperCase()))];

    await conn.beginTransaction();

    await conn.query(
      `UPDATE seat_locks
       SET status='RELEASED'
       WHERE trip_id=? AND travel_date=?
         AND status='HELD'
         AND expires_at <= NOW()`,
      [tripId, date]
    );

    const [holds] = await conn.query(
      `SELECT seat_code FROM seat_locks
       WHERE trip_id=? AND travel_date=?
         AND seat_code IN (${seats.map(() => "?").join(",")})
         AND status='HELD'
         AND expires_at > NOW()`,
      [tripId, date, ...seats]
    );

    if (holds.length !== seats.length) {
      await conn.rollback();
      return res.status(409).json({
        message: "Hold missing/expired for some seats",
        held: holds.map(x => x.seat_code),
        requested: seats
      });
    }

    const [alreadyBooked] = await conn.query(
      `SELECT seat_code FROM booked_seats
       WHERE trip_id=? AND travel_date=?
         AND seat_code IN (${seats.map(() => "?").join(",")})`,
      [tripId, date, ...seats]
    );
    if (alreadyBooked.length) {
      await conn.rollback();
      return res.status(409).json({
        message: "Some seats are already booked",
        seats: alreadyBooked.map(x => x.seat_code)
      });
    }

    await conn.query(
      `INSERT INTO booked_seats (trip_id, travel_date, seat_code, booking_code)
       VALUES ${seats.map(() => "(?,?,?,?)").join(",")}`,
      seats.flatMap(code => [tripId, date, code, bookingCode])
    );

    await conn.query(
      `UPDATE seat_locks
       SET status='BOOKED'
       WHERE trip_id=? AND travel_date=?
         AND status='HELD'
         AND seat_code IN (${seats.map(() => "?").join(",")})`,
      [tripId, date, ...seats]
    );

    await conn.query(
      `INSERT INTO seat_inventory (trip_id, travel_date, reserved_seats, locked_seats)
       VALUES (?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE trip_id=trip_id`,
      [tripId, date]
    );

    await conn.query(
      `UPDATE seat_inventory
       SET locked_seats = GREATEST(0, locked_seats - ?),
           reserved_seats = reserved_seats + ?
       WHERE trip_id=? AND travel_date=?`,
      [seats.length, seats.length, tripId, date]
    );

    await conn.commit();

    res.json({ tripId, date, bookingCode, seatCodes: seats, userId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
