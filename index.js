import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const users = new Map(); 
const chats = new Map(); 
const messageCache = new Set(); 
const userChats = new Map(); 

io.on('connection', (socket) => {
  const userId = socket.handshake.auth.userId;
  const userName = socket.handshake.auth.userName;

  socket.on('registerUser', ({ userId, userName }) => {
    users.set(userId, { socketId: socket.id, userName, userId });
    const onlineUsers = Array.from(users.values()).map(u => ({
      id: u.userId,
      name: u.userName
    }));

    io.emit('onlineUsers', onlineUsers);
    
    const userChatIds = userChats.get(userId) || [];
    const existingChats = userChatIds
      .map(chatId => chats.get(chatId))
      .filter(Boolean);
  
    socket.emit('initialChats', existingChats);
    userChatIds.forEach(chatId => {
      socket.join(chatId);
    });
  });

  socket.on('createChat', (chat) => {
    if (!chats.has(chat.id)) {
      chats.set(chat.id, {
        ...chat,
        messages: [],
        createdAt: Date.now(),
      });
      
      chat.participants.forEach(participantId => {
        const userChatList = userChats.get(participantId) || [];
        userChats.set(participantId, [...userChatList, chat.id]);
      });
    }
    
    chat.participants.forEach(participantId => {
      if (participantId !== userId) {
        const participant = users.get(participantId);
        if (participant) {
          io.to(participant.socketId).emit('chatInvite', chat);
        }
      }
    });
  });

  socket.on('joinChat', ({ chatId, userId }) => {
    socket.join(chatId);
    const chat = chats.get(chatId);
    if (chat) {
      socket.emit('chatHistory', {
        chatId,
        messages: chat.messages || [],
      });
    }
  });
  
  socket.on('chatMessage', (msg, callback) => {
  
    if (messageCache.has(msg.id)) {
    
      if (callback) callback({ success: false, reason: 'duplicate' });
      return;
    }
    
    messageCache.add(msg.id);
    
    const chat = chats.get(msg.chatId);

    if (chat) {
      chat.messages.push(msg);
      if (chat.messages.length > 100) {
        chat.messages = chat.messages.slice(-100);
      }
    }
  
    io.to(msg.chatId).emit('chatMessage', msg);
    
    if (callback) {
      callback({ success: true });
    }
    
    io.to(msg.chatId).emit('messageStatus', {
      messageId: msg.id,
      status: 'sent',
    });
  
    setTimeout(() => {
      messageCache.delete(msg.id);
    }, 5 * 60 * 1000);
  });

  socket.on('typing', ({ chatId, userName }) => {
    socket.to(chatId).emit('typing', { chatId, userName });
  });

  socket.on('stopTyping', ({ chatId, userName }) => {
    socket.to(chatId).emit('stopTyping', { chatId, userName });
  });

  socket.on('disconnect', () => {
    for (const [uid, userInfo] of users.entries()) {
      if (userInfo.socketId === socket.id) {
        users.delete(uid);
        break;
      }
    }
    
    const onlineUsers = Array.from(users.values()).map(u => ({
      id: u.userId,
      name: u.userName
    }));
    io.emit('onlineUsers', onlineUsers);
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Real-time Chat Server',
    status: 'running',
    stats: {
      activeConnections: io.sockets.sockets.size,
      onlineUsers: users.size,
      totalChats: chats.size,
      cachedMessages: messageCache.size,
    },
  });
});

server.listen(4600)