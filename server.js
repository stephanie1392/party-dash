
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

    score: reveal
      ? (p.isBot
          ? (match.botScores.get(p.id) || 0)
          : (scores.get(p.name) || 0))
      : undefined,

    publicRole: p.role === "Minister" ? "Minister" : undefined,
    role: reveal ? p.role : undefined,
    roleRevealed: reveal
  }));
}

function addPoints(match, player, amount) {
  if (!player) return;

  if (player.isBot) {
    const current = match.botScores.get(player.id) || 0;
    match.botScores.set(player.id, current + amount);
  } else {
    const current = scores.get(player.name) || 0;
    scores.set(player.name, current + amount);
  }
}

function sendChat(match, name, message, system = false) {
  io.to(match.id).emit("chatMessage", {
    name,
    message,
    system
  });
}

function botReply(match, bot, message) {
  if (match.finished || !match.players.includes(bot)) return;

  const text = message.toLowerCase();

  const replies = [
    "I was nowhere near the thief!",
    "We should carefully check everyone's story.",
    "That sounds suspicious. Can you explain more?",
    "I think we need more clues before accusing anyone.",
    "I saw people moving around, but I'm not completely sure.",
    "Let's hear what the others have to say.",
    "Minister, have you noticed anything unusual?",
    "I think someone is hiding an important detail.",
    "We shouldn't rush. The real thief might fool us!",
    "Everyone seems suspicious to me right now!",
    "I agree! We need to find out who is telling the truth.",
    "Minister, I hope you make the right decision!"
  ];

  const questionReplies = [
    "That's a good question. I think we should investigate further.",
    "I'm not sure, but someone's story doesn't add up.",
    "I think we should ask the others too.",
    "Minister, what do you think about that?"
  ];

  let options = text.includes("?")
    ? [...questionReplies, ...replies]
    : replies;

  const recent = match.botReplyHistory || [];

  const freshReplies = options.filter(
    reply => !recent.includes(reply)
  );

  if (freshReplies.length) {
    options = freshReplies;
  }

  const reply = options[Math.floor(Math.random() * options.length)];

  match.botReplyHistory.push(reply);

  if (match.botReplyHistory.length > 5) {
    match.botReplyHistory.shift();
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

function sendUpdate(match, phase, canAccuse = true) {
  for (const p of match.players) {
    if (p.isBot) continue;

    io.to(p.id).emit("gameUpdate", {
      players: publicPlayers(match),
      phase,
      canAccuse:
        canAccuse &&
        !match.finished &&
        p.role === "Minister"
    });
  }
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
    botScores: new Map(),
    botReplyHistory: [],
    botReplyIndex: 0,
    round: 1,
    finished: false,
    accused: false
  };

  while (match.players.length < 4) {
    match.players.push(createBot(match.players.length));
  }

  const humanPlayers = match.players.filter(
    player => !player.isBot
  );

  const shuffledRoles = [...ROLE_INFO].sort(
    () => Math.random() - 0.5
  );

  const ministerPlayer = humanPlayers[
    Math.floor(Math.random() * humanPlayers.length)
  ];

  const otherRoles = shuffledRoles.filter(
    role => role.role !== "Minister"
  );

  const shuffledOtherRoles = [...otherRoles].sort(
    () => Math.random() - 0.5
  );

  let otherRoleIndex = 0;

  match.players.forEach(player => {
    if (player === ministerPlayer) {
      player.role = "Minister";
    } else {
      player.role = shuffledOtherRoles[otherRoleIndex++].role;
    }
  });

  match.players.forEach(player => {
    if (player.isBot) {
      match.botScores.set(player.id, 0);
      return;
    }

    if (!scores.has(player.name)) {
      scores.set(player.name, 0);
    }

    const playerSocket = io.sockets.sockets.get(player.id);

    if (playerSocket) {
      playerSocket.data.matchId = id;
      playerSocket.data.queued = false;
      playerSocket.join(id);
    }
  });

  matches.set(id, match);

  for (const player of match.players) {
    if (player.isBot) continue;

    io.to(player.id).emit("matchStarted", {
      round: match.round,
      myRole: player.role,
      policeId: player.role === "Minister"
        ? match.players.find(p => p.role === "Police")?.id
        : undefined,
      players: publicPlayers(match)
    });
  }

  // Opening investigation message
  sendChat(
    match,
    "Game Host",
    "🔍 Find the real thief, Minister!",
    true
  );

  // First computer player welcomes everyone
  const bots = match.players.filter(p => p.isBot);

  if (bots.length) {
    match.botReplyIndex = 1;

    setTimeout(() => {
      if (!match.finished) {
        sendChat(
          match,
          bots[0].name,
          "I'm ready to investigate! Minister, let's find the thief!"
        );
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
    const playerSocket = io.sockets.sockets.get(entry.id);

    if (playerSocket && playerSocket.connected) {
      humans.push(entry);
    }
  }

  if (humans.length) {
    startMatch(humans);
  }

  if (queue.length) {
    scheduleQueue();
  }
}

function scheduleQueue() {
  if (queueTimer || !queue.length) return;

  queueTimer = setTimeout(startQueuedMatch, 8000);
}

function removeFromQueue(socketId) {
  const index = queue.findIndex(p => p.id === socketId);

  if (index !== -1) {
    queue.splice(index, 1);
  }
}

function finishRound(match, suspectId) {
  if (match.finished) return;

  const thief = match.players.find(p => p.role === "Thief");
  const minister = match.players.find(p => p.role === "Minister");
  const king = match.players.find(p => p.role === "King");
  const police = match.players.find(p => p.role === "Police");

  const caught = thief && thief.id === suspectId;

  if (caught) {
    addPoints(match, king, 1000);
    addPoints(match, minister, 500);
    addPoints(match, police, 300);
  } else {
    addPoints(match, thief, 500);
  }

  match.finished = true;

  const revealed = publicPlayers(match, true);

  const message = caught
    ? `${thief.name} was the thief and was caught! King +1000, Minister +500, Police +300.`
    : `The accusation was wrong! ${thief.name} was the thief. The Thief earns 500 points.`;

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

  socket.on("getLeaderboard", ack => {
    const leaderboard = [...scores.entries()]
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    ack?.({
      ok: true,
      leaderboard
    });
  });

  socket.on("playNow", (data, ack) => {
    if (socket.data.matchId) {
      return ack?.({
        ok: false,
        error: "You are already in a match."
      });
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

  // One chat handler: computer players take turns replying.
  socket.on("sendChat", (data, ack) => {
    const match = matches.get(socket.data.matchId);

    if (!match || match.finished) {
      return ack?.({
        ok: false,
        error: "You are not in an active investigation."
      });
    }

    const player = match.players.find(
      p => p.id === socket.id
    );

    const message = String(data?.message || "")
      .trim()
      .slice(0, 200);

    if (!player || !message) {
      return ack?.({
        ok: false,
        error: "Enter a message first."
      });
    }

    sendChat(match, player.name, message);
    ack?.({ ok: true });

    const bots = match.players.filter(p => p.isBot);

    if (bots.length && Math.random() < 0.8) {
      const bot = bots[match.botReplyIndex % bots.length];

      match.botReplyIndex++;

      setTimeout(() => {
        botReply(match, bot, message);
      }, 1000 + Math.random() * 2000);
    }
  });

  socket.on("accuse", (data, ack) => {
    const match = matches.get(socket.data.matchId);

    if (!match || match.finished) {
      return ack?.({
        ok: false,
        error: "There is no active investigation."
      });
    }

    const accuser = match.players.find(
      p => p.id === socket.id
    );

    if (!accuser || accuser.role !== "Minister") {
      return ack?.({
        ok: false,
        error: "Only the Minister can make the final accusation."
      });
    }

    if (match.accused) {
      return ack?.({
        ok: false,
        error: "An accusation has already been made."
      });
    }

    const suspect = match.players.find(
      p => p.id === data?.suspectId
    );

    if (!suspect || suspect.id === socket.id) {
      return ack?.({
        ok: false,
        error: "Choose another player."
      });
    }

    match.accused = true;
    ack?.({ ok: true });

    finishRound(match, suspect.id);
  });

  socket.on("playAgain", ack => {
    const oldMatch = matches.get(socket.data.matchId);

    if (!oldMatch || !oldMatch.finished) {
      return ack?.({
        ok: false,
        error: "Finish the current round first."
      });
    }

    const humans = oldMatch.players
      .filter(p => !p.isBot)
      .map(p => ({
        id: p.id,
        name: p.name
      }));

    matches.delete(oldMatch.id);

    socket.data.matchId = null;

    ack?.({ ok: true });

    // Human scores remain; new bot scores start at zero.
    startMatch(humans);
  });

  socket.on("leaveMatch", () => {
    const match = matches.get(socket.data.matchId);

    if (match) {
      match.players = match.players.filter(
        p => p.id !== socket.id
      );

      socket.leave(match.id);

      if (!match.players.length) {
        matches.delete(match.id);
      }
    }

    socket.data.matchId = null;
    removeFromQueue(socket.id);
    socket.data.queued = false;
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);

    const match = matches.get(socket.data.matchId);

    if (match) {
      match.players = match.players.filter(
        p => p.id !== socket.id
      );

      if (!match.players.length) {
        matches.delete(match.id);
      }
    }
  });

});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Find the Thief running on port ${PORT}`);
});
