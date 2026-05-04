const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// Simple secret-key auth for admin routes
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/admin/stats — overview numbers
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, lifetime_usage, is_pro, created_at');

    if (error) return res.status(500).json({ error: error.message });

    const total      = profiles.length;
    const pro        = profiles.filter(p => p.is_pro).length;
    const free       = total - pro;
    const totalUsage = profiles.reduce((s, p) => s + (p.lifetime_usage || 0), 0);
    const avgUsage   = total > 0 ? Math.round(totalUsage / total) : 0;
    const heavyUsers = profiles.filter(p => (p.lifetime_usage || 0) >= 40).length;

    res.json({ total, pro, free, totalUsage, avgUsage, heavyUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users — full user list
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, lifetime_usage, is_pro, lemon_subscription_id, created_at')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
