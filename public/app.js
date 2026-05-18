const api = {
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  },
  async patch(url, body) {
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  },
  async get(url) {
    const r = await fetch(url);
    return r.json();
  },
  async upload(url, formData) {
    const r = await fetch(url, { method: 'POST', body: formData });
    return r.json();
  },
};

const isMobile = () => window.innerWidth <= 700;
const $ = (id) => document.getElementById(id);

// ===================== THEME =====================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dr_theme', theme);
  const icon = theme === 'dark' ? '☀️' : '🌙';
  document.querySelectorAll('.theme-btn').forEach(b => b.textContent = icon);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
applyTheme(localStorage.getItem('dr_theme') || 'dark');
$('theme-toggle-login').addEventListener('click', toggleTheme);
$('theme-toggle-app').addEventListener('click', toggleTheme);

// ===================== STATE =====================
let state = {
  currentGuildId: null,
  currentChannelId: null,
  currentChannelName: null,
  currentChannelIsVoice: false,
  viewMode: 'servers',
  user: null,
  password: '',
};

let voiceFile = null;

// ===================== STORAGE =====================
const STORAGE = {
  getToken: () => localStorage.getItem('dr_token') || '',
  saveToken: (t) => localStorage.setItem('dr_token', t),
  clearToken: () => localStorage.removeItem('dr_token'),
  getPassword: () => localStorage.getItem('dr_password') || '',
  savePassword: (p) => localStorage.setItem('dr_password', p),
  clearPassword: () => localStorage.removeItem('dr_password'),
  getPresets: () => JSON.parse(localStorage.getItem('dr_presets') || '[]'),
  savePresets: (list) => localStorage.setItem('dr_presets', JSON.stringify(list)),
};

// ===================== LOGIN =====================
const savedToken = STORAGE.getToken();
const savedPassword = STORAGE.getPassword();
if (savedToken) { $('token-input').value = savedToken; $('save-token-cb').checked = true; }
if (savedPassword) { $('password-input').value = savedPassword; $('save-password-cb').checked = true; }

$('show-token-btn').addEventListener('click', () => {
  const inp = $('token-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
$('show-password-btn').addEventListener('click', () => {
  const inp = $('password-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
$('token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('password-input').focus(); });
$('password-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });

$('login-btn').addEventListener('click', async () => {
  const token = $('token-input').value.trim();
  const password = $('password-input').value;
  const errEl = $('login-error');
  const btn = $('login-btn');
  if (!token) { showErr(errEl, 'Please enter your token.'); return; }
  btn.textContent = 'Connecting...';
  btn.disabled = true;
  errEl.classList.add('hidden');
  const res = await api.post('/api/login', { token });
  if (res.success) {
    if ($('save-token-cb').checked) STORAGE.saveToken(token); else STORAGE.clearToken();
    if ($('save-password-cb').checked && password) STORAGE.savePassword(password); else STORAGE.clearPassword();
    state.user = res.user;
    state.password = password;
    enterApp();
  } else {
    showErr(errEl, res.error || 'Login failed. Check your token.');
    btn.textContent = 'Connect';
    btn.disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api.post('/api/logout', {});
  location.reload();
});

function showErr(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

// ===================== ENTER APP =====================
async function enterApp() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  setUserHeader(state.user);
  showPanel('servers');
  renderPresetList();
  await loadGuilds();
  updatePasswordHint();
}

function setUserHeader(user) {
  $('user-avatar').src = user.avatar;
  $('user-tag').textContent = user.username;
  $('settings-avatar').src = user.avatar;
}

function updatePasswordHint() {
  const hint = $('password-hint');
  const pwField = $('account-password-input');
  if (state.password) {
    hint.classList.remove('hidden');
    pwField.placeholder = 'Leave blank to use saved password...';
  } else {
    hint.classList.add('hidden');
    pwField.placeholder = 'Account password (required by Discord)...';
  }
}

function getEffectivePassword() {
  return $('account-password-input').value || state.password;
}

// ===================== MOBILE PANELS =====================
function showPanel(panel) {
  const app = $('app');
  app.classList.remove('panel-channels', 'panel-messages');
  if (panel === 'channels') app.classList.add('panel-channels');
  if (panel === 'messages') app.classList.add('panel-messages');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  if (panel === 'servers' || panel === 'channels') $('nav-servers').classList.add('active');
  if (panel === 'messages') $('nav-servers').classList.add('active');
}

$('back-to-servers').addEventListener('click', () => showPanel('servers'));
$('back-to-channels').addEventListener('click', () => showPanel('channels'));
$('nav-servers').addEventListener('click', () => showPanel('servers'));
$('nav-dms').addEventListener('click', () => {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  $('nav-dms').classList.add('active');
  triggerDMs();
});
$('nav-settings-mobile').addEventListener('click', openSettings);

// ===================== GUILDS =====================
async function loadGuilds() {
  const guilds = await api.get('/api/guilds');
  const list = $('guild-list');
  list.innerHTML = '';
  if (!guilds.length) { list.innerHTML = '<div class="loading">No servers found.</div>'; return; }
  guilds.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'guild-item';
    item.dataset.id = g.id;
    const initials = g.name.split(' ').map(w => w[0]).join('').slice(0, 2);
    const iconHtml = g.icon
      ? `<div class="guild-icon"><img src="${g.icon}" alt="" /></div>`
      : `<div class="guild-icon">${initials}</div>`;
    item.innerHTML = `${iconHtml}<span class="guild-name" title="${escHtml(g.name)}">${escHtml(g.name)}</span>`;
    item.addEventListener('click', () => selectGuild(g.id, g.name, item));
    list.appendChild(item);
  });
}

async function selectGuild(guildId, guildName, el) {
  document.querySelectorAll('.guild-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  state.currentGuildId = guildId;
  state.viewMode = 'guild';
  $('channel-sidebar-title').textContent = guildName;
  $('channel-list').innerHTML = '<div class="loading">Loading channels...</div>';
  if (isMobile()) showPanel('channels');
  const channels = await api.get(`/api/guilds/${guildId}/channels`);
  renderChannels(channels);
}

function renderChannels(channels) {
  const list = $('channel-list');
  list.innerHTML = '';
  if (!channels.length) { list.innerHTML = '<div class="loading">No channels found.</div>'; return; }

  const byCategory = {};
  channels.forEach(c => {
    const key = c.parentName || '__none';
    if (!byCategory[key]) byCategory[key] = [];
    byCategory[key].push(c);
  });

  Object.entries(byCategory).forEach(([cat, chans]) => {
    if (cat !== '__none') {
      const catEl = document.createElement('div');
      catEl.className = 'channel-category';
      catEl.textContent = cat;
      list.appendChild(catEl);
    }
    chans.forEach(c => {
      const item = document.createElement('div');
      if (c.isVoice) {
        item.className = 'channel-item voice-channel-item';
        item.dataset.id = c.id;
        item.innerHTML = `<span class="channel-hash voice-hash">🔊</span><span class="channel-name">${escHtml(c.name)}</span>`;
        item.addEventListener('click', () => selectVoiceChannel(c.id, c.name, item));
      } else {
        item.className = 'channel-item';
        item.dataset.id = c.id;
        item.innerHTML = `<span class="channel-hash">#</span><span class="channel-name">${escHtml(c.name)}</span>`;
        item.addEventListener('click', () => selectTextChannel(c.id, `#${c.name}`, item));
      }
      list.appendChild(item);
    });
  });
}

// ===================== DMs =====================
function triggerDMs() {
  document.querySelectorAll('.guild-item').forEach(i => i.classList.remove('active'));
  $('dm-btn').classList.add('active');
  state.viewMode = 'dms';
  state.currentGuildId = null;
  $('channel-sidebar-title').textContent = 'Direct Messages';
  if (isMobile()) showPanel('channels');
  renderDMList();
}
$('dm-btn').addEventListener('click', triggerDMs);

async function renderDMList() {
  const list = $('channel-list');
  list.innerHTML = '<div class="loading">Loading DMs...</div>';
  const dms = await api.get('/api/dms');
  list.innerHTML = '';
  if (!dms.length) { list.innerHTML = '<div class="loading">No open DMs found.</div>'; return; }
  dms.forEach(dm => {
    const item = document.createElement('div');
    item.className = 'dm-channel-item';
    item.dataset.id = dm.id;
    const name = dm.recipientName || 'Unknown';
    const avatarHtml = dm.recipientAvatar
      ? `<img class="dm-avatar" src="${dm.recipientAvatar}" alt="${escHtml(name)}" />`
      : `<div class="dm-avatar" style="font-size:13px;">${name[0]}</div>`;
    item.innerHTML = `${avatarHtml}<span class="dm-name">${escHtml(name)}</span>`;
    item.addEventListener('click', () => selectTextChannel(dm.id, name, item));
    list.appendChild(item);
  });
}

// ===================== TEXT CHANNEL =====================
function showTextView() {
  $('messages-area').classList.remove('hidden');
  $('text-input-area').classList.remove('hidden');
  $('voice-panel').classList.add('hidden');
  $('refresh-btn').classList.remove('hidden');
}

function showVoiceView() {
  $('messages-area').classList.add('hidden');
  $('text-input-area').classList.add('hidden');
  $('voice-panel').classList.remove('hidden');
  $('refresh-btn').classList.add('hidden');
}

async function selectTextChannel(channelId, channelName, el) {
  document.querySelectorAll('.channel-item, .dm-channel-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  state.currentChannelId = channelId;
  state.currentChannelName = channelName;
  state.currentChannelIsVoice = false;
  $('active-channel-name').textContent = channelName;
  $('message-input').placeholder = `Message ${channelName}`;
  $('message-input').disabled = false;
  $('send-btn').disabled = false;
  showTextView();
  if (isMobile()) showPanel('messages');
  await loadMessages(channelId);
}

// ===================== VOICE CHANNEL =====================
async function selectVoiceChannel(channelId, channelName, el) {
  document.querySelectorAll('.channel-item, .dm-channel-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  state.currentChannelId = channelId;
  state.currentChannelName = channelName;
  state.currentChannelIsVoice = true;
  $('active-channel-name').textContent = '🔊 ' + channelName;
  $('voice-card-name').textContent = channelName;
  showVoiceView();
  if (isMobile()) showPanel('messages');

  // Sync voice state from server
  const status = await api.get('/api/voice/status');
  if (status.connected && status.channelId === channelId) {
    setVoiceJoined(true);
  } else {
    setVoiceJoined(false);
  }
}

function setVoiceJoined(joined) {
  if (joined) {
    $('voice-not-joined').classList.add('hidden');
    $('voice-joined').classList.remove('hidden');
  } else {
    $('voice-not-joined').classList.remove('hidden');
    $('voice-joined').classList.add('hidden');
    setVoicePlaying(false);
    clearVoiceFile();
  }
}

function setVoicePlaying(playing) {
  if (playing) {
    $('voice-play-btn').classList.add('hidden');
    $('voice-stop-btn').classList.remove('hidden');
  } else {
    $('voice-stop-btn').classList.add('hidden');
    $('voice-play-btn').classList.remove('hidden');
  }
}

function clearVoiceFile() {
  voiceFile = null;
  $('voice-file-input').value = '';
  $('voice-file-row').classList.add('hidden');
  $('voice-upload-zone').classList.remove('hidden');
  $('voice-play-btn').disabled = true;
}

// Join voice
$('voice-join-btn').addEventListener('click', async () => {
  const btn = $('voice-join-btn');
  btn.textContent = 'Joining...';
  btn.disabled = true;
  const res = await api.post('/api/voice/join', { channelId: state.currentChannelId });
  btn.textContent = 'Join Voice Channel';
  btn.disabled = false;
  if (res.success) {
    setVoiceJoined(true);
    showVoiceStatusMsg('Connected to ' + res.channelName, 'ok');
  } else {
    showVoiceStatusMsg(res.error || 'Failed to join voice channel', 'err');
    $('voice-not-joined').classList.remove('hidden');
  }
});

// Leave voice
$('voice-leave-btn').addEventListener('click', async () => {
  await api.post('/api/voice/leave', {});
  setVoiceJoined(false);
  showVoiceStatusMsg('Disconnected', 'ok');
});

// File selection
$('voice-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  voiceFile = file;
  $('voice-file-label').textContent = file.name;
  $('voice-file-row').classList.remove('hidden');
  $('voice-upload-zone').classList.add('hidden');
  $('voice-play-btn').disabled = false;
});

$('voice-clear-file').addEventListener('click', clearVoiceFile);

// Play
$('voice-play-btn').addEventListener('click', async () => {
  if (!voiceFile) return;
  const btn = $('voice-play-btn');
  btn.textContent = 'Uploading...';
  btn.disabled = true;

  const formData = new FormData();
  formData.append('audio', voiceFile);

  const res = await api.upload('/api/voice/play', formData);
  btn.textContent = '▶ Play';

  if (res.success) {
    setVoicePlaying(true);
    showVoiceStatusMsg('Now playing: ' + (res.filename || voiceFile.name), 'ok');
  } else {
    btn.disabled = false;
    showVoiceStatusMsg(res.error || 'Failed to play audio', 'err');
  }
});

// Stop
$('voice-stop-btn').addEventListener('click', async () => {
  await api.post('/api/voice/stop', {});
  setVoicePlaying(false);
  showVoiceStatusMsg('Stopped', 'ok');
});

function showVoiceStatusMsg(text, type) {
  const el = $('voice-status-msg');
  el.textContent = text;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ===================== MESSAGES =====================
async function loadMessages(channelId) {
  const area = $('messages-area');
  area.innerHTML = '<div class="loading">Loading messages...</div>';
  const messages = await api.get(`/api/channels/${channelId}/messages`);
  if (messages.error) {
    area.innerHTML = `<div class="placeholder-text center">Could not load: ${escHtml(messages.error)}</div>`;
    return;
  }
  if (!messages.length) { area.innerHTML = '<div class="placeholder-text center">No messages yet.</div>'; return; }
  area.innerHTML = '';
  renderMessages(messages, area);
  area.scrollTop = area.scrollHeight;
}

function renderMessages(messages, container) {
  let lastAuthorId = null;
  messages.forEach(m => {
    const isOwn = state.user && m.author.id === state.user.id;
    const sameAuthor = m.author.id === lastAuthorId;
    lastAuthorId = m.author.id;
    const wrapper = document.createElement('div');
    if (!sameAuthor) {
      wrapper.className = 'message-item message-group' + (isOwn ? ' msg-own' : '');
      const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      wrapper.innerHTML = `
        <img class="msg-avatar" src="${m.author.avatar}" alt="" onerror="this.style.display='none'" />
        <div class="msg-body">
          <div class="message-header">
            <span class="msg-username">${escHtml(m.author.username)}</span>
            <span class="msg-time">${time}</span>
          </div>
          ${renderBody(m)}
        </div>`;
    } else {
      wrapper.className = 'message-item msg-indent';
      wrapper.innerHTML = renderBody(m);
    }
    container.appendChild(wrapper);
  });
}

function renderBody(m) {
  let html = '';
  if (m.content) html += `<div class="msg-content">${escHtml(m.content)}</div>`;
  m.attachments.forEach(a => {
    if (a.contentType && a.contentType.startsWith('image/')) {
      html += `<div class="msg-attachment"><img src="${a.url}" alt="${escHtml(a.name)}" loading="lazy" /></div>`;
    } else if (a.url) {
      html += `<div class="msg-attachment"><a href="${a.url}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(a.name)}</a></div>`;
    }
  });
  m.embeds.forEach(e => {
    if (e.title || e.description) {
      html += `<div class="msg-embed">${e.title ? `<div class="msg-embed-title">${escHtml(e.title)}</div>` : ''}${e.description ? `<div class="msg-embed-desc">${escHtml(e.description)}</div>` : ''}</div>`;
    }
  });
  return html;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================== SEND MESSAGE =====================
$('send-btn').addEventListener('click', sendMessage);
$('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isMobile()) { e.preventDefault(); sendMessage(); }
});
async function sendMessage() {
  const input = $('message-input');
  const content = input.value.trim();
  if (!content || !state.currentChannelId) return;
  $('send-btn').disabled = true;
  input.value = '';
  adjustTextarea(input);
  const res = await api.post(`/api/channels/${state.currentChannelId}/send`, { content });
  $('send-btn').disabled = false;
  if (res.success) await loadMessages(state.currentChannelId);
  else alert('Failed to send: ' + (res.error || 'Unknown error'));
}
$('message-input').addEventListener('input', function () { adjustTextarea(this); });
function adjustTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
$('refresh-btn').addEventListener('click', async () => {
  if (state.currentChannelId && !state.currentChannelIsVoice) await loadMessages(state.currentChannelId);
});

// ===================== SETTINGS =====================
function openSettings() {
  $('settings-modal').classList.remove('hidden');
  if (state.user) $('settings-avatar').src = state.user.avatar;
  updatePasswordHint();
  renderPresetList();
}
$('settings-btn').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
$('settings-backdrop').addEventListener('click', () => $('settings-modal').classList.add('hidden'));

$('change-avatar-btn').addEventListener('click', async () => {
  const url = $('avatar-url-input').value.trim();
  const msgEl = $('avatar-msg');
  if (!url) { showStatusMsg(msgEl, 'Please enter a CDN URL.', 'err'); return; }
  $('change-avatar-btn').textContent = 'Updating...';
  $('change-avatar-btn').disabled = true;
  const res = await api.patch('/api/user/avatar', { cdnUrl: url });
  $('change-avatar-btn').textContent = 'Update Avatar';
  $('change-avatar-btn').disabled = false;
  if (res.success) {
    showStatusMsg(msgEl, 'Avatar updated!', 'ok');
    const ts = '?t=' + Date.now();
    $('settings-avatar').src = res.avatar + ts;
    $('user-avatar').src = res.avatar + ts;
    if (state.user) state.user.avatar = res.avatar;
    $('avatar-url-input').value = '';
  } else {
    showStatusMsg(msgEl, res.error || 'Failed to update avatar.', 'err');
  }
});

$('change-username-btn').addEventListener('click', async () => {
  const username = $('new-username-input').value.trim();
  const password = getEffectivePassword();
  const msgEl = $('username-msg');
  if (!username) { showStatusMsg(msgEl, 'Please enter a username.', 'err'); return; }
  if (!password) { showStatusMsg(msgEl, 'Password is required by Discord to change username.', 'err'); return; }
  $('change-username-btn').textContent = 'Updating...';
  $('change-username-btn').disabled = true;
  const res = await api.patch('/api/user/username', { username, password });
  $('change-username-btn').textContent = 'Update Username';
  $('change-username-btn').disabled = false;
  if (res.success) {
    showStatusMsg(msgEl, 'Username updated!', 'ok');
    $('user-tag').textContent = res.username;
    if (state.user) state.user.username = res.username;
    $('new-username-input').value = '';
    $('account-password-input').value = '';
  } else {
    showStatusMsg(msgEl, res.error || 'Failed to update username.', 'err');
  }
});

function showStatusMsg(el, text, type) {
  el.textContent = text;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ===================== PRESETS =====================
function renderPresetList() {
  const presets = STORAGE.getPresets();
  const container = $('preset-list');
  if (!presets.length) {
    container.innerHTML = '<div class="no-presets">No presets saved yet. Fill in a username or avatar above, then save a preset.</div>';
    return;
  }
  container.innerHTML = '';
  presets.forEach((preset) => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    const avatarHtml = preset.avatarUrl
      ? `<img class="preset-avatar" src="${escHtml(preset.avatarUrl)}" alt="" onerror="this.style.display='none'" />`
      : `<div class="preset-avatar preset-avatar-placeholder">${(preset.username || preset.name || '?')[0].toUpperCase()}</div>`;
    card.innerHTML = `
      <div class="preset-info">
        ${avatarHtml}
        <div class="preset-text">
          <span class="preset-name">${escHtml(preset.name)}</span>
          ${preset.username ? `<span class="preset-detail">@${escHtml(preset.username)}</span>` : ''}
          ${preset.avatarUrl ? `<span class="preset-detail">Custom avatar</span>` : ''}
        </div>
      </div>
      <div class="preset-actions">
        <button class="btn-apply" data-id="${preset.id}">Apply</button>
        <button class="btn-delete-preset" data-id="${preset.id}" title="Delete">🗑</button>
      </div>`;
    card.querySelector('.btn-apply').addEventListener('click', () => applyPreset(preset));
    card.querySelector('.btn-delete-preset').addEventListener('click', () => deletePreset(preset.id));
    container.appendChild(card);
  });
}

$('save-preset-btn').addEventListener('click', () => {
  const name = $('preset-name-input').value.trim();
  const msgEl = $('preset-msg');
  if (!name) { showStatusMsg(msgEl, 'Enter a name for this preset.', 'err'); return; }
  const username = $('new-username-input').value.trim() || (state.user ? state.user.username : '');
  const avatarUrl = $('avatar-url-input').value.trim();
  if (!username && !avatarUrl) { showStatusMsg(msgEl, 'Enter a username or avatar URL to save.', 'err'); return; }
  const presets = STORAGE.getPresets();
  presets.push({ id: Date.now().toString(), name, username, avatarUrl });
  STORAGE.savePresets(presets);
  $('preset-name-input').value = '';
  showStatusMsg(msgEl, `Preset "${name}" saved!`, 'ok');
  renderPresetList();
});

async function applyPreset(preset) {
  const msgEl = $('preset-msg');
  const password = getEffectivePassword();
  let errors = [];
  showStatusMsg(msgEl, `Applying "${preset.name}"...`, 'ok');

  if (preset.avatarUrl) {
    const res = await api.patch('/api/user/avatar', { cdnUrl: preset.avatarUrl });
    if (res.success) {
      const ts = '?t=' + Date.now();
      $('settings-avatar').src = res.avatar + ts;
      $('user-avatar').src = res.avatar + ts;
      if (state.user) state.user.avatar = res.avatar;
    } else { errors.push('Avatar: ' + (res.error || 'failed')); }
  }

  if (preset.username && preset.username !== (state.user && state.user.username)) {
    if (!password) { errors.push('Username: password required'); }
    else {
      const res = await api.patch('/api/user/username', { username: preset.username, password });
      if (res.success) { $('user-tag').textContent = res.username; if (state.user) state.user.username = res.username; }
      else { errors.push('Username: ' + (res.error || 'failed')); }
    }
  }

  if (errors.length) showStatusMsg(msgEl, errors.join(' | '), 'err');
  else showStatusMsg(msgEl, `"${preset.name}" applied!`, 'ok');
}

function deletePreset(id) {
  STORAGE.savePresets(STORAGE.getPresets().filter(p => p.id !== id));
  renderPresetList();
}

// ===================== AUTO-RECONNECT =====================
(async () => {
  const status = await api.get('/api/status');
  if (status.connected) {
    state.user = status.user;
    state.password = STORAGE.getPassword();
    enterApp();
  }
})();
