const router = require("express").Router();
const db = require("../config/db"); // bạn đang có config/db.js

// GET /api/locations/provinces?role=from|to&fromProvinceId=1&q=
router.get("/provinces", async (req, res) => {
  try {
    const { role = "from", fromProvinceId, q = "" } = req.query;
    const keyword = `%${String(q).trim()}%`;

    if (role === "from") {
      const [rows] = await db.query(`
        SELECT DISTINCT p.id, p.name
        FROM routes r
        JOIN provinces p ON p.id = r.from_province_id
        WHERE r.is_active=1 AND p.name LIKE ?
        ORDER BY p.name
        LIMIT 50
      `, [keyword]);

      return res.json({ data: rows });
    }

    if (role === "to") {
      if (!fromProvinceId) return res.json({ data: [] });

      const [rows] = await db.query(`
        SELECT DISTINCT p.id, p.name
        FROM routes r
        JOIN provinces p ON p.id = r.to_province_id
        WHERE r.is_active=1 AND r.from_province_id=? AND p.name LIKE ?
        ORDER BY p.name
        LIMIT 50
      `, [Number(fromProvinceId), keyword]);

      return res.json({ data: rows });
    }

    return res.json({ data: [] });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
