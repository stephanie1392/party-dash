const socket = io();

const $ = id => document.getElementById(id);
const home = $("home"), room = $("room"), game = $("game");
let myId = null;
let state = null;

socket.on("connect", () => myId = socket.id);

function show(screen) {
  [home, room, game].forEach(x => x.classList.add("hidden"));
  screen.classList.remove("hidden");
}
function nameValue() {
  return ($("name").value.trim() || "Player").slice(0, 16);
}
function msg(el, text) { el.textContent = text || ""; }

$("showJoin").onclick = () => $("joinBox").classList.toggle("hidden");

$("create").onclick = () => {
  socket.emit("createRoom", { name: nameValue() }, result => {
    if (!result.ok) return msg($("homeMsg"), result.error);
    $("roomCode").textContent = result.code;
    show(room);
  });
};

$("join").onclick = () => {
  const code = $("code").value.trim().toUpperCase();
  socket.emit("joinRoom", { code, name: nameValue() }, result => {
    if (!result.ok) return msg($("homeMsg"), result.error);
    $("roomCode").textContent = result.code;
    show(room);
  });
};

$("copy").onclick = async () => {
  await navigator.clipboard?.writeText(state?.code || "");
  msg($("roomMsg"), "Room code copied!");
};

$("start").onclick = () => {
  socket.emit("startGame", result => {
    if (!result?.ok) msg($("roomMsg"), result?.error);
  });
};

$("roll").onclick = () => {
  $("roll").disabled = true;
  socket.emit("roll", result => {
    if (!result.ok) {
      msg($("gameMsg"), result.error);
      $("roll").disabled = false;
    }
  });
};

$("again").onclick = () => socket.emit("playAgain");

$("leave").onclick = () => location.reload();

socket.on("rolled", ({ playerId, roll }) => {
  $("rollValue").textContent = roll;
});

socket.on("state", next => {
  state = next;
  if (!next.started) {
    $("roomCode").textContent = next.code;
    renderRoom(next);
    show(room);
  } else {
    renderGame(next);
    show(game);
  }
});

function renderRoom(s) {
  $("players").innerHTML = s.players.map((p, i) => `
    <div class="playerRow">
      <span class="dot" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name)}</span>
      ${p.id === myId ? '<span class="badge">YOU</span>' : ""}
    </div>
  `).join("");
  $("start").disabled = s.players.length < 2;
  $("start").textContent = s.players.length < 2 ? "Waiting for 2 players…" : "Start game";
}

function renderGame(s) {
  const current = s.players[s.turn];
  const mine = current?.id === myId;
  $("turnText").textContent = s.winner
    ? `🏆 ${s.players.find(p => p.id === s.winner)?.name || "Someone"} wins!`
    : mine ? "🎯 Your turn!" : `⏳ ${current?.name || "Player"} is rolling…`;

  $("roll").disabled = !mine || !!s.winner;
  $("roll").classList.toggle("hidden", !!s.winner);
  $("again").classList.toggle("hidden", !s.winner);

  if (s.winner) {
    msg($("gameMsg"), "Great game! Start another round when you're ready.");
  } else {
    msg($("gameMsg"), "");
  }

  renderBoard(s);
  $("scoreboard").innerHTML = s.players.map(p => `
    <div class="score" style="outline:${p.id === current?.id ? "3px solid " + p.color : "none"}">
      <strong>${escapeHtml(p.name)}</strong>
      <span>📍 ${p.position}/30 · 🪙 ${p.coins}</span>
    </div>
  `).join("");
}

function renderBoard(s) {
  const board = $("board");
  board.innerHTML = "";
  const positions = s.players.map(p => p.position);

  for (let i = 0; i < 31; i++) {
    const tile = document.createElement("div");
    tile.className = "tile" + (i === 30 ? " finish" : "");
    tile.textContent = i === 0 ? "START" : i === 30 ? "🏁" : i;
    tile.style.gridColumn = String((i % 10) + 1);
    tile.style.gridRow = String(Math.floor(i / 10) + 1);

    // Snake-like row order for a more board-game feel.
    if (Math.floor(i / 10) % 2 === 1) {
      tile.style.gridColumn = String(10 - (i % 10));
    }

    s.players.forEach((p, idx) => {
      if (p.position === i) {
        const token = document.createElement("div");
        token.className = "token";
        token.style.background = p.color;
        token.style.left = `${5 + (idx % 2) * 35}%`;
        token.style.top = `${5 + Math.floor(idx / 2) * 38}%`;
        token.textContent = String(idx + 1);
        tile.appendChild(token);
      }
    });
    board.appendChild(tile);
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}