<!-- .github/copilot-instructions.md
Purpose: Provide concise, project-specific guidance for AI coding agents
so they can be productive immediately in this repository. ~25-40 lines.
-->

# Project snapshot
- Simple Express + Socket.IO chat application.
- Server: `index.js` serves static files from `public/` and opens a Socket.IO server on port 9000.
- Frontend: single-page UI at `public/index.html` with styles in `public/style.css`.

# High-level architecture
- HTTP static server (Express) + real-time layer (Socket.IO) inside `index.js`.
- Frontend connects via `/socket.io/socket.io.js` and emits/receives these events:
  - `join` — payload: `{ identity, username, chatType, room }` (see join handling in `index.js`).
  - `message` — string payload; server relays to the user's current room.
  - `disconnect` — handled by server to broadcast leave messages for a room.

# What to know before editing
- The server assumes a `public/` directory with an SPA UI. Changing paths requires updating `app.use(express.static(...))` in `index.js`.
- Port: server listens on `9000` by default (see `index.js`). If you add a `start` script, keep that port in mind for tests.

# Important patterns & conventions (concrete)
- Identity handling: when `identity === "anonymous"` server generates `User<id>`; otherwise it uses `data.username` or `Guest`.
- Chat scope: `chatType === "room"` -> use `socket.join(room)` and `io.to(room).emit(...)`; otherwise fall back to a `global` room.
- UI contract: frontend expects DOM ids `joinBtn`, `message`, `sendbtn`, and a `messages` container — changing these requires updating `public/index.html` and client JS together.

# Dev, run, and debug
- No `start` script in `package.json`; run locally with:

  node index.js

- Open the app at: http://localhost:9000
- To add a proper script, add to `package.json`:

  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  }

# Integration points & dependencies
- Server dependencies in `package.json`: `express` and `socket.io`.
- Client uses the Socket.IO client served from the server at `/socket.io/socket.io.js`.

# Quick examples (use exact event names)
- Server-side join handler (in `index.js`): listen for `join` with payload described above.
- Client-side: emit `join` then emit `message` strings; server will namespace messages to `socket.room`.

# Editing guidance for agents
- Preserve existing public-facing socket event names (`join`, `message`) and room behavior unless you update both client and server.
- When adding features that change the client contract, update `public/index.html` + `index.js` in the same change set.
- Keep UI text decoding simple: server sends plain strings; client splits on `:` to separate username from message (see `public/index.html`).

# Files to inspect first
- [index.js](index.js)
- [package.json](package.json)
- [public/index.html](public/index.html)
- [public/style.css](public/style.css)

If anything in this file is unclear or you want examples expanded (tests, CI scripts, or a recommended `start` script), tell me which part to elaborate.
