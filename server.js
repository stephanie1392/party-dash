
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
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const ROLE_INFO = [
  { role: "King", emoji: "🤴" },
  { role: "Minister", emoji: "🤵" },
  { role: "Police", emoji: "👮" },
  { role: "Thief", emoji: "😈" }
];

const queue = [];
const matches = new Map();
const scores = new Map();
let nextMatchId = 1;
let queueTimer = null;

function cleanName(value) {
  return String(value || "Player").trim().slice(0, 16) || "Player";
}

function publicPlayers(match, reveal = false) {
  return match.players.map(p => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    score: scores.get(p.name) || 0,
    role: reveal ? p.role : undefined,
    roleRevealed: reveal
  }));
}

function sendUpdate(match, phase, canAccuse = true) {
  for (const p of match.players) {
    if (p.isBot) continue;
    io.to(p.id).emit("gameUpdate", {
      players: publicPlayers(match),
      phase,
      canAccuse: canAccuse && !match.finished
    });
  }
}

function sendChat(match, name, message, system = false) {
  const item = { name, message, system };
  io.to(match.id).emit("chatMessage", item);
}

function botReply(match, bot, message) {
  if (match.finished) return;

  const replies = [
    "I was nowhere near the thief!",
    "We should look carefully at everyone's story.",
    "That sounds suspicious. Can you explain more?",
    "I think we need more clues before accusing anyone.",
    "I saw people moving around, but I'm not completely sure.",
    "Let's hear what the others have to say."
  ];

  const text = message.toLowerCase();
  let reply;

  if (text.includes("?")) {
    reply = replies[Math.floor(Math.random() * replies.length)];
  } else {
    reply = "Interesting. Let's investigate before deciding.";
  }

  sendChat(match, bot.name, reply);
}

function createBot(index) {
  return {
    id: `bot-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: ["Milo", "Coco", "Maya", "Raja"][index % 4],
    isBot: true,
    role: null
  };
}

function startMatch(humans) {
  if (!humans.length) return;

  const id = `match-${nextMatchId++}`;
  const match = {
    id,
    players: humans.map(player => ({
      id: player.id,
      name: player.name,
      isBot: false,
      role: null
    })),
    round: 1,
    finished: false,
    accused: false
  };

  while (match.players.length < 4) {
    match.players.push(createBot(match.players.length));
  }

  const shuffledRoles = [...ROLE_INFO].sort(() => Math.random() - 0.5);
  match.players.forEach((player, index) => {
    player.role = shuffledRoles[index].role;
    if (!scores.has(player.name)) scores.set(player.name, 0);
    if (!player.isBot) {
      player.matchId = id;
      const socket = io.sockets.sockets.get(player.id);
      if (socket) {
        socket.data.matchId = id;
        socket.join(id);
      }
    }
  });

  matches.set(id, match);

  for (const player of match.players) {
    if (player.isBot) continue;
    io.to(player.id).emit("matchStarted", {
      round: match.round,
      myRole: player.role,
      players: publicPlayers(match)
    });
  }

  sendChat(match, "Game Host", "The investigation begins! Ask questions to find the thief.", true);

  // Bots make the investigation feel active.
  const firstBot = match.players.find(p => p.isBot);
  if (firstBot) {
    setTimeout(() => {
      if (!match.finished) {
        sendChat(match, firstBot.name, "Hello everyone! Where were you when the theft happened?");
      }
    }, 1800);
  }
}

function startQueuedMatch() {
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }

  const humans = [];
  while (queue.length && humans.length < 4) {
    const entry = queue.shift();
    const socket = io.sockets.sockets.get(entry.id);
    if (socket && socket.connected) humans.push(entry);
  }

  if (humans.length) startMatch(humans);

  // Keep waiting for any remaining players.
  if (queue.length) scheduleQueue();
}

function scheduleQueue() {
  if (queueTimer || !queue.length) return;
  queueTimer = setTimeout(startQueuedMatch, 8000);
}

function removeFromQueue(socketId) {
  const index = queue.findIndex(p => p.id === socketId);
  if (index !== -1) queue.splice(index, 1);
}

function finishRound(match, suspectId) {
  if (match.finished) return;

  const thief = match.players.find(p => p.role === "Thief");
  const minister = match.players.find(p => p.role === "Minister");
  const king = match.players.find(p => p.role === "King");
  const police = match.players.find(p => p.role === "Police");
  const caught = thief && thief.id === suspectId;

  if (caught) {
    scores.set(king.name, (scores.get(king.name) || 0) + 1000);
    scores.set(minister.name, (scores.get(minister.name) || 0) + 500);
    scores.set(police.name, (scores.get(police.name) || 0) + 300);
  } else {
    const transfer = 500;
    scores.set(thief.name, (scores.get(thief.name) || 0) + transfer);
  }

  match.finished = true;

  const revealed = publicPlayers(match, true);
  const message = caught
    ? `${thief.name} was the thief and was caught! King +1000, Minister +500, Police +300.`
    : `The accusation was wrong! ${thief.name} was the thief. The Minister's 500 points go to the Thief.`;

  for (const p of match.players) {
    if (p.isBot) continue;
    io.to(p.id).emit("roundResult", {
      caught: Boolean(caught),
      message,
      players: revealed
    });
  }
}

io.on("connection", socket => {
  socket.on("playNow", (data, ack) => {
    if (socket.data.matchId) {
      return ack?.({ ok: false, error: "You are already in a match." });
    }

    removeFromQueue(socket.id);

    const entry = {
      id: socket.id,
      name: cleanName(data?.name)
    };

    queue.push(entry);
    socket.data.queued = true;

    socket.emit("matchWaiting", {
      message: "Looking for players. Computer players will fill empty seats shortly."
    });

    ack?.({ ok: true });

    if (queue.length >= 4) {
      startQueuedMatch();
    } else {
      scheduleQueue();
    }
  });

  socket.on("cancelMatch", () => {
    removeFromQueue(socket.id);
    socket.data.queued = false;
    if (!queue.length && queueTimer) {
      clearTimeout(queueTimer);
      queueTimer = null;
    }
  });

  socket.on("sendChat", (data, ack) => {
    const match = matches.get(socket.data.matchId);
    if (!match || match.finished) {
      return ack?.({ ok: false, error: "You are not in an active investigation." });
    }

    const player = match.players.find(p => p.id === socket.id);
    const message = String(data?.message || "").trim().slice(0, 200);

    if (!player || !message) {
      return ack?.({ ok: false, error: "Enter a message first." });
    }

    sendChat(match, player.name, message);
    ack?.({ ok: true });

    const bot = match.players.find(p => p.isBot);
    if (bot && Math.random() < 0.8) {
      setTimeout(() => botReply(match, bot, message), 1000 + Math.random() * 2000);
    }
  });

  socket.on("accuse", (data, ack) => {
    const match = matches.get(socket.data.matchId);
    if (!match || match.finished) {
      return ack?.({ ok: false, error: "There is no active investigation." });
    }

    if (match.accused) {
      return ack?.({ ok: false, error: "An accusation has already been made." });
    }

    const suspect = match.players.find(p => p.id === data?.suspectId);
    if (!suspect || suspect.id === socket.id) {
      return ack?.({ ok: false, error: "Choose another player." });
    }

    match.accused = true;
    ack?.({ ok: true });
    finishRound(match, suspect.id);
  });

  socket.on("playAgain", ack => {
    const oldMatch = matches.get(socket.data.matchId);
    if (!oldMatch || !oldMatch.finished) {
      return ack?.({ ok: false, error: "Finish the current round first." });
    }

    // Start a fresh four-player round with the same people.
    const humans = oldMatch.players
      .filter(p => !p.isBot)
      .map(p => ({ id: p.id, name: p.name }));

    matches.delete(oldMatch.id);
    socket.data.matchId = null;

    ack?.({ ok: true });
    startMatch(humans);
  });

  socket.on("leaveMatch", () => {
    const match = matches.get(socket.data.matchId);
    if (match) {
      match.players = match.players.filter(p => p.id !== socket.id);
      socket.leave(match.id);
      if (!match.players.length) matches.delete(match.id);
    }

    socket.data.matchId = null;
    removeFromQueue(socket.id);
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    const match = matches.get(socket.data.matchId);
    if (match) {
      match.players = match.players.filter(p => p.id !== socket.id);
      if (!match.players.length) matches.delete(match.id);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Find the Thief running on port ${PORT}`);
});
