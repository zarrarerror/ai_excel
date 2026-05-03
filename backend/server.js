require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — allow requests from the add-in
const allowedOrigins = [
  process.env.ADDIN_ORIGIN,
  'https://excel-ai-pro.replit.app',
  'https://excelai.replit.app',
  'null', // Office add-ins sometimes send null origin
  'https://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (e.g. Office add-ins, Postman)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Webhook route must come BEFORE express.json() (needs raw body)
const webhookRouter = require('./routes/webhook');
app.use('/api/webhook', webhookRouter);

// JSON middleware for all other routes
app.use(express.json({ limit: '2mb' }));

// Routes
const authRouter = require('./routes/auth');
const chatRouter = require('./routes/chat');

app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'Shayntech Excel AI Pro' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Shayntech Excel AI Pro backend running on port ${PORT}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? '✓ configured' : '✗ MISSING'}`);
  console.log(`   Qwen API: ${process.env.QWEN_API_KEY ? '✓ configured' : '✗ MISSING'}`);
  console.log(`   LemonSqueezy: ${process.env.LEMONSQUEEZY_WEBHOOK_SECRET ? '✓ configured' : '✗ MISSING'}`);
});
