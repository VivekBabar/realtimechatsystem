const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

// Store users: username -> websocket
let users = new Map();

function broadcastUserList() {
  const userList = Array.from(users.keys());
  const payload = JSON.stringify({
    type: "user_list",
    users: userList
  });
  users.forEach((wsClient) => {
    if (wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(payload);
    }
  });
}

wss.on("connection", (ws) => {
  console.log("User connected");

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      // User joins
      if (msg.type === "join") {
        let desiredName = msg.username ? msg.username.trim() : "Anonymous";
        if (desiredName === "") desiredName = "Anonymous";
        
        let finalName = desiredName;
        let counter = 1;
        while (users.has(finalName)) {
          finalName = `${desiredName}_${counter}`;
          counter++;
        }

        ws.username = finalName;
        users.set(finalName, ws);

        console.log(finalName + " joined");

        // Send confirm join to client
        ws.send(JSON.stringify({
          type: "join_response",
          success: true,
          username: finalName
        }));

        // Broadcast updated list to all
        broadcastUserList();
      }

      // Private message (text or audio voice note)
      if (msg.type === "private") {
        const sender = ws.username;
        if (!sender) return;

        const receiver = msg.to;
        const targetWs = users.get(receiver);
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (targetWs) {
          targetWs.send(JSON.stringify({
            type: "private",
            from: sender,
            text: msg.text,
            mediaType: msg.mediaType || "text",
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            timestamp: timestamp
          }));
        } else {
          ws.send(JSON.stringify({
            type: "private",
            from: "Server",
            text: `User "${receiver}" is not online ❌`,
            mediaType: "text",
            timestamp: timestamp
          }));
        }
      }

      // Typing status forwarding
      if (msg.type === "typing") {
        const sender = ws.username;
        if (!sender) return;

        const receiver = msg.to;
        const targetWs = users.get(receiver);

        if (targetWs) {
          targetWs.send(JSON.stringify({
            type: "typing",
            from: sender,
            isTyping: msg.isTyping
          }));
        }
      }
    } catch (err) {
      console.error("Error processing WS message:", err);
    }
  });

  ws.on("close", () => {
    if (ws.username) {
      users.delete(ws.username);
      console.log(ws.username + " disconnected");
      broadcastUserList();
    }
  });
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});