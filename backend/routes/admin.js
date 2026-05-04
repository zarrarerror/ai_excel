const express = require('express');
const router  = express.Router();
const supabase = require('../lib/supabase');

function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/admin/stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const { data: profiles } = await supabase
      .from('profiles').select('id, email, lifetime_usage, is_pro, created_at');

    const { data: tokenData } = await supabase
      .from('token_logs')
      .select('model, input_tokens, output_tokens, cost_usd');

    const total      = (profiles || []).length;
    const pro        = (profiles || []).filter(p => p.is_pro).length;
    const totalUsage = (profiles || []).reduce((s,p) => s + (p.lifetime_usage||0), 0);
    const heavyUsers = (profiles || []).filter(p => (p.lifetime_usage||0) >= 40).length;

    // Token aggregates
    const logs = tokenData || [];
    const totalInputTok  = logs.reduce((s,l) => s + (l.input_tokens||0),  0);
    const totalOutputTok = logs.reduce((s,l) => s + (l.output_tokens||0), 0);
    const totalCostUsd   = logs.reduce((s,l) => s + parseFloat(l.cost_usd||0), 0);

    // Per-model breakdown
    const modelMap = {};
    logs.forEach(l => {
      if (!modelMap[l.model]) modelMap[l.model] = { calls:0, input:0, output:0, cost:0 };
      modelMap[l.model].calls++;
      modelMap[l.model].input  += l.input_tokens  || 0;
      modelMap[l.model].output += l.output_tokens || 0;
      modelMap[l.model].cost   += parseFloat(l.cost_usd || 0);
    });

    res.json({
      total, pro, free: total - pro,
      totalUsage, avgUsage: total > 0 ? Math.round(totalUsage/total) : 0,
      heavyUsers,
      tokens: {
        totalCalls: logs.length,
        totalInputTok, totalOutputTok,
        totalCostUsd: totalCostUsd.toFixed(4),
        byModel: modelMap
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, lifetime_usage, is_pro, lemon_subscription_id, created_at')
      .order('created_at', { ascending: false });

    // Per-user token cost
    const { data: tokenData } = await supabase
      .from('token_logs').select('user_id, cost_usd');

    const costMap = {};
    (tokenData || []).forEach(l => {
      costMap[l.user_id] = (costMap[l.user_id] || 0) + parseFloat(l.cost_usd || 0);
    });

    const result = (profiles || []).map(p => ({
      ...p, total_cost_usd: (costMap[p.id] || 0).toFixed(4)
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/token-logs?limit=100
router.get('/token-logs', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const { data } = await supabase
      .from('token_logs')
      .select('id, user_id, model, input_tokens, output_tokens, cost_usd, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
