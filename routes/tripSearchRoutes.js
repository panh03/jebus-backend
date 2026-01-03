const router = require("express").Router();
const db = require("../config/db");

// helper: JS weekday -> mask (Mon=1 ... Sun=64)
function weekdayToMask(date) {
  const jsDay = new Date(date).getDay(); // Sun=0..Sat=6
  const map = { 1:1, 2:2, 3:4, 4:8, 5:16, 6:32, 0:64 };
  return map[jsDay];
}

// 1) GET /api/trips/available-dates?fromProvinceId=1&toProvinceId=2&days=60
router.get("/available-dates", async (req, res) => {
  try {
    const { fromProvinceId, toProvinceId, days = 60 } = req.query;
    const fromId = Number(fromProvinceId);
    const toId = Number(toProvinceId);
    const nDays = Math.max(1, Math.min(Number(days) || 60, 120));

    // find route
    const [routeRows] = await db.query(
      `SELECT id FROM routes WHERE from_province_id=? AND to_province_id=? AND is_active=1 LIMIT 1`,
      [fromId, toId]
    );
    if (routeRows.length === 0) return res.json({ routeId: null, dates: [] });
    const routeId = routeRows[0].id;

    // get trips in route
    const [tripRows] = await db.query(
      `SELECT id FROM trips WHERE route_id=? AND is_active=1`,
      [routeId]
    );
    if (tripRows.length === 0) return res.json({ routeId, dates: [] });

    // generate dates next nDays and filter by operating mask
    const today = new Date();
    const dates = [];
    for (let i = 0; i < nDays; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const iso = `${yyyy}-${mm}-${dd}`;

      const mask = weekdayToMask(iso);

      // if any trip operates that day (simple check)
      // (tối ưu sau bằng query lớn, giờ làm rõ flow)
      let ok = false;
      for (const t of tripRows) {
        const [op] = await db.query(
          `SELECT 1 FROM trip_operating_days
           WHERE trip_id=? AND is_active=1
           AND (weekday_mask & ?) != 0
           AND (start_date IS NULL OR start_date <= ?)
           AND (end_date IS NULL OR end_date >= ?)
           LIMIT 1`,
          [t.id, mask, iso, iso]
        );
        if (op.length) { ok = true; break; }
      }
      if (ok) dates.push(iso);
    }

    res.json({ routeId, dates });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 2) GET /api/trips/departure-times?routeId=1&date=2025-11-19
router.get("/departure-times", async (req, res) => {
  try {
    const { routeId, date } = req.query;
    if (!routeId || !date) return res.status(400).json({ message: "routeId and date required" });

    const [rows] = await db.query(
      `
      SELECT 
        t.id AS tripId,
        ts.depart_time AS departTime,
        t.base_price AS price,
        (t.total_seats - IFNULL(si.reserved_seats,0) - IFNULL(si.locked_seats,0)) AS availableSeats
      FROM trips t
      JOIN trip_schedules ts ON ts.trip_id = t.id AND ts.is_active=1
      LEFT JOIN seat_inventory si ON si.trip_id = t.id AND si.travel_date = ?
      WHERE t.route_id = ? AND t.is_active=1
      ORDER BY ts.depart_time
      `,
      [date, Number(routeId)]
    );

    // Group by time (nếu nhiều trip cùng giờ bạn có thể min price, sum seats, hoặc list)
    const times = rows.map(r => ({
      time: String(r.departTime).slice(0,5),
      availableSeats: Math.max(0, Number(r.availableSeats)),
      price: Number(r.price),
      tripId: r.tripId
    }));

    res.json({ date, times });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 3) GET /api/trips/passenger-options?tripId=1&date=2025-11-19&maxPerOrder=5
router.get("/passenger-options", async (req, res) => {
  try {
    const { tripId, date, maxPerOrder = 5 } = req.query;
    if (!tripId || !date) return res.status(400).json({ message: "tripId and date required" });

    const [rows] = await db.query(
      `
      SELECT 
        t.total_seats,
        IFNULL(si.reserved_seats,0) AS reserved_seats,
        IFNULL(si.locked_seats,0) AS locked_seats
      FROM trips t
      LEFT JOIN seat_inventory si ON si.trip_id=t.id AND si.travel_date=?
      WHERE t.id=? AND t.is_active=1
      LIMIT 1
      `,
      [date, Number(tripId)]
    );

    if (!rows.length) return res.json({ options: [], availableSeats: 0, maxPerOrder: Number(maxPerOrder) });

    const r = rows[0];
    const availableSeats = Math.max(0, Number(r.total_seats) - Number(r.reserved_seats) - Number(r.locked_seats));
    const max = Math.max(1, Math.min(availableSeats, Number(maxPerOrder) || 5));
    const options = [];
    for (let i = 1; i <= max; i++) options.push(i);

    res.json({ availableSeats, maxPerOrder: Number(maxPerOrder), options });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 4) POST /api/trips/search
router.post("/search", async (req, res) => {
  try {
    const { fromProvinceId, toProvinceId, travelDate, departTime, passengers } = req.body;

    if (!fromProvinceId || !toProvinceId || !travelDate || !departTime || !passengers) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // find route
    const [routeRows] = await db.query(
      `SELECT id FROM routes WHERE from_province_id=? AND to_province_id=? AND is_active=1 LIMIT 1`,
      [Number(fromProvinceId), Number(toProvinceId)]
    );
    if (!routeRows.length) return res.json({ data: [] });
    const routeId = routeRows[0].id;

    // find trips by route + depart time + seat availability in date
    const [rows] = await db.query(
      `
      SELECT 
        t.id AS tripId,
        t.operator_name AS operator,
        TIME_FORMAT(ts.depart_time, '%H:%i') AS departTime,
        TIME_FORMAT(ts.arrive_time, '%H:%i') AS arriveTime,
        t.base_price AS price,
        (t.total_seats - IFNULL(si.reserved_seats,0) - IFNULL(si.locked_seats,0)) AS availableSeats
      FROM trips t
      JOIN trip_schedules ts ON ts.trip_id=t.id AND ts.is_active=1
      LEFT JOIN seat_inventory si ON si.trip_id=t.id AND si.travel_date=?
      WHERE t.route_id=? AND t.is_active=1
        AND TIME_FORMAT(ts.depart_time, '%H:%i') = ?
      ORDER BY t.base_price ASC
      `,
      [travelDate, routeId, String(departTime)]
    );

    const need = Number(passengers);
    const data = rows
      .map(r => ({ ...r, availableSeats: Math.max(0, Number(r.availableSeats)) }))
      .filter(r => r.availableSeats >= need);

    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});



module.exports = router;
