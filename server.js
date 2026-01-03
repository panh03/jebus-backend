const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const authRoutes = require('./routes/authRoutes');
const locationRoutes = require("./routes/locationRoutes");
const tripSearchRoutes = require("./routes/tripSearchRoutes");
const seatBookingRoutes = require("./routes/seatBookingRoutes");


const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/trips", tripSearchRoutes);
app.use("/api/trips", seatBookingRoutes);



const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`JEbus backend running on port ${PORT}`);
});
