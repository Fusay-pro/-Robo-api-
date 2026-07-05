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
  // Allowed browser origins: localhost (dev), the configured app URLs, and this
  // account's Vercel deployments — production aliases (robo-staff/robo-parent)
  // plus the auto-generated preview/branch URLs (which change every deploy).
  const staticOrigins = [
    process.env.PARENT_APP_URL, process.env.STAFF_APP_URL,
    'https://robo-staff.vercel.app', 'https://robo-parent.vercel.app',
  ].filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                        // curl / mobile / server-to-server
      if (staticOrigins.includes(origin)) return cb(null, true);
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      // Vercel deployment/preview URLs owned by this account
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) &&
          (origin.includes('fusay-pros-projects') || /robo-(staff|parent)/.test(origin) || origin.includes('pocket-scanner'))) {
        return cb(null, true);
      }
      return cb(null, false);                                    // block: no CORS headers (not a 500)
    },
    credentials: true,
  }));

  // Rate limiting. Staff dashboards fire many API calls and a whole school can
  // share one IP (school WiFi / ngrok), so the global limit must be generous.
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));
  // /auth covers login AND refresh (every session refreshes ~4x/hour) — keyed per IP
  app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));
  // Login brute-force protection, separate from refresh traffic
  app.use('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }));
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

  // Global error handler — log details server-side, but never leak internals
  // (SQL errors, stack fragments) to clients on unexpected 500s.
  app.use((err, req, res, next) => {
    console.error(err.stack || err.message);
    const status = err.status || 500;
    const message = status < 500 ? (err.message || 'Request failed') : 'Internal server error';
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
