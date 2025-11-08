import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import OpenAI from 'openai';

const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ORIGIN || '*';
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: ORIGIN, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: ORIGIN }));
app.use(express.json());

// In-memory stores
const conversations = new Map(); // threadId -> [{role, content}]

// OpenAI client (optional). If missing, fallback to echo.
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('[OpenAI] Client initialized');
} else {
  console.warn('[OpenAI] OPENAI_API_KEY not set. Using echo responses.');
}

// Socket.io
io.on('connection', (socket) => {
  socket.on('join', ({ userId, isAdmin }) => {
    try {
      if (userId) {
        socket.data.userId = userId;
        socket.join(userId); // personal room
        console.log('[socket] user joined:', userId, 'admin=', !!isAdmin);
      }
      if (isAdmin) socket.join('admins');
      socket.emit('notification', { message: 'Connected to realtime server ✅' });
    } catch (e) {
      console.warn('[socket] join failed', e);
    }
  });
});

// Demo: emit periodic admin analytics updates every 15s
setInterval(() => {
  const now = new Date();
  const label = now.toLocaleTimeString();
  const ordersValue = Math.floor(Math.random() * 10) + 1;
  const revenueValue = Math.floor(Math.random() * 1000) + 200;
  io.to('admins').emit('analyticsUpdate', {
    orders: { labels: [label], values: [ordersValue] },
    revenue: { labels: [label], values: [revenueValue] }
  });
}, 15000);

// REST: Analytics initial data
app.get('/analytics', (_req, res) => {
  const labels = Array.from({ length: 7 }, (_, i) => `Day ${i + 1}`);
  const orders = labels.map(() => Math.floor(Math.random() * 20) + 5);
  const revenue = labels.map(() => Math.floor(Math.random() * 2000) + 500);
  res.json({
    orders: { labels, values: orders },
    revenue: { labels, values: revenue }
  });
});

// REST: Chat (echo mode if no OPENAI_API_KEY)
app.post('/chat', async (req, res) => {
  try {
    const { userId = 'anonymous', threadId = 'global', message = '' } = req.body || {};
    if (!message.trim()) return res.json({ reply: 'Please send a non-empty message.' });

    const hist = conversations.get(threadId) || [];
    let replyText = '';

    if (openai) {
      const systemPrompt = `You are a helpful assistant for an e-commerce battery store. Keep responses short.`;
      const messages = [
        { role: 'system', content: systemPrompt },
        ...hist.slice(-8),
        { role: 'user', content: message }
      ];
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages
      });
      replyText = completion.choices?.[0]?.message?.content?.trim() || '...';
    } else {
      replyText = `Echo: ${message}`;
    }

    hist.push({ role: 'user', content: message });
    hist.push({ role: 'assistant', content: replyText });
    conversations.set(threadId, hist);

    // notify the user room that the chat responded
    if (userId) {
      io.to(userId).emit('notification', { message: 'We responded to your chat.' });
    }

    res.json({ reply: replyText });
  } catch (e) {
    console.error('[POST /chat] error:', e);
    res.status(500).json({ reply: 'Sorry, something went wrong on the server.' });
  }
});

// Health
app.get('/', (_req, res) => res.send('Nithin Battery Realtime Server is running'));

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});