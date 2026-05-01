const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8002;
const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN;

app.use(express.json());

// ── Request counter for monitoring ──────────────────────────────────────────
let requestCount = 0;

// ── In-memory cache ─────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

// ── Category cache (long TTL) ───────────────────────────────────────────────
let cachedCategories = null;
let categoriesCachedAt = 0;

async function getCategories() {
  if (cachedCategories && Date.now() - categoriesCachedAt < 30 * 60 * 1000) {
    return cachedCategories;
  }
  const data = await centralGet('/api/data/categories');
  cachedCategories = data.categories;
  categoriesCachedAt = Date.now();
  return cachedCategories;
}

// ── P1: Health check ────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ service: 'rental-service', status: 'OK' });
});

// ── P3 + P5: Product listing with category validation ───────────────────────
app.get('/rentals/products', async (req, res) => {
  try {
    const { category, page, limit, owner_id } = req.query;

    if (category) {
      const validCategories = await getCategories();
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: `Invalid category '${category}'`, validCategories });
      }
    }

    const params = {};
    if (category) params.category = category;
    if (page) params.page = page;
    if (limit) params.limit = limit;
    if (owner_id) params.owner_id = owner_id;

    const data = await centralGet('/api/data/products', params);
    res.json(data);
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P3: Product by ID ───────────────────────────────────────────────────────
app.get('/rentals/products/:id/availability', async (req, res) => {
  await handleAvailability(req, res);
});

app.get('/rentals/products/:id/free-streak', async (req, res) => {
  await handleFreeStreak(req, res);
});

app.get('/rentals/products/:id', async (req, res) => {
  try {
    const data = await centralGet(`/api/data/products/${req.params.id}`);
    res.json(data);
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P7: Is It Available? (Interval merging) ─────────────────────────────────
async function handleAvailability(req, res) {
  try {
    const productId = parseInt(req.params.id);
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Fetch rentals for this product (CAPPED at 5 pages to conserve API calls)
    const allRentals = await fetchRentalsCapped({ product_id: productId }, 5);

    const intervals = allRentals.map(r => ({
      start: new Date(r.rentalStart),
      end: new Date(r.rentalEnd),
    }));

    const merged = mergeIntervals(intervals);

    const busyPeriods = [];
    for (const iv of merged) {
      if (iv.start <= toDate && iv.end >= fromDate) {
        busyPeriods.push({
          start: iv.start.toISOString().split('T')[0],
          end: iv.end.toISOString().split('T')[0],
        });
      }
    }

    const freeWindows = [];
    let cursor = new Date(fromDate);
    for (const bp of busyPeriods) {
      const bpStart = new Date(bp.start);
      const bpEnd = new Date(bp.end);
      if (cursor < bpStart) {
        const freeEnd = new Date(bpStart);
        freeEnd.setDate(freeEnd.getDate() - 1);
        if (cursor <= freeEnd) {
          freeWindows.push({
            start: cursor.toISOString().split('T')[0],
            end: freeEnd.toISOString().split('T')[0],
          });
        }
      }
      cursor = new Date(bpEnd);
      cursor.setDate(cursor.getDate() + 1);
    }
    if (cursor <= toDate) {
      freeWindows.push({
        start: cursor.toISOString().split('T')[0],
        end: toDate.toISOString().split('T')[0],
      });
    }

    const available = busyPeriods.length === 0 ||
      busyPeriods.every(bp => new Date(bp.end) < fromDate || new Date(bp.start) > toDate);

    res.json({ productId, from, to, available, busyPeriods, freeWindows });
  } catch (err) {
    handleCentralError(err, res);
  }
}

// ── P8: Kth Busiest Date (Min-heap for optimal O(n log k)) ─────────────────
app.get('/rentals/kth-busiest-date', async (req, res) => {
  try {
    const { from, to, k: kStr } = req.query;
    const k = parseInt(kStr);

    if (!from || !to || !kStr) return res.status(400).json({ error: 'from, to, and k are required' });
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM format' });
    }
    if (!Number.isInteger(k) || k < 1) return res.status(400).json({ error: 'k must be a positive integer' });

    const fromParts = from.split('-').map(Number);
    const toParts = to.split('-').map(Number);
    const fromMonth = new Date(fromParts[0], fromParts[1] - 1);
    const toMonth = new Date(toParts[0], toParts[1] - 1);
    if (fromMonth > toMonth) return res.status(400).json({ error: 'from must not be after to' });

    const monthDiff = (toParts[0] - fromParts[0]) * 12 + (toParts[1] - fromParts[1]);
    if (monthDiff > 11) return res.status(400).json({ error: 'Max range is 12 months' });

    const allDayStats = [];
    const cur = new Date(fromMonth);
    while (cur <= toMonth) {
      const monthStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      const data = await centralGet('/api/data/rentals/stats', { group_by: 'date', month: monthStr });
      if (data.data) allDayStats.push(...data.data);
      cur.setMonth(cur.getMonth() + 1);
    }

    if (k > allDayStats.length) {
      return res.status(404).json({ error: `k=${k} exceeds available dates (${allDayStats.length})` });
    }

    // Min-heap of size k for top-k selection (O(n log k))
    const heap = new MinHeap();
    for (const day of allDayStats) {
      if (heap.size() < k) {
        heap.push({ date: day.date, count: day.count });
      } else if (day.count > heap.peek().count) {
        heap.pop();
        heap.push({ date: day.date, count: day.count });
      }
    }

    const result = heap.peek();
    res.json({ from, to, k, date: result.date, rentalCount: result.count });
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P9: Top Categories for a Renter (Min-heap) ─────────────────────────────
app.get('/rentals/users/:id/top-categories', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const k = parseInt(req.query.k);
    if (!Number.isInteger(k) || k < 1) return res.status(400).json({ error: 'k must be a positive integer' });

    // Fetch rentals (capped to conserve API calls)
    const allRentals = await fetchRentalsCapped({ renter_id: userId }, 5);

    if (allRentals.length === 0) {
      return res.json({ userId, topCategories: [] });
    }

    const productIds = [...new Set(allRentals.map(r => r.productId))];

    // Batch fetch products (max 50 per call)
    const products = {};
    for (let i = 0; i < productIds.length; i += 50) {
      const batch = productIds.slice(i, i + 50);
      const data = await centralGet('/api/data/products/batch', { ids: batch.join(',') });
      for (const p of data.data) products[p.id] = p;
    }

    const categoryCounts = {};
    for (const rental of allRentals) {
      const product = products[rental.productId];
      if (product) {
        categoryCounts[product.category] = (categoryCounts[product.category] || 0) + 1;
      }
    }

    // Top-k using min-heap
    const entries = Object.entries(categoryCounts);
    const heap = new MinHeap();
    for (const [category, count] of entries) {
      if (heap.size() < k) {
        heap.push({ category, rentalCount: count });
      } else if (count > heap.peek().rentalCount) {
        heap.pop();
        heap.push({ category, rentalCount: count });
      }
    }

    const topCategories = [];
    while (heap.size() > 0) topCategories.push(heap.pop());
    topCategories.sort((a, b) => b.rentalCount - a.rentalCount);

    res.json({ userId, topCategories });
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── P10: Longest Free Streak ────────────────────────────────────────────────
async function handleFreeStreak(req, res) {
  try {
    const productId = parseInt(req.params.id);
    const year = parseInt(req.query.year);
    if (!year || isNaN(year)) return res.status(400).json({ error: 'year query param required' });

    const yearStart = new Date(`${year}-01-01`);
    const yearEnd = new Date(`${year}-12-31`);

    const allRentals = await fetchRentalsCapped({ product_id: productId }, 5);

    const intervals = [];
    for (const r of allRentals) {
      let start = new Date(r.rentalStart);
      let end = new Date(r.rentalEnd);
      if (end < yearStart || start > yearEnd) continue;
      if (start < yearStart) start = new Date(yearStart);
      if (end > yearEnd) end = new Date(yearEnd);
      intervals.push({ start, end });
    }

    const merged = mergeIntervals(intervals);

    let longestFreeStreak = null;
    let cursor = new Date(yearStart);

    for (const iv of merged) {
      if (cursor < iv.start) {
        const gapEnd = new Date(iv.start);
        gapEnd.setDate(gapEnd.getDate() - 1);
        const days = Math.round((gapEnd - cursor) / 86400000) + 1;
        if (!longestFreeStreak || days > longestFreeStreak.days) {
          longestFreeStreak = { from: cursor.toISOString().split('T')[0], to: gapEnd.toISOString().split('T')[0], days };
        }
      }
      cursor = new Date(iv.end);
      cursor.setDate(cursor.getDate() + 1);
    }

    if (cursor <= yearEnd) {
      const days = Math.round((yearEnd - cursor) / 86400000) + 1;
      if (!longestFreeStreak || days > longestFreeStreak.days) {
        longestFreeStreak = { from: cursor.toISOString().split('T')[0], to: yearEnd.toISOString().split('T')[0], days };
      }
    }

    if (!longestFreeStreak) {
      longestFreeStreak = { from: `${year}-01-01`, to: `${year}-12-31`, days: 365 + (isLeapYear(year) ? 1 : 0) };
    }

    res.json({ productId, year, longestFreeStreak });
  } catch (err) {
    handleCentralError(err, res);
  }
}

// ── P12: Unified Merged Feed (K-way merge) ──────────────────────────────────
app.get('/rentals/merged-feed', async (req, res) => {
  try {
    const { productIds: pidsStr, limit: limitStr } = req.query;
    if (!pidsStr) return res.status(400).json({ error: 'productIds is required' });

    const rawIds = pidsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const productIds = [...new Set(rawIds)];
    if (productIds.length < 1 || productIds.length > 10) {
      return res.status(400).json({ error: 'productIds must be 1-10 comma-separated integers' });
    }

    const limit = parseInt(limitStr) || 30;
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be 1-100' });
    }

    // Fetch first page of rentals for each product (1 API call each)
    const streams = await Promise.all(
      productIds.map(async (pid) => {
        try {
          const data = await centralGet('/api/data/rentals', { product_id: pid, page: 1, limit: 100 });
          return (data.data || []).map(r => ({ ...r, rentalId: r.id }));
        } catch { return []; }
      })
    );

    // K-way merge using a min-heap
    const heap = new MinHeap((a, b) => new Date(a.rentalStart) - new Date(b.rentalStart));
    for (let i = 0; i < streams.length; i++) {
      if (streams[i].length > 0) {
        heap.push({ ...streams[i][0], _streamIdx: i, _pos: 0 });
      }
    }

    const feed = [];
    while (heap.size() > 0 && feed.length < limit) {
      const item = heap.pop();
      const { _streamIdx, _pos, ...rental } = item;
      feed.push({
        rentalId: rental.rentalId || rental.id,
        productId: rental.productId,
        rentalStart: rental.rentalStart?.split('T')[0] || rental.rentalStart,
        rentalEnd: rental.rentalEnd?.split('T')[0] || rental.rentalEnd,
      });
      const nextPos = _pos + 1;
      if (nextPos < streams[_streamIdx].length) {
        heap.push({ ...streams[_streamIdx][nextPos], _streamIdx, _pos: nextPos });
      }
    }

    res.json({ productIds, limit, feed });
  } catch (err) {
    handleCentralError(err, res);
  }
});

// ── Utility: Fetch rentals with page cap ────────────────────────────────────
async function fetchRentalsCapped(params, maxPages = 5) {
  const allRentals = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await centralGet('/api/data/rentals', { ...params, page, limit: 100 });
    if (!data.data || data.data.length === 0) break;
    allRentals.push(...data.data);
    if (data.data.length < 100) break;
    page++;
  }
  return allRentals;
}

// ── Utility: Merge overlapping intervals ────────────────────────────────────
function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = intervals.slice().sort((a, b) => a.start - b.start);
  const merged = [{ start: new Date(sorted[0].start), end: new Date(sorted[0].end) }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), sorted[i].end.getTime()));
    } else {
      merged.push({ start: new Date(sorted[i].start), end: new Date(sorted[i].end) });
    }
  }
  return merged;
}

// ── Utility: Min-Heap ───────────────────────────────────────────────────────
class MinHeap {
  constructor(compareFn) {
    this.data = [];
    this.cmp = compareFn || ((a, b) => (a.count || a.rentalCount || 0) - (b.count || b.rentalCount || 0));
  }
  size() { return this.data.length; }
  peek() { return this.data[0]; }
  push(val) {
    this.data.push(val);
    this._bubbleUp(this.data.length - 1);
  }
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) { this.data[0] = last; this._sinkDown(0); }
    return top;
  }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(this.data[i], this.data[p]) < 0) {
        [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
        i = p;
      } else break;
    }
  }
  _sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i, l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.cmp(this.data[l], this.data[smallest]) < 0) smallest = l;
      if (r < n && this.cmp(this.data[r], this.data[smallest]) < 0) smallest = r;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else break;
    }
  }
}

function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

function handleCentralError(err, res) {
  if (err.response) {
    if (err.response.status === 404) return res.status(404).json({ error: 'Not found' });
    if (err.response.status === 429) {
      return res.status(503).json({
        error: 'Central API unavailable after 3 retries',
        lastRetryAfter: 72,
        suggestion: 'Try again in ~2 minutes',
      });
    }
    return res.status(err.response.status).json({ error: err.response.data?.error || 'Central API error' });
  }
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Rental Service running on port ${PORT}`);
});
