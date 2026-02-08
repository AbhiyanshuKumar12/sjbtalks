/***********************
 * GAME SETUP
 ***********************/
const words = require("./game/words"); // word list
const games = {}; // in-memory game state
let waitingRoom = null;
let waitingPlayers = [];
const MAX_PLAYERS = 4;

/***********************
 * BASIC SETUP
 ***********************/
require("dotenv").config();

const http = require("http");
const express = require("express");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/***********************
 * MONGODB CONNECTION
 ***********************/
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

/***********************
 * SOCKET.IO
 ***********************/
io.on("connection", (socket) => {

  /***********************
   * USER JOIN
   ***********************/
  socket.on("join", async (data) => {
    socket.username =
      data.identity === "anonymous"
        ? `User${Math.floor(Math.random() * 1000)}`
        : data.username || "Guest";

    socket.room =
      data.chatType === "room" && data.room
        ? data.room
        : "global";

    socket.join(socket.room);

    /* 🔹 INIT GAME STATE FOR ROOM */
    if (!games[socket.room]) {
      games[socket.room] = {
        players: [],
        drawerIndex: 0,
        scores: {},
        roundActive: false,
        word: "",
        host: null,
        guessed: new Set(),
        timeLeft: 60,
        wordPool: []
      };
    }

    const game = games[socket.room];

    if (!game.guessed) {
      game.guessed = new Set();
    }

    if (typeof game.timeLeft !== "number") {
      game.timeLeft = 60;
    }

    if (!Array.isArray(game.wordPool)) {
      game.wordPool = [];
    }

    // 👑 assign host if first player
    if (!game.host) {
      game.host = socket.id;
    }

    if (!game.players.includes(socket.id)) {
      game.players.push(socket.id);
      game.scores[socket.id] = 0;
    }

    /* 🔹 SEND CHAT HISTORY */
    const history = await Message.find({ room: socket.room })
      .sort({ createdAt: 1 })
      .limit(50);

    socket.emit(
      "history",
      history.map(msg => ({
        id: msg._id.toString(),
        user: msg.user,
        text: msg.text,
        reactions: Object.fromEntries(msg.reactions)
      }))
    );

    io.to(socket.room).emit(
      "system",
      `⚡ ${socket.username} joined`
    );
    // send updated scores to room
    io.to(socket.room).emit("score-update", game.scores);

    // tell client if they are host
    socket.emit("host-status", {
      isHost: socket.id === game.host
    });

    sendLeaderboard(socket.room);
  });

  /***********************
   * QUICK PLAY (MATCHMAKING)
   ***********************/
  socket.on("quick-play", () => {
    if (!waitingRoom) {
      waitingRoom = `quick-${Date.now()}`;
      waitingPlayers = [];
    }

    socket.username = `User${Math.floor(Math.random() * 1000)}`;
    socket.room = waitingRoom;
    socket.join(waitingRoom);
    waitingPlayers.push(socket.id);

    if (!games[waitingRoom]) {
      games[waitingRoom] = {
        players: [],
        drawerIndex: 0,
        scores: {},
        roundActive: false,
        word: "",
        host: socket.id,
        guessed: new Set(),
        timeLeft: 60,
        wordPool: []
      };
    }

    const game = games[waitingRoom];

    if (!game.players.includes(socket.id)) {
      game.players.push(socket.id);
      game.scores[socket.id] = 0;
    }

    io.to(socket.id).emit("host-status", {
      isHost: socket.id === game.host
    });

    io.to(waitingRoom).emit(
      "system",
      `⚡ ${socket.username} joined Quick Play (${waitingPlayers.length}/${MAX_PLAYERS})`
    );

    io.to(waitingRoom).emit("score-update", game.scores);
    sendLeaderboard(waitingRoom);

    if (waitingPlayers.length >= MAX_PLAYERS) {
      waitingRoom = null;
      waitingPlayers = [];
      io.to(socket.room).emit("system", "🎮 Room ready! Host can start.");
    }
  });

  /***********************
   * CHAT MESSAGE
   ***********************/
  socket.on("message", async (text) => {
    if (!socket.room) return;

    const msg = new Message({
      room: socket.room,
      user: socket.username,
      text,
      reactions: {
        "❤️": 0,
        "👀": 0,
        "💀": 0,
        "🫶": 0
      }
    });

    await msg.save();

    io.to(socket.room).emit("message", {
      id: msg._id.toString(),
      user: msg.user,
      text: msg.text,
      reactions: Object.fromEntries(msg.reactions)
    });
  });

  /***********************
   * REACTIONS
   ***********************/
  socket.on("react", async ({ messageId, emoji }) => {
    const msg = await Message.findById(messageId);
    if (!msg) return;

    msg.reactions.set(
      emoji,
      (msg.reactions.get(emoji) || 0) + 1
    );

    await msg.save();

    io.to(socket.room).emit("reaction-update", {
      id: msg._id.toString(),
      reactions: Object.fromEntries(msg.reactions)
    });
  });

  /***********************
   * TYPING
   ***********************/
  socket.on("typing", () => {
    if (!socket.room) return;
    socket.to(socket.room).emit(
      "typing",
      `${socket.username} is typing...`
    );
  });

  socket.on("stop-typing", () => {
    if (!socket.room) return;
    socket.to(socket.room).emit("stop-typing");
  });

  /***********************
   * START GAME
   ***********************/
  socket.on("start-game", () => {
    const room = socket.room;
    const game = games[room];

    // 👑 ONLY HOST CAN START
    if (!game || socket.id !== game.host) return;

    if (game.players.length < 2) {
      io.to(room).emit("system", "⚠️ Minimum 2 players required to start.");
      return;
    }

    if (game.roundActive) return;
    startRound(room);
  });

  /***********************
   * WORD SELECTION
   ***********************/
  socket.on("select-word", (word) => {
    const room = socket.room;
    const game = games[room];
    if (!game || game.word) return;

    const drawerSocketId = game.players[game.drawerIndex];
    if (socket.id !== drawerSocketId) return;
    if (!game.wordChoices || !game.wordChoices.includes(word)) return;

    game.word = word;
    game.roundActive = true;
    if (!game.guessed) {
      game.guessed = new Set();
    }
    game.guessed.clear();
    game.timeLeft = 60;
    game.revealed = new Array(word.length).fill(false);

    io.to(room).emit("guess-count", {
      guessed: 0,
      total: game.players.length - 1
    });

    // send role info
    io.to(socket.id).emit("round-start", {
      role: "drawer",
      word
    });

    game.players.forEach(id => {
      if (id !== socket.id) {
        io.to(id).emit("round-start", {
          role: "guesser",
          length: word.length
        });
      }
    });

    io.to(room).emit("system", "🎨 Round started!");

    // send current scores and initial time
    io.to(room).emit("score-update", game.scores);

    // initialize server-side timer
    io.to(room).emit("time", game.timeLeft);

    if (game.timer) {
      clearInterval(game.timer);
    }

    game.timer = setInterval(() => {
      game.timeLeft--;
      io.to(room).emit("time", game.timeLeft);

      // reveal letters at thresholds
      if ([40, 25, 10].includes(game.timeLeft)) {
        // find next unrevealed index
        let idx = game.revealed.findIndex(v => !v);
        if (idx !== -1) {
          game.revealed[idx] = true;
          io.to(room).emit("reveal-letter", {
            index: idx,
            letter: game.word[idx]
          });
        }
      }

      if (game.timeLeft <= 0) {
        clearInterval(game.timer);
        endRound(room, "time");
      }
    }, 1000);
  });


  /***********************
   * DRAWING (CANVAS SYNC)
   ***********************/
  socket.on("draw", (data) => {
    if (!socket.room) return;
    socket.to(socket.room).emit("draw", data);
  });

  /***********************
   * GUESSING
   ***********************/
  socket.on("guess", (text) => {
  const room = socket.room;
  const game = games[room];
  if (!game || !game.roundActive) return;

  // ❌ drawer cannot guess
  if (game.players[game.drawerIndex] === socket.id) return;

  if (!game.guessed) {
    game.guessed = new Set();
  }

  // ❌ already guessed
  if (game.guessed.has(socket.id)) return;

  if (text.toLowerCase() === game.word.toLowerCase()) {
    // mark guessed
    game.guessed.add(socket.id);

    const totalGuessers = game.players.length - 1;

    io.to(room).emit("guess-count", {
      guessed: game.guessed.size,
      total: totalGuessers
    });

    // ⏱ faster guess = higher score
    const score = Math.max(10, Math.floor(game.timeLeft * 2));

    game.scores[socket.id] += score;

    io.to(room).emit("system",
      `🎉 ${socket.username} guessed correctly (+${score})`
    );

    io.to(room).emit("score-update", game.scores);
    sendLeaderboard(room);

    if (game.guessed.size >= totalGuessers) {
      endRound(room);
    }
  }
});



  /***********************
   * DISCONNECT
   ***********************/
  socket.on("disconnect", () => {
    const room = socket.room;
    if (!room || !games[room]) return;

    games[room].players =
      games[room].players.filter(id => id !== socket.id);

    io.to(room).emit(
      "system",
      `💀 ${socket.username} left`
    );

    sendLeaderboard(room);
  });
});

/***********************
 * GAME ROUND ENGINE
 ***********************/
function startRound(room) {
  const game = games[room];
  if (!game || game.players.length < 2) return;

  // prepare round (word selection phase)
  game.roundActive = false;
  game.word = null;

  if (game.guessed) {
    game.guessed.clear();
  }

  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }

  const drawerSocketId = game.players[game.drawerIndex];

  // 🎲 Pick 3 random unique words (avoid repeats)
  const choices = getWordChoices(game, 3);

  // store temporarily
  game.wordChoices = choices;

  // send choices ONLY to drawer
  io.to(drawerSocketId).emit("choose-word", {
    words: choices
  });

  // notify others
  game.players.forEach(id => {
    if (id !== drawerSocketId) {
      io.to(id).emit("system", "✏️ Drawer is choosing a word...");
    }
  });
}

function endRound(room, reason) {
  const game = games[room];
  if (!game) return;

  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }

  game.roundActive = false;

  const message = reason === "time"
    ? `⏰ Time's up! The word was "${game.word}"`
    : `🟢 Round ended! Word was "${game.word}"`;

  io.to(room).emit("system", message);

  game.drawerIndex =
    (game.drawerIndex + 1) % game.players.length;

  setTimeout(() => startRound(room), 3000);
}

function getWordChoices(game, count) {
  if (!Array.isArray(game.wordPool) || game.wordPool.length < count) {
    game.wordPool = shuffleWords(words.slice());
  }

  if (game.wordPool.length < count) {
    const refill = shuffleWords(words.slice());
    game.wordPool = game.wordPool.concat(refill);
  }

  return game.wordPool.splice(0, count);
}

function shuffleWords(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function sendLeaderboard(room) {
  const game = games[room];
  if (!game) return;

  const leaderboard = game.players.map(id => ({
    id,
    name: io.sockets.sockets.get(id)?.username || "Unknown",
    score: game.scores[id] || 0
  }))
  .sort((a, b) => b.score - a.score);

  io.to(room).emit("leaderboard", leaderboard);
}

/***********************
 * STATIC + SERVER
 ***********************/
app.use(express.static(path.resolve("./public")));

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
