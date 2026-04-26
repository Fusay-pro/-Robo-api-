const router = require('express').Router();
const express = require('express');
const { verifySignature, handleChargeComplete } = require('../services/omiseWebhook');

router.post('/omise',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['x-omise-signature'];
    if (sig && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    res.status(200).send('OK');
    try {
      const event = JSON.parse(req.body);
      if (event.key === 'charge.complete') {
        await handleChargeComplete(event.data);
      }
    } catch (err) {
      console.error('Webhook processing error:', err.message);
    }
  }
);

module.exports = router;
