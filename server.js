const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.send(`
    <h1>Party Dash Server Test</h1>
    <p>Server is working!</p>
    <p>Directory: ${__dirname}</p>
    <p>Looking for: ${path.join(__dirname, "public", "index.html")}</p>
  `);
});

const rooms = new Map();
const COLORS = ["#ff5c7a", "#45aaf2", "#26de81", "#fed330"];

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function newRoom(code) {
  return {
    code,
    started: false,
    winner: null,
    turn: 0,
    players: [],
    createdAt: Date.now()
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    started: room.started,
    winner: room.winner,
    turn: room.turn,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      position: p.position,
      coins: p.coins,
      connected: p.connected
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", publicRoom(room));
}

function resetGame(room) {
  room.started = true;
  room.winner = null;
  room.turn = 0;
  room.players.forEach((p, i) => {
    p.position = 0;
    p.coins = 0;
    p.color = COLORS[i];
  });
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }, ack) => {
    const code = makeCode();
    const room = newRoom(code);
    const player = {
      id: socket.id,
      name: String(name || "Player").slice(0, 16),
      color: COLORS[0],
      position: 0,
      coins: 0,
      connected: true
    };
    room.players.push(player);
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    ack({ ok: true, code });
    broadcast(room);
  });

  socket.on("joinRoom", ({ code, name }, ack) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: "Room not found." });
    if (room.started) return ack({ ok: false, error: "That game has already started." });
    if (room.players.length >= 4) return ack({ ok: false, error: "Room is full." });

    const player = {
      id: socket.id,
      name: String(name || "Player").slice(0, 16),
      color: COLORS[room.players.length],
      position: 0,
      coins: 0,
      connected: true
    };
    room.players.push(player);
    socket.join(code);
    socket.data.room = code;
    ack({ ok: true, code });
    broadcast(room);
  });

  socket.on("startGame", ack => {
    const room = rooms.get(socket.data.room);
    if (!room) return ack?.({ ok: false, error: "Not in a room." });
    if (room.players.length < 2) return ack?.({ ok: false, error: "Need at least 2 players." });
    resetGame(room);
    broadcast(room);
    ack?.({ ok: true });
  });

  socket.on("roll", ack => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.started || room.winner) return ack?.({ ok: false, error: "Game is not active." });

    const current = room.players[room.turn];
    if (!current || current.id !== socket.id) {
      return ack?.({ ok: false, error: "It is not your turn." });
    }

    const roll = 1 + Math.floor(Math.random() * 6);
    current.position = Math.min(30, current.position + roll);
    current.coins += roll === 6 ? 3 : 1;

    if (current.position >= 30) {
      room.winner = current.id;
      io.to(room.code).emit("rolled", { playerId: socket.id, roll });
      broadcast(room);
      return ack?.({ ok: true, roll });
    }

    room.turn = (room.turn + 1) % room.players.length;
    io.to(room.code).emit("rolled", { playerId: socket.id, roll });
    broadcast(room);
    ack?.({ ok: true, roll });
  });

  socket.on("playAgain", () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    resetGame(room);
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;

    // Remove disconnected players only before the game begins.
    if (!room.started) {
      room.players = room.players.filter(p => p.id !== socket.id);
      room.players.forEach((p, i) => p.color = COLORS[i]);
    }
    broadcast(room);

    if (room.players.length === 0) rooms.delete(code);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Party Dash running at port ${PORT}`);
});
