const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8004;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/rentpi_agentic';
const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN;
const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:8003';
const RENTAL_URL = process.env.RENTAL_SERVICE_URL || 'http://rental-service:8002';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

// ── Gemini LLM ──────────────────────────────────────────────────────────────
let genAI = null;
let model = null;
try {
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Use 1.5 flash for better compatibility
    console.log('Gemini AI initialized');
  } else {
    console.log('No Gemini API key configured — chatbot will use fallback responses');
  }
} catch (err) {
  console.error('Failed to initialize Gemini:', err.message);
}

// ── Topic guard keywords (P15) ──────────────────────────────────────────────
const RENTPI_KEYWORDS = [
  'rental', 'rent', 'product', 'category', 'price', 'discount',
  'available', 'availability', 'renter', 'owner', 'rentpi',
  'booking', 'gear', 'surge', 'peak', 'trending', 'recommend',
  'electronics', 'furniture', 'vehicles', 'tools', 'outdoor',
  'sports', 'music', 'cameras', 'office', 'busy', 'free',
  'streak', 'history', 'user', 'security', 'score', 'season',
];

function isOnTopic(message) {
  const lower = message.toLowerCase();
  return RENTPI_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Data grounding: detect intent & fetch data ──────────────────────────────
async function groundData(message) {
  const lower = message.toLowerCase();
  let context = '';

  try {
    // 1. Most rented category (P15 Requirement: call Central API or Internal)
    if (lower.includes('category') && (lower.includes('most') || lower.includes('popular') || lower.includes('stats'))) {
      try {
        const data = await axios.get(`${ANALYTICS_URL}/analytics/category-stats`, { timeout: 10000 });
        context = `Category rental stats: ${JSON.stringify(data.data?.data)}`;
      } catch {
        const data = await axios.get(`${CENTRAL_API_URL}/api/data/rentals/stats`, {
          headers: { Authorization: `Bearer ${CENTRAL_API_TOKEN}` },
          params: { group_by: 'category' },
          timeout: 10000
        });
        context = `Category rental stats: ${JSON.stringify(data.data?.data)}`;
      }
    } 
    // 2. Product availability (P15 Requirement: call rental-service)
    else if (lower.includes('available') || lower.includes('availability')) {
      const idMatch = message.match(/\d+/);
      const dateMatch = message.match(/\d{4}-\d{2}-\d{2}/g);
      if (idMatch && dateMatch && dateMatch.length >= 2) {
        try {
          const res = await axios.get(`${RENTAL_URL}/rentals/products/${idMatch[0]}/availability`, {
            params: { from: dateMatch[0], to: dateMatch[1] },
            timeout: 10000
          });
          context = `Availability for product ${idMatch[0]}: ${JSON.stringify(res.data)}`;
        } catch { context = 'Availability data for this product is currently unavailable.'; }
      } else {
        context = 'For availability, please provide a product ID and date range (YYYY-MM-DD). Example: "Is product 42 available from 2024-03-01 to 2024-03-14?"';
      }
    } 
    // 3. Trending / Recommendations (P15 Requirement: call analytics-service)
    else if (lower.includes('trending') || lower.includes('recommend') || lower.includes('season')) {
      const today = new Date().toISOString().split('T')[0];
      try {
        const data = await axios.get(`${ANALYTICS_URL}/analytics/recommendations`, { params: { date: today, limit: 5 }, timeout: 10000 });
        context = `Today's trending products: ${JSON.stringify(data.data?.recommendations)}`;
      } catch { context = 'Trending recommendations are currently unavailable.'; }
    } 
    // 4. Peak rental period (P15 Requirement: call analytics-service)
    else if (lower.includes('peak') || lower.includes('busiest') || lower.includes('rush')) {
      try {
        const data = await axios.get(`${ANALYTICS_URL}/analytics/peak-window`, { params: { from: '2024-01', to: '2024-06' }, timeout: 10000 });
        context = `Peak window data: ${JSON.stringify(data.data?.peakWindow)}`;
      } catch { context = 'Peak window data is currently unavailable.'; }
    } 
    // 5. Rental surge days (P15 Requirement: call analytics-service)
    else if (lower.includes('surge')) {
      const monthMatch = message.match(/\d{4}-\d{2}/);
      const month = monthMatch ? monthMatch[0] : '2024-03';
      try {
        const data = await axios.get(`${ANALYTICS_URL}/analytics/surge-days`, { params: { month }, timeout: 10000 });
        context = `Surge days for ${month}: ${JSON.stringify(data.data?.data?.slice(0, 10))}`;
      } catch { context = `Surge data for ${month} is currently unavailable.`; }
    } 
    // 6. Discounts (P6 logic)
    else if (lower.includes('discount') || lower.includes('security') || lower.includes('score')) {
      context = 'Loyalty Discounts: 80-100 Score → 20%, 60-79 → 15%, 40-59 → 10%, 20-39 → 5%, 0-19 → 0%.';
    }
  } catch (err) {
    context = 'Data is currently unavailable.';
  }
  return context;
}

async function askLLM(messages, systemPrompt) {
  if (!model) {
    return 'I apologize, but the AI service is not configured. Please set up a Gemini API key.';
  }

  try {
    const prompt = systemPrompt + '\n\nConversation:\n' +
      messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
      '\nAssistant:';

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('LLM error:', err.message);
    if (err.message.includes('quota')) {
      return 'I apologize, but my AI quota has been exceeded. Please try again in a minute or contact support.';
    }
    return 'I encountered an issue processing your request. Please try again in a moment.';
  }
}

async function generateSessionName(firstMessage) {
  if (!model) return firstMessage.slice(0, 30);
  try {
    const result = await model.generateContent(
      `Given this first user message, reply with ONLY a short 3-5 word title for this conversation. No punctuation.\n\nMessage: "${firstMessage}"`
    );
    return result.response.text().trim();
  } catch {
    return firstMessage.slice(0, 30);
  }
}

// ── P1: Health check ────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ service: 'agentic-service', status: 'OK' });
});

// ── P15 + P16: Chat endpoint ────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    // P15: Topic guard — refuse off-topic without calling LLM
    if (!isOnTopic(message)) {
      const reply = "I'm RentPi's assistant and I can only help with rental-related topics like products, categories, pricing, availability, discounts, and trends. Could you please ask something related to RentPi?";

      await Message.create({ sessionId, role: 'user', content: message });
      await Message.create({ sessionId, role: 'assistant', content: reply });

      let session = await Session.findOne({ sessionId });
      if (!session) {
        const name = await generateSessionName(message);
        session = await Session.create({ sessionId, name });
      }
      session.lastMessageAt = new Date();
      await session.save();

      return res.json({ sessionId, reply });
    }

    // P15: Data grounding
    const context = await groundData(message);

    // P16: Load conversation history
    const history = await Message.find({ sessionId }).sort({ timestamp: 1 }).lean();
    const conversationMessages = history.map(m => ({ role: m.role, content: m.content }));
    conversationMessages.push({ role: 'user', content: message });

    // Build system prompt with grounded data
    const systemPrompt = `You are RentPi's helpful assistant. RentPi is a rental marketplace for electronics, vehicles, tools, gear, and more. 
Answer questions about rentals, products, categories, pricing, availability, discounts, and trends based ONLY on the data provided.
If data is unavailable, say so explicitly — NEVER invent numbers or make up data.
Be concise and helpful.

${context ? `\nRelevant RentPi Data:\n${context}` : ''}`;

    const reply = await askLLM(conversationMessages, systemPrompt);

    // Save messages
    await Message.create({ sessionId, role: 'user', content: message });
    await Message.create({ sessionId, role: 'assistant', content: reply });

    // P16: Handle session
    let session = await Session.findOne({ sessionId });
    if (!session) {
      const name = await generateSessionName(message);
      session = await Session.create({ sessionId, name });
    }
    session.lastMessageAt = new Date();
    await session.save();

    res.json({ sessionId, reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── P16: List sessions ──────────────────────────────────────────────────────
app.get('/chat/sessions', async (req, res) => {
  try {
    const sessions = await Session.find().sort({ lastMessageAt: -1 }).lean();
    res.json({
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        name: s.name,
        lastMessageAt: s.lastMessageAt,
      })),
    });
  } catch (err) {
    console.error('Sessions error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── P16: Get session history ────────────────────────────────────────────────
app.get('/chat/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId }).lean();
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const messages = await Message.find({ sessionId }).sort({ timestamp: 1 }).lean();
    res.json({
      sessionId,
      name: session.name,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── P16: Delete session ─────────────────────────────────────────────────────
app.delete('/chat/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await Session.deleteOne({ sessionId });
    await Message.deleteMany({ sessionId });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agentic Service running on port ${PORT}`);
});
