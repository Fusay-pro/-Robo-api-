require('dotenv').config();
const { createApp } = require('./app');

const app  = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Robotics School API running on port ${PORT}`));

// Start background cron jobs
require('./services/warningCron');
require('./services/reservationReminder');
require('./services/releaseUnconfirmed');
require('./services/sheetsSync');
