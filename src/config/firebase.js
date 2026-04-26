const admin = require('firebase-admin');

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}';
  const key = JSON.parse(raw);
  if (key.type === 'service_account') {
    admin.initializeApp({ credential: admin.credential.cert(key) });
  }
}

module.exports = admin;
