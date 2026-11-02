const API_KEY = process.env.API_KEY || 'clinic-api-key-2026';

function authMiddleware(req, res, next) {
  const providedKey = req.headers['x-api-key'];

  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({
      error: 'unauthorized',
    });
  }

  next();
}

module.exports = authMiddleware;
module.exports.API_KEY = API_KEY;
