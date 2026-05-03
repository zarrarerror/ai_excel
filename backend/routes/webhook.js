const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');

// LemonSqueezy sends raw body — must use express.raw() for this route
// This is configured in server.js before JSON middleware

function verifySignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// POST /api/webhook/lemonsqueezy
router.post('/lemonsqueezy', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (!signature || !secret) {
    console.error('Webhook: missing signature or secret');
    return res.status(400).send('Bad request');
  }

  let isValid = false;
  try {
    isValid = verifySignature(req.body, signature, secret);
  } catch (e) {
    console.error('Webhook signature error:', e);
  }

  if (!isValid) {
    console.error('Webhook: invalid signature');
    return res.status(401).send('Unauthorized');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).send('Invalid JSON');
  }

  const eventName = payload.meta?.event_name;
  const customerEmail = payload.data?.attributes?.user_email;
  const subscriptionId = payload.data?.id;
  const status = payload.data?.attributes?.status;

  console.log(`Webhook received: ${eventName} for ${customerEmail}`);

  // Activate Pro on successful subscription
  if (
    eventName === 'subscription_created' ||
    eventName === 'subscription_updated' ||
    eventName === 'order_created'
  ) {
    if (customerEmail && status === 'active') {
      // Find user by email in auth
      const { data: users } = await supabase.auth.admin.listUsers();
      const user = users?.users?.find(u => u.email === customerEmail);

      if (user) {
        await supabase.from('profiles').update({
          is_pro: true,
          lemon_subscription_id: subscriptionId,
          lemon_customer_email: customerEmail
        }).eq('id', user.id);
        console.log(`✅ Pro activated for ${customerEmail}`);
      } else {
        // User doesn't have an account yet — store pending activation
        await supabase.from('pending_activations').upsert({
          email: customerEmail,
          subscription_id: subscriptionId,
          created_at: new Date().toISOString()
        });
        console.log(`⏳ Pending activation stored for ${customerEmail}`);
      }
    }
  }

  // Deactivate Pro on cancellation/expiry
  if (
    eventName === 'subscription_cancelled' ||
    eventName === 'subscription_expired' ||
    (eventName === 'subscription_updated' && status === 'cancelled')
  ) {
    if (customerEmail) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const user = users?.users?.find(u => u.email === customerEmail);
      if (user) {
        await supabase.from('profiles').update({
          is_pro: false,
          lemon_subscription_id: null
        }).eq('id', user.id);
        console.log(`❌ Pro deactivated for ${customerEmail}`);
      }
    }
  }

  res.status(200).send('OK');
});

module.exports = router;
