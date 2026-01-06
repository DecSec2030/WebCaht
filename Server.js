// ===============================
// server.js — Messenger Server (Render-ready)
// ===============================
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// CORS настройка
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// Socket.io
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// --- База данных ---
let MessageModel = null;
let inMemoryMessages = [];

async function connectDatabase() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.log("⚠️ Using in-memory storage.");
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB connected");
    const MessageSchema = new mongoose.Schema({
      chatId: { type: String, index: true },
      sender: String,
      text: String,
      time: String,
      createdAt: { type: Date, default: Date.now }
    });
    MessageModel = mongoose.model("Message", MessageSchema);
  } catch (err) {
    console.error("❌ MongoDB failed. Using memory.", err);
  }
}
connectDatabase();

// --- Вспомогательные функции ---
async function saveMessage(message) {
  if (MessageModel) return MessageModel.create(message);
  inMemoryMessages.push(message);
  return message;
}
async function getMessages(chatId) {
  if (MessageModel) return MessageModel.find({ chatId }).sort({ createdAt: 1 }).lean();
  return inMemoryMessages.filter(m => m.chatId === chatId);
}
async function clearMessages(chatId) {
  if (MessageModel) await MessageModel.deleteMany({ chatId });
  else inMemoryMessages = inMemoryMessages.filter(m => m.chatId !== chatId);
}

// --- REST API ---
app.get("/messages/:chatId", async (req, res) => {
  try {
    const messages = await getMessages(req.params.chatId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load messages" });
  }
});
app.post("/messages", async (req, res) => {
  try {
    const message = {
      chatId: req.body.chatId,
      sender: req.body.sender,
      text: req.body.text,
      time: req.body.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date()
    };
    const saved = await saveMessage(message);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: "Failed to save message" });
  }
});

// --- WebSocket ---
io.on("connection", socket => {
  console.log("🔌 Client connected:", socket.id);
  socket.on("join_chat", chatId => socket.join(chatId));
  socket.on("send_message", async data => {
    const message = {
      chatId: data.chatId,
      sender: data.sender,
      text: data.text,
      time: data.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date()
    };
    const saved = await saveMessage(message);
    io.to(data.chatId).emit("new_message", saved);
  });
  socket.on("typing", data => socket.to(data.chatId).emit("user_typing", data));
  socket.on("clear_chat", async chatId => {
    await clearMessages(chatId);
    io.to(chatId).emit("chat_cleared");
  });
  socket.on("disconnect", () => console.log("❌ Client disconnected:", socket.id));
});

// --- Запуск сервера ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
