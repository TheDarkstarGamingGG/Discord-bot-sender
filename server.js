const ffmpegStatic = require('ffmpeg-static');
if (ffmpegStatic) process.env.FFMPEG_PATH = ffmpegStatic;

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { Client } = require('./src/index');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

let discordClient = null;
let clientReady = false;

let voiceState = {
  connection: null,
  channelId: null,
  channelName: null,
  playing: false,
  lastTempFile: null,
};

// --- Anti-detection helpers ---

// Sleep with optional random jitter
function sleep(ms, jitter = 0) {
  return new Promise(r => setTimeout(r, ms + Math.floor(Math.random() * jitter)));
}

// Simulate human typing before sending: triggers the typing indicator,
// then waits a time proportional to message length (like a real user would).
async function simulateTyping(channel, content) {
  try {
    await channel.sendTyping();
  } catch {}
  // ~55ms per character, minimum 800ms, maximum 4500ms, plus 150–500ms jitter
  const base = Math.min(Math.max(content.length * 55, 800), 4500);
  await sleep(base, 350);
}

// Per-channel cooldown: enforce minimum gap between sends to the same channel
const lastSendTime = new Map();
const MIN_SEND_GAP_MS = 1800;

async function enforceSendCooldown(channelId) {
  const now = Date.now();
  const last = lastSendTime.get(channelId) || 0;
  const gap = now - last;
  if (gap < MIN_SEND_GAP_MS) {
    await sleep(MIN_SEND_GAP_MS - gap, 300);
  }
  lastSendTime.set(channelId, Date.now());
}

// Small random read delay — prevents perfectly-timed API reads
function readDelay() {
  return sleep(200, 500);
}

// ---

function getClient() {
  return discordClient;
}

function cleanTempFile(filePath) {
  if (filePath) fs.unlink(filePath, () => {});
}

async function connectClient(token) {
  if (discordClient) {
    try { discordClient.destroy(); } catch {}
  }
  clientReady = false;
  voiceState = { connection: null, channelId: null, channelName: null, playing: false, lastTempFile: null };

  discordClient = new Client({
    checkUpdate: false,
    // Override presence: afk:true is the library default and looks suspicious
    presence: {
      status: 'online',
      since: null,
      afk: false,
      activities: [],
    },
    // ws/http defaults from Options.js already spoof Discord Client on Windows —
    // we leave those intact and only override the afk flag above
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Login timed out after 15 seconds'));
    }, 15000);

    discordClient.once('ready', () => {
      clearTimeout(timeout);
      clientReady = true;
      resolve(discordClient);
    });

    discordClient.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    discordClient.login(token).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ---- AUTH ----
app.post('/api/login', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });
  try {
    const client = await connectClient(token);
    const user = client.user;
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.displayAvatarURL({ format: 'png', size: 128 }),
        tag: user.tag,
      },
    });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Invalid token' });
  }
});

app.get('/api/status', (req, res) => {
  if (!discordClient || !clientReady) return res.json({ connected: false });
  const user = discordClient.user;
  res.json({
    connected: true,
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.displayAvatarURL({ format: 'png', size: 128 }),
      tag: user.tag,
    },
  });
});

app.post('/api/logout', (req, res) => {
  if (voiceState.connection) {
    try { voiceState.connection.disconnect(); } catch {}
  }
  if (discordClient) {
    try { discordClient.destroy(); } catch {}
    discordClient = null;
    clientReady = false;
  }
  voiceState = { connection: null, channelId: null, channelName: null, playing: false, lastTempFile: null };
  res.json({ success: true });
});

// ---- GUILDS ----
app.get('/api/guilds', (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });
  const guilds = client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL({ format: 'png', size: 64 }) || null,
    memberCount: g.memberCount,
  }));
  res.json(guilds);
});

app.get('/api/guilds/:guildId/channels', (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });

  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const channels = guild.channels.cache
    .filter((c) => {
      const t = c.type;
      const isText = t === 'GUILD_TEXT' || t === 'GUILD_ANNOUNCEMENT' || t === 0 || t === 5;
      const isVoice = t === 'GUILD_VOICE' || t === 2;
      return isText || isVoice;
    })
    .map((c) => {
      const isVoice = c.type === 'GUILD_VOICE' || c.type === 2;
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        isVoice,
        parentId: c.parentId || null,
        parentName: c.parent ? c.parent.name : null,
        position: c.rawPosition,
      };
    })
    .sort((a, b) => a.position - b.position);

  res.json(channels);
});

// ---- DMs ----
app.get('/api/dms', async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });
  try {
    const dms = client.channels.cache
      .filter((c) => c.type === 'DM' || c.type === 1)
      .map((c) => {
        const recipient = c.recipient;
        return {
          id: c.id,
          recipientId: recipient ? recipient.id : null,
          recipientName: recipient ? recipient.username : 'Unknown',
          recipientAvatar: recipient ? recipient.displayAvatarURL({ format: 'png', size: 64 }) : null,
        };
      });
    res.json(dms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- MESSAGES ----
app.get('/api/channels/:channelId/messages', async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });
  try {
    // Small random delay — reads don't happen at machine speed
    await readDelay();

    const channel = client.channels.cache.get(req.params.channelId)
      || await client.channels.fetch(req.params.channelId).catch(() => null);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const messages = await channel.messages.fetch({ limit: 50 });
    const result = messages.map((m) => ({
      id: m.id,
      content: m.content,
      author: {
        id: m.author.id,
        username: m.author.username,
        avatar: m.author.displayAvatarURL({ format: 'png', size: 64 }),
      },
      timestamp: m.createdTimestamp,
      attachments: m.attachments.map((a) => ({ url: a.url, name: a.name, contentType: a.contentType })),
      embeds: m.embeds.map((e) => ({ title: e.title, description: e.description, url: e.url })),
    })).reverse();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/channels/:channelId/send', async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Message content required' });
  try {
    const channel = client.channels.cache.get(req.params.channelId)
      || await client.channels.fetch(req.params.channelId).catch(() => null);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // Enforce minimum gap between sends to this channel
    await enforceSendCooldown(req.params.channelId);

    // Show typing indicator and wait proportional to message length
    await simulateTyping(channel, content);

    const sent = await channel.send(content);
    res.json({ success: true, messageId: sent.id, content: sent.content, timestamp: sent.createdTimestamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- USER SETTINGS ----
app.patch('/api/user/username', async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    await client.user.setUsername(username, password);
    res.json({ success: true, username: client.user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/user/avatar', async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected' });
  const { cdnUrl } = req.body;
  if (!cdnUrl) return res.status(400).json({ error: 'CDN URL required' });
  try {
    const response = await fetch(cdnUrl);
    if (!response.ok) throw new Error('Failed to fetch image from CDN URL');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/png';
    const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
    await client.user.setAvatar(base64);
    const newAvatar = client.user.displayAvatarURL({ format: 'png', size: 128 });
    res.json({ success: true, avatar: newAvatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- VOICE ----
app.get('/api/voice/status', (req, res) => {
  res.json({
    connected: !!voiceState.connection,
    channelId: voiceState.channelId,
    channelName: voiceState.channelName,
    playing: voiceState.playing,
  });
});

app.post('/api/voice/join', async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) return res.status(401).json({ error: 'Not connected to Discord' });
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId required' });
  try {
    const channel = client.channels.cache.get(channelId)
      || await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return res.status(404).json({ error: 'Voice channel not found' });

    // selfDeaf: true — natural behaviour, most users join deafened
    // selfMute: false — we need to be unmuted to play audio
    const connection = await client.voice.joinChannel(channel, { selfDeaf: true, selfMute: false });

    connection.on('disconnect', () => {
      if (voiceState.channelId === channelId) {
        voiceState = { connection: null, channelId: null, channelName: null, playing: false, lastTempFile: null };
      }
    });

    voiceState.connection = connection;
    voiceState.channelId = channelId;
    voiceState.channelName = channel.name;
    voiceState.playing = false;

    res.json({ success: true, channelName: channel.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/voice/leave', (req, res) => {
  if (voiceState.connection) {
    try {
      if (voiceState.connection.dispatcher) voiceState.connection.dispatcher.destroy();
      voiceState.connection.disconnect();
    } catch {}
  }
  cleanTempFile(voiceState.lastTempFile);
  voiceState = { connection: null, channelId: null, channelName: null, playing: false, lastTempFile: null };
  res.json({ success: true });
});

app.post('/api/voice/play', upload.single('audio'), async (req, res) => {
  const client = getClient();
  if (!client || !clientReady) {
    if (req.file) cleanTempFile(req.file.path);
    return res.status(401).json({ error: 'Not connected to Discord' });
  }
  if (!voiceState.connection) {
    if (req.file) cleanTempFile(req.file.path);
    return res.status(400).json({ error: 'Not in a voice channel. Join one first.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

  try {
    if (voiceState.connection.dispatcher) {
      try { voiceState.connection.dispatcher.destroy(); } catch {}
    }
    cleanTempFile(voiceState.lastTempFile);
    voiceState.lastTempFile = req.file.path;

    const dispatcher = voiceState.connection.playAudio(req.file.path, { type: 'unknown', volume: 1 });
    voiceState.playing = true;

    dispatcher.once('finish', () => {
      voiceState.playing = false;
      cleanTempFile(voiceState.lastTempFile);
      voiceState.lastTempFile = null;
    });

    dispatcher.once('error', (err) => {
      console.error('[VOICE PLAY ERROR]', err.message);
      voiceState.playing = false;
      cleanTempFile(voiceState.lastTempFile);
      voiceState.lastTempFile = null;
    });

    res.json({ success: true, filename: req.file.originalname });
  } catch (err) {
    cleanTempFile(req.file.path);
    voiceState.lastTempFile = null;
    voiceState.playing = false;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/voice/stop', (req, res) => {
  if (voiceState.connection?.dispatcher) {
    try { voiceState.connection.dispatcher.destroy(); } catch {}
  }
  voiceState.playing = false;
  cleanTempFile(voiceState.lastTempFile);
  voiceState.lastTempFile = null;
  res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
