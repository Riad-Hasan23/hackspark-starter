const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());

// NOTE: Do NOT use express.json() globally — it conflicts with http-proxy-middleware
// because it consumes the request body before the proxy can forward it.

const SERVICES = {
  'user-service':      process.env.USER_SERVICE_URL      || 'http://user-service:8001',
  'rental-service':    process.env.RENTAL_SERVICE_URL    || 'http://rental-service:8002',
  'analytics-service': process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:8003',
  'agentic-service':   process.env.AGENTIC_SERVICE_URL   || 'http://agentic-service:8004',
};

// P1: Health check — aggregate all downstream services in parallel
app.get('/status', async (req, res) => {
  const downstream = {};
  const checks = Object.entries(SERVICES).map(async ([name, url]) => {
    try {
      await axios.get(`${url}/status`, { timeout: 5000 });
      downstream[name] = 'OK';
    } catch {
      downstream[name] = 'UNREACHABLE';
    }
  });
  await Promise.all(checks);
  res.json({ service: 'api-gateway', status: 'OK', downstream });
});

const proxyOpts = (target) => ({
  target,
  changeOrigin: true,
  timeout: 120000,       // 2 min — allows time for LLM calls
  proxyTimeout: 120000,
});

// Proxy: /users/* → user-service
app.use('/users', createProxyMiddleware(proxyOpts(SERVICES['user-service'])));

// Proxy: /rentals/* → rental-service
app.use('/rentals', createProxyMiddleware(proxyOpts(SERVICES['rental-service'])));

// Proxy: /analytics/* → analytics-service
app.use('/analytics', createProxyMiddleware(proxyOpts(SERVICES['analytics-service'])));

// Proxy: /chat/* → agentic-service
app.use('/chat', createProxyMiddleware(proxyOpts(SERVICES['agentic-service'])));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway running on port ${PORT}`);
});
