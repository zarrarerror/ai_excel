const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const supabase = require('../lib/supabase');

const FREE_LIMIT = parseInt(process.env.FREE_USES_LIMIT || '50');

// ── Model routing config ──────────────────────────────────────────
// qwen-turbo   → simple/fast tasks (formatting, basic formulas, sorting)
// qwen-max     → complex tasks (VBA, pivot, analysis, dashboard, PDF extraction)
// qwen-vl-max  → image files only (screenshots, photos → extract to Excel)
const MODELS = {
  simple:  process.env.QWEN_MODEL_SIMPLE  || 'qwen-turbo',
  complex: process.env.QWEN_MODEL_COMPLEX || 'qwen-max',
  vision:  process.env.QWEN_MODEL_VISION  || 'qwen-vl-max'
};

const QWEN_BASE = process.env.QWEN_API_URL ||
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

const COMPLEX_KEYWORDS = [
  'vba','macro','pivot','vlookup','hlookup','index match',
  'dashboard','analysis','forecast','regression','statistical',
  'conditional format','nested','complex formula','automate',
  'power query','advanced filter','solver','scenario',
  'multiple sheets','across sheets','all sheets',
  'extract','pdf','resume','invoice','report'
];

function routeModel(messages, hasAttachment, attachmentType) {
  // Image files → vision model (needs to "see" the image)
  if (hasAttachment && attachmentType === 'image') {
    return MODELS.vision;
  }

  // PDF and other files → qwen-max (PDF.js already extracts text,
  // qwen-vl-max doesn't support tool calling so can't write to Excel)
  if (hasAttachment && attachmentType === 'pdf') {
    return MODELS.complex;
  }

  // Check last user message for complexity keywords
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (lastUser) {
    const text = (typeof lastUser.content === 'string'
      ? lastUser.content : JSON.stringify(lastUser.content)).toLowerCase();
    if (COMPLEX_KEYWORDS.some(k => text.includes(k))) return MODELS.complex;
  }

  return MODELS.simple;
}

// ── Auth middleware ───────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  req.user = user;
  next();
}

// ── Usage middleware ──────────────────────────────────────────────
async function checkUsage(req, res, next) {
  const { data: profile } = await supabase
    .from('profiles').select('lifetime_usage, is_pro').eq('id', req.user.id).single();
  const isPro = profile?.is_pro || false;
  const used  = profile?.lifetime_usage || 0;
  if (!isPro && used >= FREE_LIMIT) {
    return res.status(402).json({
      error: 'free_limit_reached',
      message: `You have used all ${FREE_LIMIT} free requests. Upgrade to Pro to continue.`,
      checkout_url: process.env.LEMONSQUEEZY_CHECKOUT_URL,
      used, limit: FREE_LIMIT
    });
  }
  req.profile = { isPro, used };
  next();
}

// ── Call Qwen with fallback ───────────────────────────────────────
async function callQwen(model, messages, tools, toolChoice) {
  const body = { model, messages, temperature: 0.1, max_tokens: 4096 };
  if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = toolChoice || 'auto'; }

  const res = await fetch(QWEN_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  // 400 on tool calling → retry without tools (some models don't support it)
  if (!res.ok && res.status === 400 && tools && tools.length > 0) {
    console.warn(`[${model}] tool call rejected (400), retrying without tools`);
    const body2 = { model, messages, temperature: 0.1, max_tokens: 4096 };
    const retry = await fetch(QWEN_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body2)
    });
    return { res: retry, data: await retry.json(), usedModel: model, toolsDropped: true };
  }

  // Vision model failed → fallback to qwen-max with tools
  if (!res.ok && model === MODELS.vision) {
    console.warn(`[${model}] failed, falling back to qwen-max`);
    const fallbackBody = { model: MODELS.complex, messages, temperature: 0.1, max_tokens: 4096 };
    if (tools && tools.length > 0) { fallbackBody.tools = tools; fallbackBody.tool_choice = 'auto'; }
    const retry = await fetch(QWEN_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fallbackBody)
    });
    return { res: retry, data: await retry.json(), usedModel: MODELS.complex, toolsDropped: false };
  }

  return { res, data, usedModel: model, toolsDropped: false };
}

// ── POST /api/chat ────────────────────────────────────────────────
router.post('/', requireAuth, checkUsage, async (req, res) => {
  const { messages, tools, tool_choice, has_attachment, attachment_type } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'messages array is required.' });

  const model = routeModel(messages, has_attachment, attachment_type);
  console.log(`[routing] model=${model}  attachment=${attachment_type || 'none'}`);

  try {
    const { res: qwenRes, data: qwenData, usedModel, toolsDropped } =
      await callQwen(model, messages, tools, tool_choice);

    if (!qwenRes.ok) {
      console.error(`[${usedModel}] error:`, qwenData);
      return res.status(qwenRes.status).json({
        error: qwenData.message || qwenData.error?.message || 'AI request failed.'
      });
    }

    normalizeToolCalls(qwenData);
    await incrementUsage(req.user.id, req.profile.used);
    res.json({ ...qwenData, _meta: { model: usedModel, tools_dropped: toolsDropped } });

  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

async function incrementUsage(userId, currentUsage) {
  await supabase.from('profiles')
    .update({ lifetime_usage: currentUsage + 1 }).eq('id', userId);
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
