const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db');
const authMiddleware = require('./middleware/auth');
const slotsRouter = require('./routes/slots');
const { handleReset } = require('./routes/slots');
const bookingsRouter = require('./routes/bookings');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. CORS
app.use(cors());

// 2. Body parser
app.use(express.json());

// 3. Database initialization middleware for serverless cold-starts
let initPromise = null;
app.use(async (req, res, next) => {
  try {
    if (!initPromise) {
      initPromise = initDatabase();
    }
    await initPromise;
    next();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    res.status(500).json({ error: 'database initialization failed' });
  }
});

// 4. Serve static web frontend
app.use(express.static(path.join(__dirname, 'public')));

// 5. OpenAPI JSON
app.get('/assessment-api/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.json'));
});

// 6. Reset endpoints (Level 1)
app.post('/reset', authMiddleware, handleReset);
app.post('/api/reset', authMiddleware, handleReset);

// 7. Mount slots and bookings
app.use('/slots', authMiddleware, slotsRouter);
app.use('/api/slots', authMiddleware, slotsRouter);

app.use('/bookings', authMiddleware, bookingsRouter);
app.use('/api/bookings', authMiddleware, bookingsRouter);

// 8. 404 Handler for undefined API routes
app.use((req, res, next) => {
  if (
    req.accepts('json') ||
    req.path.startsWith('/api') ||
    req.path.startsWith('/slots') ||
    req.path.startsWith('/bookings') ||
    req.path.startsWith('/reset')
  ) {
    return res.status(404).json({ error: 'not found' });
  }
  next();
});

// 9. Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'internal server error',
  });
});

// Start local listener only if running directly or locally
if (!process.env.VERCEL) {
  initDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Clinic API running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}

module.exports = app;
