import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const GEMINI_KEY = process.env.GEMINI_KEY;
const chatHistory = {};
let qrCodeUrl = ""; // QR code store karne ke liye variable

const systemPrompt = `
Tumhara naam VedaBot hai.
Tum India ke travel aur tourism ke prashno ka jawab doge. Iske alawa aur bhi question ka ans do.
Har baar apna parichay mat do, keval pehli baar do.
Hamesha short aur friendly style me jawaab doge.
Hindi aur thoda English mix me bolenge.
Pichli baaton ko yaad rakh kar jawab dena.
`;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./veda-session");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    version: [2, 3000, 1027934701],
    browser: ["Veda-Bot", "Chrome", "5.0"],
    syncFullHistory: false
  });

  sock.ev.on("connection.update", ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      console.log("📌 QR Received! Scan from the link below.");
      qrCodeUrl = qr; // QR Browser ke liye save ho raha hai
      qrcode.generate(qr, { small: true }); // Terminal backup
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        startBot();
      } else {
        startBot();
      }
    }

    if (connection === "open") {
      qrCodeUrl = ""; // Connect hone ke baad QR hata do
      console.log("✅ BOT CONNECTED SUCCESSFULLY");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const remoteJid = m.key.remoteJid;
    const msg = m.message.conversation || m.message?.extendedTextMessage?.text || "";

    if (msg) {
      const query = msg.trim();
      if (!chatHistory[remoteJid]) {
        chatHistory[remoteJid] = [{ role: "user", parts: [{ text: systemPrompt }] }];
      }
      chatHistory[remoteJid].push({ role: "user", parts: [{ text: query }] });

      try {
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          { contents: chatHistory[remoteJid] }
        );

        const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text || "❗ No response";
        chatHistory[remoteJid].push({ role: "model", parts: [{ text: reply }] });

        if (chatHistory[remoteJid].length > 10) chatHistory[remoteJid].splice(1, 2);

        await sock.sendMessage(remoteJid, { text: reply }, { quoted: m });
      } catch (e) {
        await sock.sendMessage(remoteJid, { text: "Veda is sleeping..." });
      }
    }
  });
}

// Render URL par QR dikhane ke liye Web Server
app.get("/", (req, res) => {
  if (qrCodeUrl) {
    res.send(`
      <body style="background:#111; color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
        <h1>VedaBot QR Code</h1>
        <div style="background:white; padding:20px; border-radius:10px;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}" />
        </div>
        <p style="margin-top:20px;">Scan this with WhatsApp Linked Devices</p>
        <script>setTimeout(() => { location.reload(); }, 20000);</script>
      </body>
    `);
  } else {
    res.send("<h1>VedaBot is Active & Connected ✅</h1>");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server started for QR rendering.");
  startBot();
});
