import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";

dotenv.config();


const GEMINI_KEY = process.env.GEMINI_KEY;

// Bot ki memory store karne ke liye object
const chatHistory = {};

const systemPrompt = `
Tumhara naam VedaBot hai.
Tum India ke travel aur tourism ke prashno ka jawab doge.iske alawa aur bhi question ka ans do 
aur har baar apna parichay mat do keval ek baar do
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
      console.clear();
      console.log("📌 Scan QR (60 sec valid)");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        console.log("❗ Session expire — QR dobara milega");
        startBot();
      } else {
        console.log("♻ Reconnecting...");
        startBot();
      }
    }

    if (connection === "open") console.log("✅ BOT CONNECTED SUCCESSFULLY");
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const remoteJid = m.key.remoteJid;
    const msg = m.message.conversation || m.message?.extendedTextMessage?.text || "";

    if (msg) {
      const query = msg.trim();

      // Agar is user ki pehle ki history nahi hai, toh empty array banao
      if (!chatHistory[remoteJid]) {
        chatHistory[remoteJid] = [{ role: "user", parts: [{ text: systemPrompt }] }];
      }

      // User ka naya message history mein add karo
      chatHistory[remoteJid].push({ role: "user", parts: [{ text: query }] });

      try {
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            contents: chatHistory[remoteJid] // Puri history bhej rahe hain
          }
        );

        const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text || "❗ No response";

        // Bot ka reply bhi history mein add karo taaki wo agle sawal mein yaad rahe
        chatHistory[remoteJid].push({ role: "model", parts: [{ text: reply }] });

        // History ko zyada bada hone se rokne ke liye (Last 10 messages tak limit)
        if (chatHistory[remoteJid].length > 10) {
          chatHistory[remoteJid].splice(1, 2); // Purani baatein delete karega (System prompt ko chhod kar)
        }

        await sock.sendMessage(remoteJid, { text: reply }, { quoted: m });

      } catch (e) {
        console.error("Gemini Error:", e.response?.data || e.message);
        await sock.sendMessage(remoteJid, {
          text: "Veda is sleeping..."
        });
      }
    }
  });
}

startBot();
