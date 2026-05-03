const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true  // auto-confirm so no email verification needed
  });

  if (error) {
    if (error.message.includes('already registered'))
      return res.status(409).json({ error: 'An account with this email already exists.' });
    return res.status(400).json({ error: error.message });
  }

  // Create profile row with 0 usage
  await supabase.from('profiles').upsert({
    id: data.user.id,
    email: data.user.email,
    lifetime_usage: 0,
    is_pro: false
  });

  // Sign them in immediately and return a token
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (signInError)
    return res.status(500).json({ error: 'Account created but login failed. Please sign in.' });

  res.json({
    token: session.session.access_token,
    user: { email: data.user.email, id: data.user.id }
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error)
    return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({
    token: data.session.access_token,
    user: { email: data.user.email, id: data.user.id }
  });
});

// GET /api/auth/me — get current user's profile + usage
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated.' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const freeLimit = parseInt(process.env.FREE_USES_LIMIT || '50');
  const used = profile?.lifetime_usage || 0;
  const isPro = profile?.is_pro || false;

  res.json({
    email: user.email,
    id: user.id,
    is_pro: isPro,
    lifetime_usage: used,
    free_limit: freeLimit,
    remaining: isPro ? null : Math.max(0, freeLimit - used),
    checkout_url: process.env.LEMONSQUEEZY_CHECKOUT_URL
  });
});

module.exports = router;
