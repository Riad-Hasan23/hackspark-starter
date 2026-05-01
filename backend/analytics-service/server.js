const express = require('express');
const axios = require('axios');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8003;
const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN;

app.use(express.json());

// ── Request counter for monitoring ──────────────────────────────────────────
let requestCount = 0;

// ── In-memory cache ─────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes (longer for analytics)

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ── Central API client with retry (B2) + caching + logging ──────────────────
async function centralGet(path, params = {}, maxRetries = 3) {
  const cacheKey = `${path}?${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      requestCount++;
      console.log(`[API #${requestCount}] GET ${path} ${JSON.stringify(params)}`);
      const res = await axios.get(`${CENTRAL_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${CENTRAL_API_TOKEN}` },
        params,
        timeout: 30000,
      });
      setCache(cacheKey, res.data);
      return res.data;
    } catch (err) {
      if (err.response && err.response.status === 429 && attempt < maxRetries) {
        const retryAfter = err.response.data?.retryAfterSeconds || 10;
        const backoff = retryAfter * Math.pow(2, attempt);
        const jitter = backoff * (0.8 + Math.random() * 0.4);
        console.log(`[retry ${attempt + 1}/${maxRetries}] waiting ${Math.round(jitter)}s before retrying GET ${path}`);
        await new Promise(r => setTimeout(r, jitter * 1000));
        continue;
      }
      throw err;
    }
  }
}

function handleCentralError(err, res) {
  if (err.response) {
    if (err.response.status === 429) {
      return res.status(503).json({
        error: 'Central API unavailable after 3 retries',
        lastRetryAfter: 120,
        suggestion: 'Try again in ~2 minutes',
      });
    }
    return res.status(err.response.status).json({ error: err.response.data?.error || 'Central API error' });
  }
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
}

// ── P1: Health check ────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ service: 'analytics-service', status: 'OK' });
});

// ── P11: Peak 7-Day Window (Sliding Window — O(n)) ─────────────────────────
app.get('/analytics/peak-window', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM format' });
    }

    const fromParts = from.split('-').map(Number);
    const toParts = to.split('-').map(Number);
    const fromDate = new Date(fromParts[0], fromParts[1] - 1, 1);
    const toDate = new Date(toParts[0], toParts[1], 0);

    if (fromDate > toDate) return res.status(400).json({ error: 'from must not be after to' });

    const monthDiff = (toParts[0] - fromParts[0]) * 12 + (toParts[1] - fromParts[1]);
    if (monthDiff > 11) return res.status(400).json({ error: 'Max range is 12 months' });

    const totalDays = Math.round((toDate - fromDate) / 86400000) + 1;
    if (totalDays < 7) return res.status(400).json({ error: 'Not enough data for a 7-day window' });

    const dayMap = {};
    const cur = new Date(fromDate);
    const endMonth = new Date(toParts[0], toParts[1] - 1);
    while (cur <= endMonth) {
      const monthStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      const data = await centralGet('/api/data/rentals/stats', { group_by: 'date', month: monthStr });
      if (data.data) {
        for (const d of data.data) dayMap[d.date] = d.count;
      }
      cur.setMonth(cur.getMonth() + 1);
    }

    const days = [];
    const d = new Date(fromDate);
    while (d <= toDate) {
      const dateStr = d.toISOString().split('T')[0];
      days.push({ date: dateStr, count: dayMap[dateStr] || 0 });
      d.setDate(d.getDate() + 1);
    }

    let windowSum = 0;
    for (let i = 0; i < 7; i++) windowSum += days[i].count;

    let bestSum = windowSum;
    let bestStart = 0;

    for (let i = 7; i < days.length; i++) {
      windowSum += days[i].count - days[i - 7].count;
      if (windowSum > bestSum) {
        bestSum = windowSum;
        bestStart = i - 6;
      }
    }

    res.json({
      from, to,
      peakWindow: {
        from: days[bestStart].date,
        to: days[bestStart + 6].date,
        totalRentals: bestSum,
      },
    });
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P13: Surge Days (Monotonic Stack — O(n)) ────────────────────────────────
app.get('/analytics/surge-days', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month is required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM format' });

    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();

    const statsData = await centralGet('/api/data/rentals/stats', { group_by: 'date', month });
    const countMap = {};
    if (statsData.data) {
      for (const d of statsData.data) countMap[d.date] = d.count;
    }

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ date: dateStr, count: countMap[dateStr] || 0 });
    }

    const result = new Array(days.length).fill(null);
    const stack = [];

    for (let i = days.length - 1; i >= 0; i--) {
      while (stack.length > 0 && days[stack[stack.length - 1]].count <= days[i].count) {
        stack.pop();
      }
      if (stack.length > 0) {
        const surgeIdx = stack[stack.length - 1];
        result[i] = {
          date: days[i].date,
          count: days[i].count,
          nextSurgeDate: days[surgeIdx].date,
          daysUntil: surgeIdx - i,
        };
      } else {
        result[i] = {
          date: days[i].date,
          count: days[i].count,
          nextSurgeDate: null,
          daysUntil: null,
        };
      }
      stack.push(i);
    }

    res.json({ month, data: result });
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P14: Seasonal Recommendations ──────────────────────────────────────────
app.get('/analytics/recommendations', async (req, res) => {
  try {
    const { date, limit: limitStr } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD format' });

    const limit = parseInt(limitStr) || 10;
    if (limit < 1 || limit > 50) return res.status(400).json({ error: 'limit must be 1-50' });

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) return res.status(400).json({ error: 'Invalid date' });

    const productScores = {};
    const targetYear = targetDate.getFullYear();

    for (let yearOffset = 1; yearOffset <= 2; yearOffset++) {
      const refYear = targetYear - yearOffset;
      const refDate = new Date(refYear, targetDate.getMonth(), targetDate.getDate());

      const windowStart = new Date(refDate);
      windowStart.setDate(windowStart.getDate() - 7);
      const windowEnd = new Date(refDate);
      windowEnd.setDate(windowEnd.getDate() + 7);

      const fromStr = windowStart.toISOString().split('T')[0];
      const toStr = windowEnd.toISOString().split('T')[0];

      // CAP: Only fetch first 2 pages per window to conserve tokens
      for (let page = 1; page <= 2; page++) {
        const data = await centralGet('/api/data/rentals', { from: fromStr, to: toStr, page, limit: 100 });
        if (!data.data || data.data.length === 0) break;
        for (const r of data.data) {
          productScores[r.productId] = (productScores[r.productId] || 0) + 1;
        }
        if (data.data.length < 100) break;
      }
    }

    if (Object.keys(productScores).length === 0) {
      return res.json({ date, recommendations: [] });
    }

    const sorted = Object.entries(productScores)
      .map(([id, score]) => ({ productId: parseInt(id), score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const productIds = sorted.map(p => p.productId);
    const products = {};
    for (let i = 0; i < productIds.length; i += 50) {
      const batch = productIds.slice(i, i + 50);
      try {
        const data = await centralGet('/api/data/products/batch', { ids: batch.join(',') });
        for (const p of data.data) products[p.id] = p;
      } catch { /* skip on error */ }
    }

    const recommendations = sorted.map(s => ({
      productId: s.productId,
      name: products[s.productId]?.name || `Product #${s.productId}`,
      category: products[s.productId]?.category || 'UNKNOWN',
      score: s.score,
    }));

    res.json({ date, recommendations });
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P15 Grounding: Category Stats ──────────────────────────────────────────
app.get('/analytics/category-stats', async (req, res) => {
  try {
    const data = await centralGet('/api/data/rentals/stats', { group_by: 'category' });
    res.json(data);
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── gRPC Server (B1) ────────────────────────────────────────────────────────
const PROTO_PATH = path.join(__dirname, '..', 'protos', 'analytics.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const analyticsProto = grpc.loadPackageDefinition(packageDefinition).analytics;

async function getRecommendationsInternal(date, limit) {
  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) throw new Error('Invalid date');

  const productScores = {};
  const targetYear = targetDate.getFullYear();

  for (let yearOffset = 1; yearOffset <= 2; yearOffset++) {
    const refYear = targetYear - yearOffset;
    const refDate = new Date(refYear, targetDate.getMonth(), targetDate.getDate());

    const windowStart = new Date(refDate);
    windowStart.setDate(windowStart.getDate() - 7);
    const windowEnd = new Date(refDate);
    windowEnd.setDate(windowEnd.getDate() + 7);

    const fromStr = windowStart.toISOString().split('T')[0];
    const toStr = windowEnd.toISOString().split('T')[0];

    for (let page = 1; page <= 2; page++) {
      const data = await centralGet('/api/data/rentals', { from: fromStr, to: toStr, page, limit: 100 });
      if (!data.data || data.data.length === 0) break;
      for (const r of data.data) {
        productScores[r.productId] = (productScores[r.productId] || 0) + 1;
      }
      if (data.data.length < 100) break;
    }
  }

  const sorted = Object.entries(productScores)
    .map(([id, score]) => ({ productId: parseInt(id), score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const productIds = sorted.map(p => p.productId);
  const products = {};
  for (let i = 0; i < productIds.length; i += 50) {
    const batch = productIds.slice(i, i + 50);
    try {
      const data = await centralGet('/api/data/products/batch', { ids: batch.join(',') });
      for (const p of data.data) products[p.id] = p;
    } catch {}
  }

  return sorted.map(s => ({
    productId: s.productId,
    name: products[s.productId]?.name || `Product #${s.productId}`,
    category: products[s.productId]?.category || 'UNKNOWN',
    score: s.score,
  }));
}

const grpcServer = new grpc.Server();
grpcServer.addService(analyticsProto.AnalyticsService.service, {
  GetRecommendations: async (call, callback) => {
    try {
      const { date, limit } = call.request;
      const recommendations = await getRecommendationsInternal(date, limit);
      callback(null, { date, recommendations });
    } catch (err) {
      callback({ code: grpc.status.INTERNAL, message: err.message });
    }
  },
});

const GRPC_PORT = process.env.GRPC_PORT || 50051;
grpcServer.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) return console.error('gRPC Bind Error:', err);
  console.log(`Analytics gRPC Server running on port ${port}`);
  grpcServer.start();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Analytics Service running on port ${PORT}`);
});
