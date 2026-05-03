const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const supabase = require('../lib/supabase');

const FREE_LIMIT = parseInt(process.env.FREE_USES_LIMIT || '50');
const QWEN_URL = process.env.QWEN_API_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-max';

// Middleware: verify JWT and attach user
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated. Please log in.' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session expired. Please log in again.' });

  req.user = user;
  next();
}

// Middleware: check usage / subscription
async function checkUsage(req, res, next) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('lifetime_usage, is_pro')
    .eq('id', req.user.id)
    .single();

  const isPro = profile?.is_pro || false;
  const used = profile?.lifetime_usage || 0;

  if (!isPro && used >= FREE_LIMIT) {
    return res.status(402).json({
      error: 'free_limit_reached',
      message: `You have used all ${FREE_LIMIT} free requests. Upgrade to Pro to continue.`,
      checkout_url: process.env.LEMONSQUEEZY_CHECKOUT_URL,
      used,
      limit: FREE_LIMIT
    });
  }

  req.profile = { isPro, used };
  next();
}

// POST /api/chat
router.post('/', requireAuth, checkUsage, async (req, res) => {
  const { messages, tools, tool_choice } = req.body;

  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'messages array is required.' });

  // Build Qwen request
  const qwenBody = {
    model: QWEN_MODEL,
    messages,
    temperature: 0.1,
    max_tokens: 4096
  };

  // Only include tools if provided (some requests are plain chat)
  if (tools && tools.length > 0) {
    qwenBody.tools = tools;
    qwenBody.tool_choice = tool_choice || 'auto';
  }

  try {
    const qwenRes = await fetch(QWEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(qwenBody)
    });

    const qwenData = await qwenRes.json();

    if (!qwenRes.ok) {
      console.error('Qwen error:', qwenData);
      // If tool calling fails (e.g. 400 from Qwen), retry without tools
      if (qwenRes.status === 400 && tools && tools.length > 0) {
        const retryBody = { ...qwenBody };
        delete retryBody.tools;
        delete retryBody.tool_choice;
        const retryRes = await fetch(QWEN_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(retryBody)
        });
        const retryData = await retryRes.json();
        if (retryRes.ok) {
          await incrementUsage(req.user.id, req.profile.used);
          return res.json(retryData);
        }
      }
      return res.status(qwenRes.status).json({ error: qwenData.message || 'AI request failed.' });
    }

    // Normalize tool_calls arguments (Qwen sometimes returns object instead of string)
    normalizeToolCalls(qwenData);

    // Increment usage counter
    await incrementUsage(req.user.id, req.profile.used);

    res.json(qwenData);

  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

async function incrementUsage(userId, currentUsage) {
  await supabase
    .from('profiles')
    .update({ lifetime_usage: currentUsage + 1 })
    .eq('id', userId);
}

function normalizeToolCalls(data) {
  try {
    const msg = data?.choices?.[0]?.message;
    if (msg?.tool_calls) {
      msg.tool_calls.forEach(tc => {
        if (tc.function && typeof tc.function.arguments === 'object') {
          tc.function.arguments = JSON.stringify(tc.function.arguments);
        }
      });
    }
  } catch (e) { /* ignore */ }
}

module.exports = router;
