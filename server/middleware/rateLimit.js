import { rateLimit } from 'express-rate-limit';

// No login means anyone with the URL can call the API. These limits stop one
// visitor (or a bot) from burning through your Gemini quota. Counted per IP.
const limiter = (limit, windowMinutes, what) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8', // tells clients their remaining quota via RateLimit headers
    legacyHeaders: false,
    message: { error: `Too many ${what}. Please wait a minute and try again.` },
  });

export const aiLimiter = limiter(20, 1, 'AI requests');          // ask, compare, analyse, process
export const searchLimiter = limiter(60, 1, 'searches');         // each search = 1 embedding call
export const uploadLimiter = limiter(10, 10, 'uploads');         // 10 uploads per 10 minutes
