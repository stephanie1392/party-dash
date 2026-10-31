
const socket = io();
const $ = id => document.getElementById(id);

let myId = null;
let currentGame = null;
let myRole = null;
let hasResult = false;


const roleInfo = {
  King: { emoji: "🤴", hint: "You are the King. Observe the investigation." },
  Minister: { emoji: "🤵", hint: "Help discover the real thief. Your points depend on your guess." },
  Police: { emoji: "👮", hint: "Investigate the players and help catch the thief." },
  Thief: { emoji: "😈", hint: "Keep your identity secret and try not to get caught." }
};


function showScreen(id) {
  ["home", "waiting", "game"].forEach(screen => {
    $(screen).classList.toggle("hidden", screen !== id);
  });
}

function setMessage(id, message) {
  $(id).textContent = message || "";
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[char]);
}

socket.on("connect", () => {
  myId = socket.id;
  loadLeaderboard();
});

function loadLeaderboard() {
  socket.emit("getLeaderboard", result => {
    if (!result?.ok) return;

    const container = $("homeLeaderboard");
    if (!container) return;

    if (!result.leaderboard.length) {
      container.innerHTML = "<p>No scores yet. Be the first champion!</p>";
      return;
    }

    container.innerHTML = result.leaderboard.map((player, index) => `
      <div class="score">
        <strong>${index + 1}. ${safeText(player.name)}</strong>
        <span>🏆 ${Number(player.score) || 0} points</span>
      </div>
    `).join("");
  });
}

socket.on("connect_error", () => {
  setMessage("homeMsg", "Connection problem. Please refresh and try again.");
});


$("play").addEventListener("click", () => {
const name = "Player" + Math.floor(1000 + Math.random() * 9000);

  $("play").disabled = true;
  setMessage("homeMsg", "Connecting to the game...");

  socket.emit("playNow", { name }, result => {
    $("play").disabled = false;

    if (!result?.ok) {
      setMessage("homeMsg", result?.error || "Could not start a game.");
      return;
    }

    showScreen("waiting");
    setMessage("waitingMsg", "Looking for players. Computer players will fill empty seats.");
  });
});


$("cancel").addEventListener("click", () => {
  socket.emit("cancelMatch");
  showScreen("home");
  setMessage("homeMsg", "Matchmaking cancelled.");
});

$("homeButton").addEventListener("click", () => {
  socket.emit("leaveMatch");
  currentGame = null;
  myRole = null;
  hasResult = false;
  showScreen("home");  
  loadLeaderboard();
});

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("chatInput");
  const message = input.value.trim();
  if (!message || !currentGame || hasResult) return;

  socket.emit("sendChat", { message }, result => {
    if (!result?.ok) {
      setMessage("roundStatus", result?.error || "Message could not be sent.");
    }
  });
  input.value = "";
  input.focus();
});

$("again").addEventListener("click", () => {
  $("again").disabled = true;
  socket.emit("playAgain", result => {
    $("again").disabled = false;
    if (result && !result.ok) {
      setMessage("roundStatus", result.error || "Could not start another round.");
    }
  });
});

socket.on("matchWaiting", data => {
  showScreen("waiting");
  setMessage("waitingMsg", data?.message || "Finding players...");
});

socket.on("matchStarted", data => {
  currentGame = data;
  myRole = data.myRole;
  hasResult = false;

  const role = roleInfo[myRole] || { emoji: "❓", hint: "Keep your role secret." };
  $("myRoleEmoji").textContent = role.emoji;
  $("myRole").textContent = myRole || "Unknown";
  $("roleHint").textContent = role.hint;
  $("chatMessages").innerHTML = "";
  $("resultPanel").classList.add("hidden");
  $("chatInput").disabled = false;

showScreen("game");
renderPlayers(data.players || []);
renderSuspects(data.players || []);
setMessage("roundStatus", "Round " + (data.round || 1) + " has started. Ask questions and investigate!");
});
socket.on("gameUpdate", data => {
  if (!currentGame) return;

  currentGame = { ...currentGame, ...data };

  if (data.players) {
    renderPlayers(data.players);
    renderSuspects(data.players);
  }

  if (data.phase) {
    setMessage("roundStatus", data.phase);
  }
});

socket.on("chatMessage", message => {
  addChatMessage(message);
});

socket.on("roundResult", result => {
  console.log("ROUND RESULT RECEIVED:", result);
  hasResult = true;
  $("guessPanel").classList.add("hidden");
  $("resultPanel").classList.remove("hidden");
  $("chatInput").disabled = true;

  $("resultTitle").textContent = result.caught
    ? "🎉 The Thief Was Caught!"
    : "😈 The Thief Escaped!";

  $("resultText").textContent = result.message || "The roles have been revealed.";
  $("scoreboard").innerHTML = (result.players || []).map(player => `
    <div class="score">
      <strong>${safeText(player.name)}</strong>
      <span>${safeText(player.role || "Player")} · 🏆 ${Number(player.score) || 0} points</span>
    </div>
  `).join("");
  
loadLeaderboard();

  (result.players || []).forEach(player => {
    addChatMessage({
      system: true,
      message: `${player.name} was ${player.role}.`
    });
  });
});

socket.on("gameError", data => {
  setMessage("roundStatus", data?.message || "Something went wrong.");
});


function renderPlayers(players) {
  $("players").innerHTML = players.map(player => {
    const isMe = player.id === myId;
    const computer = player.isBot ? " 🤖" : "";

    const role = player.roleRevealed && player.role
      ? player.role
      : player.publicRole;

    const roleLabel = role
      ? " · " + safeText(role)
      : "";

    return `
      <div class="playerRow">
        <span class="dot"></span>
        <span>
          ${safeText(player.name)}${computer}${isMe ? " (YOU)" : ""}${roleLabel}
        </span>
      </div>
    `;
  }).join("");
}

function renderSuspects(players) {
  const panel = $("guessPanel");
  const buttons = $("suspectButtons");

  // Only the Minister can make the final accusation.
  if (myRole !== "Minister" || hasResult) {
    panel.classList.add("hidden");
    buttons.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");

  buttons.innerHTML = players
    .filter(player => player.id !== myId)
    .map(player => `
      <button class="secondary suspect" data-id="${safeText(player.id)}">
        🕵️ ${safeText(player.name)}
      </button>
    `).join("");

  buttons.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      if (hasResult || myRole !== "Minister") return;

      const confirmed = window.confirm(
        "Accuse this player of being the Thief?"
      );
      if (!confirmed) return;

      buttons.querySelectorAll("button").forEach(item => {
        item.disabled = true;
      });

      socket.emit(
        "accuse",
        { suspectId: button.dataset.id },
        result => {
          if (!result?.ok) {
            setMessage(
              "roundStatus",
              result?.error || "Accusation failed."
            );

            buttons.querySelectorAll("button").forEach(item => {
              item.disabled = false;
            });
          }
        }
      );
    });
  });
}

function addChatMessage(data) {
  const container = $("chatMessages");
  const item = document.createElement("div");
  item.className = data?.system ? "chat-message system" : "chat-message";

  if (data?.system) {
    item.textContent = data.message || "";
  } else {
    const author = document.createElement("strong");
    author.textContent = (data?.name || "Player") + ": ";
    const text = document.createElement("span");
    text.textContent = data?.message || "";
    item.append(author, text);
  }

  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}
