require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: function(origin, callback) { return callback(null, true); },
  credentials: true
}));

// Webhook route must come BEFORE express.json() (needs raw body)
app.use('/api/webhook', require('./routes/webhook'));

// JSON middleware for all other routes
app.use(express.json({ limit: '2mb' }));

// API Routes
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/chat',  require('./routes/chat'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'Shayntech Excel AI Pro' });
});

// Admin dashboard page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../addin', 'admin.html'));
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
  console.log(`   Admin:    ${process.env.ADMIN_SECRET ? '✓ secured' : '✗ ADMIN_SECRET not set'}`);
});
