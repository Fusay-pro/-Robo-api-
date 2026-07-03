const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const { authMiddleware } = require('./middleware/auth');
const { rlsMiddleware }  = require('./config/rls');

function createApp() {
  const app = express();
  // Behind a reverse proxy / tunnel (ngrok), so X-Forwarded-For is set.
  // Trust the first proxy hop so rate-limiting keys on the real client IP.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({
    origin: [process.env.PARENT_APP_URL, process.env.STAFF_APP_URL].filter(Boolean),
    credentials: true,
  }));

  // Rate limiting
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));
  app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));
  // Stricter limit for OTP verification — 5 attempts per 15 min to prevent brute-force
  app.use('/auth/verify-otp', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false }));

  app.use(express.json());
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // Public & webhook routes (no auth)
  app.use('/public',   require('./routes/public'));
  app.use('/webhooks', require('./routes/webhooks'));

  // Auth routes (login/refresh/logout don't need the JWT middleware)
  app.use('/auth', require('./routes/auth'));

  // All routes below require a valid JWT
  app.use(authMiddleware);
  app.use(rlsMiddleware);

  app.use('/device-tokens',    require('./routes/deviceTokens'));
  app.use('/my',               require('./routes/myRoutes'));
  app.use('/branches',         require('./routes/branches'));
  app.use('/users',            require('./routes/users'));
  app.use('/students',         require('./routes/students'));
  app.use('/confirmations',    require('./routes/confirmations'));
  app.use('/course-levels',    require('./routes/courseLevels'));
  app.use('/robot-types',      require('./routes/robotTypes'));
  app.use('/courses',          require('./routes/courses'));
  app.use('/packages',         require('./routes/packages'));
  app.use('/promotions',       require('./routes/promotions'));
  app.use('/contract-schools', require('./routes/contractSchools'));
  app.use('/schedules',        require('./routes/schedules'));
  app.use('/reservations',     require('./routes/reservations'));
  app.use('/enrollments',      require('./routes/enrollments'));
  app.use('/attendance',       require('./routes/attendance'));
  app.use('/reinstatements',   require('./routes/reinstatements'));
  app.use('/transactions',     require('./routes/transactions'));
  app.use('/warnings',         require('./routes/warnings'));
  app.use('/dashboard',        require('./routes/dashboard'));
  app.use('/owner',            require('./routes/dashboard'));
  app.use('/holidays',         require('./routes/holidays'));
  app.use('/customer-packages', require('./routes/customerPackages'));
  app.use('/announcements',    require('./routes/announcements'));
  app.use('/requests',         require('./routes/requests'));
  app.use('/admin/sync',       require('./routes/sync'));

  // Global error handler
  app.use((err, req, res, next) => {
    console.error(err.stack || err.message);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
