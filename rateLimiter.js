const rateLimit = require("express-rate-limit");
const NodeCache = require("node-cache");

//  In-memory cache 
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL) || 300, // 5 min default
  checkperiod: 60,
  useClones: false,
});

/** Express middleware: serve from cache if available */
function cacheMiddleware(keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    const hit = cache.get(key);
    if (hit) {
      return res.json({ ...hit, _cache: true });
    }
    res.setCache = (data) => cache.set(key, data);
    next();
  };
}

//  Rate limiter 
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again after 15 minutes.",
  },
});

// Stricter limiter for the analyze endpoint (it calls GitHub API)
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Analyze rate limit reached. Max 10 analyses per minute.",
  },
});

module.exports = { cache, cacheMiddleware, apiLimiter, analyzeLimiter };
