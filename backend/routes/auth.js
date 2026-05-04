const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');

const FREE_LIMIT = parseInt(process.env.FREE_USES_LIMIT || '50');
const PRO_LIMIT  = parseInt(process.env.PRO_USES_LIMIT  || '1000');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  });

  if (error) {
    if (error.message.includes('already registered'))
      return res.status(409).json({ error: 'An account with this email already exists.' });
    return res.status(400).json({ error: error.message });
  }

  await supabase.from('profiles').upsert({
    id: data.user.id, email: data.user.email,
    lifetime_usage: 0, monthly_usage: 0,
    monthly_reset_at: new Date().toISOString(), is_pro: false
  });

  const { data: session, error: signInError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (signInError)
    return res.status(500).json({ error: 'Account created but login failed. Please sign in.' });

  res.json({ token: session.session.access_token, user: { email: data.user.email, id: data.user.id } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({ token: data.session.access_token, user: { email: data.user.email, id: data.user.id } });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();

  const isPro        = profile?.is_pro       || false;
  const lifetimeUsed = profile?.lifetime_usage || 0;
  const resetAt      = profile?.monthly_reset_at ? new Date(profile.monthly_reset_at) : new Date();
  const now          = new Date();

  // Check if monthly needs reset
  const needsReset = now.getFullYear() > resetAt.getFullYear() ||
                     now.getMonth()    > resetAt.getMonth();
  let monthlyUsed = needsReset ? 0 : (profile?.monthly_usage || 0);

  // Next reset date = 1st of next month
  const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  if (isPro) {
    res.json({
      email: user.email, id: user.id, is_pro: true,
      monthly_usage: monthlyUsed,
      monthly_limit: PRO_LIMIT,
      remaining: Math.max(0, PRO_LIMIT - monthlyUsed),
      resets_at: nextReset.toISOString(),
      checkout_url: process.env.LEMONSQUEEZY_CHECKOUT_URL
    });
  } else {
    res.json({
      email: user.email, id: user.id, is_pro: false,
      lifetime_usage: lifetimeUsed,
      free_limit: FREE_LIMIT,
      remaining: Math.max(0, FREE_LIMIT - lifetimeUsed),
      checkout_url: process.env.LEMONSQUEEZY_CHECKOUT_URL
    });
  }
});

module.exports = router;
