const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8004;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/rentpi_agentic';
const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN;
const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:8003';
const RENTAL_URL = process.env.RENTAL_SERVICE_URL || 'http://rental-service:8002';
const ANALYTICS_GRPC_URL = process.env.ANALYTICS_GRPC_URL || 'analytics-service:50051';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── gRPC Client (B1) ────────────────────────────────────────────────────────
const PROTO_PATH = path.join(__dirname, '..', 'protos', 'analytics.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true
});
const analyticsProto = grpc.loadPackageDefinition(packageDefinition).analytics;
const analyticsClient = new analyticsProto.AnalyticsService(
  ANALYTICS_GRPC_URL,
  grpc.credentials.createInsecure()
);

function getRecommendationsGrpc(date, limit) {
  return new Promise((resolve, reject) => {
    analyticsClient.GetRecommendations({ date, limit }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

app.use(express.json());

// ── MongoDB schemas ─────────────────────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  sessionId:     { type: String, unique: true, index: true },
  name:          String,
  createdAt:     { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  sessionId: { type: String, index: true },
  role:      { type: String, enum: ['user', 'assistant'] },
  content:   String,
  timestamp: { type: Date, default: Date.now },
});

const Session = mongoose.model('Session', sessionSchema);
const Message = mongoose.model('Message', messageSchema);

// ── Connect to MongoDB ──────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err.message));

// ── Topic guard keywords (P15) ──────────────────────────────────────────────
const RENTPI_KEYWORDS = [
  'rental', 'rent', 'product', 'category', 'price', 'discount',
  'available', 'availability', 'renter', 'owner', 'rentpi',
  'booking', 'gear', 'surge', 'peak', 'trending', 'recommend',
  'electronics', 'furniture', 'vehicles', 'tools', 'outdoor',
  'sports', 'music', 'cameras', 'office', 'busy', 'free',
  'streak', 'history', 'user', 'security', 'score', 'season', 'gaming'
];

function isOnTopic(message) {
  const lower = message.toLowerCase().trim();
  const greetings = ['hello', 'hi', 'hey', 'help', 'who are you', 'how are you'];
  if (greetings.some(g => lower.startsWith(g))) return true;
  return RENTPI_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Data grounding: detect intent & fetch data ──────────────────────────────
async function groundData(message) {
  const lower = message.toLowerCase();
  let contexts = [];

  try {
    if (lower.includes('category') || lower.includes('most rented')) {
      const data = await axios.get(`${ANALYTICS_URL}/analytics/category-stats`, { timeout: 5000 }).catch(() => null);
      if (data?.data?.data) contexts.push(`Category Stats: ${JSON.stringify(data.data.data)}`);
    } 

    if (lower.includes('available') || lower.includes('availability')) {
      const idMatch = message.match(/\d+/);
      if (idMatch) {
        const res = await axios.get(`${RENTAL_URL}/rentals/products/${idMatch[0]}/availability`, {
          params: { from: '2024-03-01', to: '2024-03-31' },
          timeout: 5000
        }).catch(() => null);
        if (res?.data) contexts.push(`Product ${idMatch[0]} Availability: ${JSON.stringify(res.data)}`);
      }
    } 

    if (lower.includes('trending') || lower.includes('recommend')) {
      const today = new Date().toISOString().split('T')[0];
      const data = await getRecommendationsGrpc(today, 5).catch(() => null);
      if (data?.recommendations) contexts.push(`Trending Products: ${JSON.stringify(data.recommendations)}`);
    }

    if (lower.includes('peak') || lower.includes('busiest')) {
      const data = await axios.get(`${ANALYTICS_URL}/analytics/peak-window`, { params: { from: '2024-01', to: '2024-06' }, timeout: 5000 }).catch(() => null);
      if (data?.data?.peakWindow) contexts.push(`Peak Window: ${JSON.stringify(data.data.peakWindow)}`);
    }

    if (lower.includes('discount') || lower.includes('loyalty')) {
      contexts.push('RentPi Loyalty Program: Score 0-19: 0%, 20-39: 5%, 40-59: 10%, 60-79: 15%, 80-100: 20%. Score depends on rental history.');
    }
  } catch (err) {
    console.error('Grounding error:', err.message);
  }
  
  return contexts.join('\n\n');
}

// ── Multi-Provider LLM Wrapper ───────────────────────────────────────────────
async function askLLM(history, currentMessage, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: currentMessage }
  ];

  // 1. OpenAI or Groq (Free & Fast Alternative)
  if (OPENAI_API_KEY && (OPENAI_API_KEY.startsWith('sk-') || OPENAI_API_KEY.startsWith('gsk_'))) {
    try {
      const isGroq = OPENAI_API_KEY.startsWith('gsk_');
      const url = isGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      const modelToUse = isGroq ? 'llama3-8b-8192' : 'gpt-3.5-turbo';

      const res = await axios.post(url, {
        model: modelToUse,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.7
      }, { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }, timeout: 10000 });
      return res.data.choices[0].message.content;
    } catch (err) { console.error('OpenAI/Groq Error:', err.message); }
  }

  // 2. Gemini (try 1.5-flash then pro)
  if (GEMINI_API_KEY && GEMINI_API_KEY.startsWith('AIza')) {
    const geminiMessages = [
      ...history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      {
        role: 'user',
        parts: [{ text: `[System Instructions]\n${systemPrompt}\n\n[User Query]\n${currentMessage}` }]
      }
    ];

    for (const modelName of ['gemini-1.5-flash', 'gemini-pro']) {
      try {
        console.log(`Trying Gemini ${modelName}...`);
        const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
          contents: geminiMessages,
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        }, { timeout: 10000 });
        if (res.data.candidates?.[0]?.content?.parts?.[0]?.text) {
          return res.data.candidates[0].content.parts[0].text;
        }
      } catch (err) {
        console.error(`Gemini ${modelName} Error:`, err.response?.data || err.message);
      }
    }
  }

  // 3. Last Resort Fallback
  return `[System: Assistant is currently in safe-mode due to API limitations] 
  
Hello! I'm your RentPi assistant. I can see you're asking about: "${currentMessage}". 

I can help you explore our product catalog, check availability for specific items, or analyze rental trends. If you're looking for discounts, remember that your loyalty score earns you up to 20% off!

Is there a specific product ID or category you'd like me to look up?`;
}

async function generateSessionName(firstMessage) {
  try {
    const title = await askLLM([], `Generate a 3-word title for: "${firstMessage}". Reply ONLY title.`, "Title generator.");
    return title.replace(/[".!]/g, '').trim();
  } catch {
    return firstMessage.slice(0, 30);
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────────
app.get('/status', (req, res) => res.json({ service: 'agentic-service', status: 'OK' }));

app.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message are required' });

    if (!isOnTopic(message)) {
      return res.json({ sessionId, reply: "I can only answer questions related to RentPi (rentals, products, categories, pricing). How can I help you with those?" });
    }

    const context = await groundData(message);
    const history = await Message.find({ sessionId }).sort({ timestamp: 1 }).limit(5).lean();

    const systemPrompt = `You are RentPi's helpful AI assistant.
Answer based on this data:
${context || 'No specific data found.'}`;

    const reply = await askLLM(history, message, systemPrompt);

    await Message.create({ sessionId, role: 'user', content: message });
    await Message.create({ sessionId, role: 'assistant', content: reply });

    let session = await Session.findOne({ sessionId });
    if (!session) {
      const name = await generateSessionName(message);
      session = await Session.create({ sessionId, name });
    } else {
      session.lastMessageAt = new Date();
      await session.save();
    }

    res.json({ sessionId, reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/chat/sessions', async (req, res) => {
  const sessions = await Session.find().sort({ lastMessageAt: -1 }).lean();
  res.json({ sessions });
});

app.get('/chat/:sessionId/history', async (req, res) => {
  const { sessionId } = req.params;
  const session = await Session.findOne({ sessionId }).lean();
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const messages = await Message.find({ sessionId }).sort({ timestamp: 1 }).lean();
  res.json({ sessionId, name: session.name, messages });
});

app.delete('/chat/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await Session.deleteOne({ sessionId });
  await Message.deleteMany({ sessionId });
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Agentic Service running on port ${PORT}`));
