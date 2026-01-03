const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');


process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});

dotenv.config();

const authRoutes = require('./routes/authRoutes');
const locationRoutes = require("./routes/locationRoutes");
const tripSearchRoutes = require("./routes/tripSearchRoutes");
const seatBookingRoutes = require("./routes/seatBookingRoutes");


const app = express();

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.status(200).send("JEbus backend OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));




app.use('/api/auth', authRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/trips", tripSearchRoutes);
app.use("/api/trips", seatBookingRoutes);



const PORT = process.env.PORT || 5000;

console.log("MYSQLHOST =", process.env.MYSQLHOST);
console.log("MYSQLDATABASE =", process.env.MYSQLDATABASE);
console.log("MYSQLPORT =", process.env.MYSQLPORT);

console.log("JWT_SECRET exists =", Boolean(process.env.JWT_SECRET));


app.listen(PORT, '0.0.0.0', () => {
  console.log(`JEbus backend running on port ${PORT}`);
});
