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

/* 🔹 CONNECT TO MONGODB */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
      console.log("MongoDB connected");
  })
  .catch(err => {
      console.error("MongoDB error:", err);
  });

io.on("connection", (socket) => {

    // 🔹 USER JOINS
    socket.on("join", async (data) => {
        if (data.identity === "anonymous") {
            socket.username = `User${Math.floor(Math.random() * 1000)}`;
        } else {
            socket.username = data.username || "Guest";
        }

        socket.room =
            data.chatType === "room" && data.room
                ? data.room
                : "global";

        socket.join(socket.room);

        // 🔹 FETCH CHAT HISTORY
        const history = await Message
            .find({ room: socket.room })
            .sort({ createdAt: 1 })
            .limit(50);

        // 🔴 IMPORTANT: normalize _id → id
        const normalizedHistory = history.map(msg => ({
            id: msg._id.toString(),
            user: msg.user,
            text: msg.text,
            reactions: Object.fromEntries(msg.reactions),
        }));

        socket.emit("history", normalizedHistory);

        // 🔹 ANNOUNCE JOIN
        io.to(socket.room).emit(
            "system",
            `⚡ ${socket.username} joined`
        );
    });

    // 🔹 NEW MESSAGE
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

        // 🔴 SEND NORMALIZED MESSAGE
        io.to(socket.room).emit("message", {
            id: msg._id.toString(),
            user: msg.user,
            text: msg.text,
            reactions: Object.fromEntries(msg.reactions),
        });
    });

    // 🔹 REACTIONS
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
            reactions: Object.fromEntries(msg.reactions),
        });
    });

    // 🔹 TYPING
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

    // 🔹 DISCONNECT
    socket.on("disconnect", () => {
        if (socket.room) {
            io.to(socket.room).emit(
                "system",
                `💀 ${socket.username} left`
            );
        }
    });
});

app.use(express.static(path.resolve("./public")));

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
