import { 
    makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    DisconnectReason,
    Browsers,
    downloadMediaMessage
} from 'todleys';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import P from 'pino';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const sessionDir = './sesion_web';

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let conn = null;
let activeSocket = null;

wss.on('connection', (ws) => {
    activeSocket = ws;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.action === 'start_pairing' && data.phone) {
                await initWhatsApp(data.phone);
            }
            
            if (!conn) return;

            if (data.action === 'get_profile_picture' && data.jid) {
                try {
                    const ppUrl = await conn.profilePictureUrl(data.jid, 'image').catch(() => null);
                    sendToClient({ event: 'profile_picture', jid: data.jid, url: ppUrl });
                } catch (e) {}
            }

            if (data.action === 'update_profile_status' && data.status) {
                await conn.updateProfileStatus(data.status);
                sendToClient({ event: 'profile_updated', type: 'status', value: data.status });
            }

            if (data.action === 'update_profile_name' && data.name) {
                await conn.updateProfileName(data.name);
                sendToClient({ event: 'profile_updated', type: 'name', value: data.name });
            }

            if (data.action === 'send_message' && data.to && data.text) {
                await conn.sendMessage(data.to, { text: data.text });
            }

            if (data.action === 'get_chats') {
                const chats = await conn.chats || [];
                sendToClient({ event: 'chats_list', chats });
            }

            if (data.action === 'get_channels') {
                try {
                    const channels = await conn.getNewsletterInfo || [];
                    sendToClient({ event: 'channels_list', channels });
                } catch (e) {}
            }

        } catch (err) {
            sendToClient({ event: 'error', message: 'Error en ejecucion de accion backend' });
        }
    });

    ws.on('close', () => {
        if (activeSocket === ws) activeSocket = null;
    });
});

function sendToClient(data) {
    if (activeSocket && activeSocket.readyState === activeSocket.OPEN) {
        activeSocket.send(JSON.stringify(data));
    }
}

async function initWhatsApp(phoneNumber) {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    conn = makeWASocket({
        version,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
        },
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: true,
        syncFullHistory: true,
        generateHighQualityLinkPreview: true,
        getMessage: async () => { return null }
    });

    conn.ev.on('creds.update', saveCreds);

    if (!conn.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let cleanedPhone = phoneNumber.replace(/[^0-9]/g, '');
                let code = await conn.requestPairingCode(cleanedPhone);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                sendToClient({ event: 'pairing_code', code });
            } catch (error) {
                sendToClient({ event: 'error', message: 'Error al generar codigo de vinculacion' });
            }
        }, 3000);
    }

    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                sendToClient({ event: 'status', state: 'logged_out' });
            } else {
                initWhatsApp(phoneNumber);
            }
        } else if (connection === 'open') {
            const myJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';
            const myPp = await conn.profilePictureUrl(myJid, 'image').catch(() => null);
            
            sendToClient({ 
                event: 'status', 
                state: 'connected', 
                user: {
                    ...conn.user,
                    jid: myJid,
                    ppUrl: myPp
                }
            });
        }
    });

    conn.ev.on('messages.upsert', async (chatUpdate) => {
        const m = chatUpdate.messages[0];
        if (!m || !m.message) return;
        if (m.key.remoteJid === 'status@broadcast') return;

        const messageTimestamp = (m.messageTimestamp?.low || m.messageTimestamp || Date.now()) * 1000;
        if ((Date.now() - messageTimestamp) > 180000) return;

        const sender = conn.decodeJid ? conn.decodeJid(m.key.participant || m.key.remoteJid) : (m.key.participant || m.key.remoteJid);
        const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';

        sendToClient({
            event: 'new_message',
            data: {
                id: m.key.id,
                chat: m.key.remoteJid,
                sender: sender,
                fromMe: m.key.fromMe,
                text: text,
                timestamp: messageTimestamp
            }
        });
    });

    conn.ev.on('groups.update', (update) => {
        sendToClient({ event: 'group_update', update });
    });
}

server.listen(PORT, () => {
    console.log(chalk.greenBright(`⚡ Servidor de Kazuma corriendo en http://localhost:${PORT}`));
});