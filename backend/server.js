require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: function(origin, callback) {
    return callback(null, true);
  },
  credentials: true
}));

// Webhook route must come BEFORE express.json() (needs raw body)
const webhookRouter = require('./routes/webhook');
app.use('/api/webhook', webhookRouter);

// JSON middleware for all other routes
app.use(express.json({ limit: '2mb' }));

// API Routes
const authRouter = require('./routes/auth');
const chatRouter = require('./routes/chat');

app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'Shayntech Excel AI Pro' });
});

// Serve the Excel add-in frontend
app.use(express.static(path.join(__dirname, '../addin')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../addin', 'taskpane.html'));
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
