const AppState = {
    sessionId: localStorage.getItem('kazuma_session_id') || null,
    phone: localStorage.getItem('kazuma_phone') || null,
    currentChat: null,
    chats: [],
    contacts: [],
    groups: [],
    messages: {},
    ws: null,
    currentFilter: 'all'
};

document.addEventListener('DOMContentLoaded', async () => {
    initCodeInputs();
    await initApp();
});

async function initApp() {
    if (AppState.sessionId) {
        const isValid = await checkSession();
        if (isValid) {
            loadStateFromLocalStorage();
            showScreen('app-screen');
            loadUserProfile();
            renderChatsList();
            initWebSocket();
            const lastChatId = localStorage.getItem('kazuma_last_chat');
            if (lastChatId) {
                const chat = AppState.chats.find(c => c.id === lastChatId);
                if (chat) selectChat(chat);
            }
            return;
        } else {
            localStorage.clear();
            AppState.sessionId = null;
            AppState.phone = null;
        }
    }
    showScreen('login-screen');
    switchTab('login');
}

async function checkSession() {
    if (!AppState.sessionId) return false;
    try {
        const res = await fetch(`/api/auth/check?session_id=${AppState.sessionId}`);
        const data = await res.json();
        return data.success === true;
    } catch {
        return false;
    }
}

function loadStateFromLocalStorage() {
    const savedContacts = localStorage.getItem('kazuma_contacts');
    if (savedContacts) AppState.contacts = JSON.parse(savedContacts);
    const savedGroups = localStorage.getItem('kazuma_groups');
    if (savedGroups) AppState.groups = JSON.parse(savedGroups);
    rebuildChats();
}

function saveContactsToLocalStorage() {
    localStorage.setItem('kazuma_contacts', JSON.stringify(AppState.contacts));
}

function rebuildChats() {
    AppState.chats = [
        ...AppState.contacts.map(c => ({
            id: c.phone,
            name: c.name,
            phone: c.phone,
            type: 'private',
            lastMessage: '',
            unread: 0
        })),
        ...AppState.groups.map(g => ({
            id: g.id,
            name: g.name,
            type: 'group',
            members: g.members,
            lastMessage: '',
            unread: 0
        }))
    ];
    AppState.chats.sort((a,b) => a.name.localeCompare(b.name));
}

function initWebSocket() {
    if (!AppState.sessionId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    AppState.ws = new WebSocket(`${protocol}//${window.location.host}/ws?session_id=${AppState.sessionId}`);
    
    AppState.ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'new_message') {
                handleIncomingMessage(data.message, data.chat_id);
            }
        } catch (err) {
            console.error("Error procesando paquete WS:", err);
        }
    };

    AppState.ws.onclose = () => {
        setTimeout(() => {
            if (AppState.sessionId) initWebSocket();
        }, 3000);
    };
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function switchTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    document.getElementById('form-login-fields').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-register-fields').style.display = tab === 'register' ? 'block' : 'none';
}

function initCodeInputs() {
    const inputs = document.querySelectorAll('.code-digit');
    inputs.forEach((inp, idx) => {
        inp.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && idx < inputs.length - 1) {
                inputs[idx + 1].focus();
            }
        });
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && idx > 0) {
                inputs[idx - 1].focus();
            }
        });
    });
}

async function procesarLogin() {
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value;
    if (!phone || !password) return showToast('Completa las credenciales de acceso', 'error');
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        const data = await res.json();
        if (data.success) {
            AppState.sessionId = data.session_id;
            AppState.phone = data.phone;
            localStorage.setItem('kazuma_session_id', data.session_id);
            localStorage.setItem('kazuma_phone', data.phone);
            showScreen('app-screen');
            loadUserProfile();
            await loadContactsFromBackend();
            renderChatsList();
            initWebSocket();
            showToast('Conexion establecida con el nodo', 'success');
        } else {
            showToast(data.error || 'Credenciales incorrectas', 'error');
        }
    } catch (err) {
        showToast('Error de enlace con el servidor', 'error');
    }
}

async function procesarRegistro() {
    const pais = document.getElementById('reg-pais').value;
    const alias = document.getElementById('reg-alias').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!alias || !password) return showToast('Asigna un alias y contraseña de seguridad', 'error');
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pais, alias, password })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Numero asignado: ${data.phone}`, 'success');
            document.getElementById('login-phone').value = data.phone;
            switchTab('login');
        } else {
            showToast(data.error || 'Fallo al generar credenciales', 'error');
        }
    } catch (err) {
        showToast('Error de red al registrar', 'error');
    }
}

async function logout() {
    if (AppState.sessionId) {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: AppState.sessionId })
        });
    }
    if (AppState.ws) {
        AppState.ws.close();
    }
    AppState.sessionId = null;
    AppState.phone = null;
    localStorage.clear();
    showScreen('login-screen');
    showToast('Sesion destruida correctamente', 'success');
}

async function loadUserProfile() {
    if (!AppState.sessionId) return;
    try {
        const res = await fetch(`/api/profile?session_id=${AppState.sessionId}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('user-name').innerText = data.profile.alias || data.profile.phone;
            document.getElementById('settings-alias').value = data.profile.alias || '';
            document.getElementById('settings-bio').value = data.profile.bio || '';
        }
    } catch (err) { console.error(err); }
}

async function saveSettings() {
    const alias = document.getElementById('settings-alias').value.trim();
    const bio = document.getElementById('settings-bio').value.trim();
    try {
        const res = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: AppState.sessionId, alias, bio })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('user-name').innerText = alias || AppState.phone;
            closeModal('modal-settings');
            showToast('Configuracion aplicada al nodo', 'success');
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) { showToast('Error de transmision', 'error'); }
}

async function solicitarCodigoVinculacion() {
    try {
        const res = await fetch(`/api/device/pair-code?session_id=${AppState.sessionId}`);
        const data = await res.json();
        if (data.success) {
            const display = document.getElementById('pair-code-display');
            display.innerText = data.code;
            display.style.display = 'block';
            showToast('Codigo de enlace generado', 'success');
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) { showToast('Error al solicitar token', 'error'); }
}

async function autorizarDispositivoVinculado() {
    const code = document.getElementById('pair-code-input').value.trim();
    if (code.length !== 8) return showToast('El codigo debe ser de 8 digitos', 'error');
    try {
        const res = await fetch('/api/device/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: AppState.sessionId, code })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('pair-code-input').value = '';
            showToast('Terminal remoto autorizado con exito', 'success');
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) { showToast('Error de verificacion', 'error'); }
}

async function loadContactsFromBackend() {
    if (!AppState.sessionId) return;
    try {
        const res = await fetch(`/api/contacts?session_id=${AppState.sessionId}`);
        const data = await res.json();
        if (data.success) {
            AppState.contacts = data.contacts.map(c => ({ ...c, id: c.phone }));
            saveContactsToLocalStorage();
            rebuildChats();
            renderChatsList();
        }
    } catch (err) { console.error(err); }
}

function renderChatsList() {
    const container = document.getElementById('chats-list');
    container.innerHTML = '';
    let filtered = AppState.chats;
    if (AppState.currentFilter === 'private') filtered = filtered.filter(c => c.type === 'private');
    else if (AppState.currentFilter === 'groups') filtered = filtered.filter(c => c.type === 'group');
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:20px; font-size:12px;">Consola limpia. Sin canales activos.</div>';
        return;
    }
    filtered.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${AppState.currentChat?.id === chat.id ? 'active' : ''}`;
        div.onclick = () => selectChat(chat);
        const icon = chat.type === 'group' ? '<i class="fas fa-network-wired"></i>' : '<i class="fas fa-user-secret"></i>';
        const preview = chat.lastMessage ? (chat.lastMessage.length > 25 ? chat.lastMessage.slice(0,25)+'…' : chat.lastMessage) : 'Data stream vacio';
        div.innerHTML = `
            <div class="chat-avatar">${icon}</div>
            <div class="chat-info">
                <div class="chat-name">${escapeHtml(chat.name)}</div>
                <div class="chat-preview">${escapeHtml(preview)}</div>
            </div>
            ${chat.unread ? `<div class="unread-badge">${chat.unread}</div>` : ''}
        `;
        container.appendChild(div);
    });
}

function filterChats(filter) {
    AppState.currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-filter') === filter) btn.classList.add('active');
    });
    renderChatsList();
}

async function selectChat(chat) {
    if (!chat) return;
    AppState.currentChat = chat;
    localStorage.setItem('kazuma_last_chat', chat.id);
    renderChatsList();
    document.getElementById('current-chat-name').innerText = chat.name;
    document.getElementById('current-chat-status').innerText = chat.type === 'group' ? `${chat.members || 0} terminales` : 'Canal Abierto';
    const container = document.getElementById('messages-container');
    container.innerHTML = '<div class="empty-state">Descifrando historial de paquetes...</div>';
    await loadMessages(chat.id);
}

async function loadMessages(chatId) {
    if (!AppState.sessionId) return;
    try {
        const res = await fetch(`/api/messages/${chatId}?session_id=${AppState.sessionId}`);
        const data = await res.json();
        if (data.success) {
            AppState.messages[chatId] = data.messages;
            renderMessages(chatId);
        } else {
            document.getElementById('messages-container').innerHTML = '<div class="empty-state">Error de descompresion</div>';
        }
    } catch (err) {
        document.getElementById('messages-container').innerHTML = '<div class="empty-state">Fallo de conexion con el bloque</div>';
    }
}

function renderMessages(chatId) {
    const container = document.getElementById('messages-container');
    const msgs = AppState.messages[chatId] || [];
    if (msgs.length === 0) {
        container.innerHTML = '<div class="empty-state">No se registran transmisiones en este canal</div>';
        return;
    }
    container.innerHTML = '';
    msgs.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message-wrapper ${msg.is_me ? 'outgoing' : 'incoming'}`;
        div.innerHTML = `
            <div class="message-bubble">
                <div class="message-text">${escapeHtml(msg.body || (msg.file_name ? '📎 ' + msg.file_name : ''))}</div>
                <div class="message-meta">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            </div>
        `;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const body = input.value.trim();
    if (!body || !AppState.currentChat || !AppState.sessionId) return;
    input.value = '';
    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: AppState.sessionId,
                to: AppState.currentChat.id,
                body
            })
        });
        const data = await res.json();
        if (data.success) {
            const newMsg = {
                id: data.message_id,
                from: AppState.phone,
                to: AppState.currentChat.id,
                body: body,
                type: 'text',
                timestamp: new Date().toISOString(),
                is_me: true
            };
            if (!AppState.messages[AppState.currentChat.id]) AppState.messages[AppState.currentChat.id] = [];
            AppState.messages[AppState.currentChat.id].push(newMsg);
            renderMessages(AppState.currentChat.id);
            const chat = AppState.chats.find(c => c.id === AppState.currentChat.id);
            if (chat) chat.lastMessage = '>> ' + body;
            renderChatsList();
        } else {
            showToast(data.error || 'Inyeccion fallida', 'error');
            input.value = body;
        }
    } catch (err) {
        showToast('Perdida de paquetes en el envio', 'error');
        input.value = body;
    }
}

function handleIncomingMessage(msg, chatId) {
    if (!AppState.messages[chatId]) AppState.messages[chatId] = [];
    AppState.messages[chatId].push(msg);
    let chat = AppState.chats.find(c => c.id === chatId);
    if (!chat) {
        const newContact = {
            id: chatId,
            name: chatId,
            phone: chatId,
            type: 'private'
        };
        AppState.contacts.push(newContact);
        saveContactsToLocalStorage();
        rebuildChats();
        chat = AppState.chats.find(c => c.id === chatId);
    }
    if (chat) {
        chat.lastMessage = msg.body || (msg.file_name ? 'Payload' : 'Mensaje');
        if (AppState.currentChat?.id !== chatId) chat.unread = (chat.unread || 0) + 1;
        renderChatsList();
        if (AppState.currentChat?.id === chatId) {
            renderMessages(chatId);
        } else {
            showToast(`Entrada de datos de ${chat.name}`, 'info');
        }
    }
}

function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function openAddContact() { document.getElementById('modal-add-contact').classList.add('show'); }
async function addContact() {
    const name = document.getElementById('contact-name').value.trim();
    const phoneRaw = document.getElementById('contact-phone').value.trim();
    if (!name || !phoneRaw) return showToast('Faltan parametros de enlace', 'error');
    try {
        const res = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: AppState.sessionId, name, phone: phoneRaw })
        });
        const data = await res.json();
        if (data.success) {
            const newContact = { ...data.contact, id: data.contact.phone };
            AppState.contacts.push(newContact);
            saveContactsToLocalStorage();
            rebuildChats();
            renderChatsList();
            closeModal('modal-add-contact');
            document.getElementById('contact-name').value = '';
            document.getElementById('contact-phone').value = '';
            showToast('Destinatario acoplado', 'success');
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) { showToast('Fallo al sincronizar', 'error'); }
}

function toggleMoreOptions() {
    document.getElementById('more-options-menu').classList.toggle('show');
}

function selectFileType(type) {
    const fileInput = document.getElementById('file-input');
    if (type === 'image') fileInput.accept = 'image/*';
    else if (type === 'video') fileInput.accept = 'video/*';
    else if (type === 'document') fileInput.accept = '.pdf,.doc,.txt,.json,.sh,.js';
    else if (type === 'audio') fileInput.accept = 'audio/*';
    fileInput.click();
    document.getElementById('more-options-menu').classList.remove('show');
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !AppState.currentChat) return;
    showToast(`Inyectando payload ${file.name}...`, 'info');
    const formData = new FormData();
    formData.append('session_id', AppState.sessionId);
    formData.append('file', file);
    let fileType = 0;
    if (file.type.startsWith('image/')) fileType = 4;
    else if (file.type.startsWith('video/')) fileType = 3;
    else if (file.type.startsWith('audio/')) fileType = 2;
    formData.append('file_type', fileType);
    try {
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();
        if (uploadData.success) {
            const sendRes = await fetch('/api/messages/send-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: AppState.sessionId,
                    to: AppState.currentChat.id,
                    url: uploadData.url,
                    file_type: fileType,
                    file_name: file.name,
                    file_size: file.size,
                    caption: ''
                })
            });
            const sendData = await sendRes.json();
            if (sendData.success) {
                showToast('Payload transmitido', 'success');
                const newMsg = {
                    id: sendData.message_id,
                    from: AppState.phone,
                    to: AppState.currentChat.id,
                    url: uploadData.url,
                    file_name: file.name,
                    file_size: file.size,
                    type: 'file',
                    timestamp: new Date().toISOString(),
                    is_me: true
                };
                if (!AppState.messages[AppState.currentChat.id]) AppState.messages[AppState.currentChat.id] = [];
                AppState.messages[AppState.currentChat.id].push(newMsg);
                renderMessages(AppState.currentChat.id);
            } else showToast(sendData.error, 'error');
        } else showToast(uploadData.error, 'error');
    } catch (err) { showToast('Interrupcion en la subida', 'error'); }
    event.target.value = '';
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : (type === 'error' ? '⚠️' : 'ℹ️');
    toast.innerHTML = `<span style="margin-right:8px">${icon}</span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function toggleSettings() { document.getElementById('modal-settings').classList.add('show'); }
function toggleChatMenu() { showToast('Opciones de consola avanzadas', 'info'); }