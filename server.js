import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import axios from "axios";
import qrcode from "qrcode-terminal";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
// Hugging Face hamesha 7860 use karta hai
const PORT = process.env.PORT || 7860;
const GEMINI_KEY = process.env.GEMINI_KEY;
const chatHistory = {};
let qrCodeUrl = "";

const systemPrompt = `
Tumhara naam VedaBot hai.
Tum India ke travel aur tourism ke prashno ka jawab doge.
Hamesha short aur friendly style me jawaab doge.
Hindi aur thoda English mix me bolenge.
Pichli baaton ko yaad rakh kar jawab dena.
`;

async function startBot() {
    // Session folder ka path
    const { state, saveCreds } = await useMultiFileAuthState("./veda-session");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Hum browser par dekhenge
        version: [2, 3000, 1015901307],
        browser: ["Veda-Bot", "Chrome", "1.0.0"],
        syncFullHistory: false,
        connectTimeoutMs: 60000, // Network slow ho toh wait kare
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on("connection.update", ({ qr, connection, lastDisconnect }) => {
        if (qr) {
            console.log("📌 QR Received! Scan from the link below.");
            qrCodeUrl = qr;
            qrcode.generate(qr, { small: true }); // Terminal fallback
        }

        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed due to ", lastDisconnect?.error, ", reconnecting: ", shouldReconnect);
            
            // Loop se bachne ke liye 5 second ka delay
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
        }

        if (connection === "open") {
            qrCodeUrl = ""; 
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
                // Gemini 1.5-flash use karein, 2.5-flash abhi unstable ho sakta hai URL me
                const res = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
                    { contents: chatHistory[remoteJid] }
                );

                const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text || "❗ Maafi chahta hoon, main samajh nahi paaya.";
                chatHistory[remoteJid].push({ role: "model", parts: [{ text: reply }] });

                if (chatHistory[remoteJid].length > 10) chatHistory[remoteJid].splice(1, 2);

                await sock.sendMessage(remoteJid, { text: reply }, { quoted: m });
            } catch (e) {
                console.error("Gemini API Error:", e.message);
                // Agar history bohot badi ho jaye toh reset kar dein
                chatHistory[remoteJid] = [{ role: "user", parts: [{ text: systemPrompt }] }];
            }
        }
    });
}

// Web server for QR Display
app.get("/", (req, res) => {
    if (qrCodeUrl) {
        res.send(`
            <body style="background:#111; color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; text-align:center;">
                <h1 style="color:#25D366;">VedaBot: Scan QR</h1>
                <div style="background:white; padding:20px; border-radius:15px; box-shadow: 0 0 20px rgba(255,255,255,0.1);">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeUrl)}" />
                </div>
                <p style="margin-top:20px; font-size:1.2rem;">WhatsApp > Linked Devices > Link a Device</p>
                <script>setTimeout(() => { location.reload(); }, 25000);</script>
            </body>
        `);
    } else {
        res.send(`
            <body style="background:#111; color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
                <h1 style="color:#25D366;">VedaBot is Online ✅</h1>
                <p>Bot is connected and watching your messages.</p>
            </body>
        `);
    }
});

// Start the server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
    startBot();
});
