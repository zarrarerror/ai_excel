const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const supabase = require('../lib/supabase');

const FREE_LIMIT = parseInt(process.env.FREE_USES_LIMIT  || '50');
const PRO_LIMIT  = parseInt(process.env.PRO_USES_LIMIT   || '1000');

// ── Model cost rates (per 1M tokens) ─────────────────────────────
const MODEL_COSTS = {
  'gemini-2.0-flash': { input: 0.075, output: 0.30  },
  'gpt-4o-mini':      { input: 0.150, output: 0.60  },
  'gpt-4o':           { input: 2.500, output: 10.00 },
  'gpt-4.1-mini':     { input: 0.400, output: 1.60  },
  'qwen-turbo':       { input: 0.050, output: 0.20  },
  'qwen-max':         { input: 0.400, output: 1.20  },
};

// ── Model routing ─────────────────────────────────────────────────
const MODELS = {
  simple:  process.env.MODEL_SIMPLE  || 'qwen-turbo',
  complex: process.env.MODEL_COMPLEX || 'qwen-max',
  vision:  process.env.MODEL_VISION  || 'qwen-max',
  heavy:   process.env.MODEL_HEAVY   || 'qwen-max',
};

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  qwen:   process.env.QWEN_API_URL ||
          'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
};

function getEndpointAndKey(model) {
  if (model.startsWith('gpt') || model.startsWith('o1'))
    return { url: ENDPOINTS.openai, key: process.env.OPENAI_API_KEY };
  if (model.startsWith('gemini'))
    return { url: ENDPOINTS.gemini, key: process.env.GEMINI_API_KEY };
  return { url: ENDPOINTS.qwen, key: process.env.QWEN_API_KEY };
}

const COMPLEX_KEYWORDS = [
  'vba','macro','pivot','vlookup','hlookup','index match',
  'dashboard','forecast','regression','statistical',
  'nested','automate','power query','advanced filter',
  'multiple sheets','across sheets','all sheets',
  'extract','pdf','resume','invoice','report'
];

function routeModel(messages, hasAttachment, attachmentType) {
  if (hasAttachment && (attachmentType === 'image' || attachmentType === 'pdf'))
    return MODELS.vision;
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (lastUser) {
    const text = (typeof lastUser.content === 'string'
      ? lastUser.content : JSON.stringify(lastUser.content)).toLowerCase();
    if (COMPLEX_KEYWORDS.some(k => text.includes(k))) return MODELS.complex;
  }
  return MODELS.simple;
}

// ── Auth ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  req.user = user;
  next();
}

// ── Usage check with monthly reset for Pro ────────────────────────
async function checkUsage(req, res, next) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('lifetime_usage, monthly_usage, monthly_reset_at, is_pro')
    .eq('id', req.user.id)
    .single();

  const isPro           = profile?.is_pro || false;
  const lifetimeUsed    = profile?.lifetime_usage || 0;
  const resetAt         = profile?.monthly_reset_at
                          ? new Date(profile.monthly_reset_at)
                          : new Date();
  const now             = new Date();

  // Check if monthly counter needs reset (new calendar month)
  const needsReset = now.getFullYear() > resetAt.getFullYear() ||
                     now.getMonth()    > resetAt.getMonth();

  let monthlyUsed = profile?.monthly_usage || 0;

  if (needsReset) {
    // Reset monthly counter
    await supabase.from('profiles')
      .update({ monthly_usage: 0, monthly_reset_at: now.toISOString() })
      .eq('id', req.user.id);
    monthlyUsed = 0;
  }

  // ── Enforce limits ──
  if (!isPro && lifetimeUsed >= FREE_LIMIT) {
    return res.status(402).json({
      error:        'free_limit_reached',
      message:      `You've used all ${FREE_LIMIT} free requests. Upgrade to Pro for 1,000 requests/month.`,
      checkout_url: process.env.LEMONSQUEEZY_CHECKOUT_URL,
      used:         lifetimeUsed,
      limit:        FREE_LIMIT
    });
  }

  if (isPro && monthlyUsed >= PRO_LIMIT) {
    // Calculate when limit resets (1st of next month)
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return res.status(402).json({
      error:      'pro_limit_reached',
      message:    `You've used all ${PRO_LIMIT} requests this month. Your limit resets on ${resetDate.toLocaleDateString('en-US', {month:'long', day:'numeric'})}.`,
      used:       monthlyUsed,
      limit:      PRO_LIMIT,
      resets_at:  resetDate.toISOString()
    });
  }

  req.profile = { isPro, lifetimeUsed, monthlyUsed };
  next();
}

// ── Call AI ───────────────────────────────────────────────────────
async function callModel(model, messages, tools, toolChoice) {
  const { url, key } = getEndpointAndKey(model);
  if (!key) throw new Error(`API key not configured for model: ${model}`);

  const body = { model, messages, temperature: 0.1, max_tokens: 4096 };
  if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = toolChoice || 'auto'; }

  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok && res.status === 400 && tools && tools.length > 0) {
    console.warn(`[${model}] tool call rejected (400). OpenAI error:`, JSON.stringify(data).slice(0,300));
    console.warn(`[${model}] retrying without tools`);
    const retry = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 4096 })
    });
    return { res: retry, data: await retry.json(), usedModel: model, toolsDropped: true };
  }

  if (!res.ok && model !== MODELS.heavy) {
    console.warn(`[${model}] failed (${res.status}). Error:`, JSON.stringify(data).slice(0,200));
    console.warn(`[${model}] escalating to ${MODELS.heavy}`);
    return callModel(MODELS.heavy, messages, tools, toolChoice);
  }

  return { res, data, usedModel: model, toolsDropped: false };
}

// ── POST /api/chat ────────────────────────────────────────────────
router.post('/', requireAuth, checkUsage, async (req, res) => {
  const { messages, tools, tool_choice, has_attachment, attachment_type } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'messages array is required.' });

  const model = routeModel(messages, has_attachment, attachment_type);
  console.log(`[routing] model=${model}  attachment=${attachment_type||'none'}`);

  try {
    const { res: aiRes, data: aiData, usedModel, toolsDropped } =
      await callModel(model, messages, tools, tool_choice);

    if (!aiRes.ok) {
      console.error(`[${usedModel}] error:`, aiData);
      return res.status(aiRes.status).json({
        error: aiData.error?.message || aiData.message || 'AI request failed.'
      });
    }

    normalizeToolCalls(aiData);

    // ── Token logging + usage increment ──────────────────────────
    const usage    = aiData.usage || {};
    const inputTok = usage.prompt_tokens    || 0;
    const outTok   = usage.completion_tokens || 0;
    const rates    = MODEL_COSTS[usedModel] || { input: 0, output: 0 };
    const costUsd  = (inputTok / 1e6 * rates.input) + (outTok / 1e6 * rates.output);

    Promise.all([
      incrementUsage(req.user.id, req.profile),
      logTokens(req.user.id, usedModel, inputTok, outTok, costUsd)
    ]).catch(err => console.error('Usage update error:', err));

    res.json({
      ...aiData,
      _meta: { model: usedModel, tools_dropped: toolsDropped, cost_usd: costUsd }
    });

  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

async function incrementUsage(userId, profile) {
  const updates = { lifetime_usage: profile.lifetimeUsed + 1 };
  if (profile.isPro) updates.monthly_usage = profile.monthlyUsed + 1;
  await supabase.from('profiles').update(updates).eq('id', userId);
}

async function logTokens(userId, model, inputTok, outTok, costUsd) {
  await supabase.from('token_logs').insert({
    user_id: userId, model,
    input_tokens: inputTok, output_tokens: outTok, cost_usd: costUsd
  });
}

function normalizeToolCalls(data) {
  try {
    const msg = data?.choices?.[0]?.message;
    if (msg?.tool_calls) {
      msg.tool_calls.forEach(tc => {
        if (tc.function && typeof tc.function.arguments === 'object')
          tc.function.arguments = JSON.stringify(tc.function.arguments);
      });
    }
  } catch (e) {}
}

module.exports = router;
