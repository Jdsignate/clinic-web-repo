// Level 5: At most 5 attempts per email per minute, failed attempts included.
// The 6th returns 429 with a Retry-After header in whole seconds.
// Other emails aren't affected.

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 5;

// In-memory store: email -> number[] (timestamps in ms)
const attemptsByEmail = new Map();

function rateLimiter(req, res, next) {
  const rawEmail = req.body && req.body.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : null;

  if (!email) {
    // If no email is specified, let request validation handle missing email error
    return next();
  }

  const now = Date.now();
  if (!attemptsByEmail.has(email)) {
    attemptsByEmail.set(email, []);
  }

  const timestamps = attemptsByEmail.get(email);

  // Expire timestamps older than 60 seconds
  const cutoff = now - WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= MAX_ATTEMPTS) {
    // 6th attempt within window
    const oldestTimestamp = timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + WINDOW_MS - now) / 1000));

    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      error: 'too many attempts',
    });
  }

  // Record this attempt (counts even if validation or booking later fails)
  timestamps.push(now);
  next();
}

function resetRateLimits() {
  attemptsByEmail.clear();
}

module.exports = rateLimiter;
module.exports.resetRateLimits = resetRateLimits;
