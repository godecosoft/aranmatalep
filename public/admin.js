let allRequests = [];
let currentFilter = 'boşta';
let isAuthenticated = false;
let currentUsername = '';
let currentUserRole = '';
let searchQuery = '';
let previousRequestIds = new Set();
let newRequestIds = new Set();
let selectedRequests = new Set();
let trafficChart = null;

function checkAuth() {
    const token = sessionStorage.getItem('adminToken');
    const username = sessionStorage.getItem('adminUsername');
    const role = sessionStorage.getItem('adminRole');
    if (token && username) {
        isAuthenticated = true;
        currentUsername = username;
        currentUserRole = role;
        document.getElementById('loginSection').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
        if (role === 'admin') {
            document.querySelectorAll('[data-section="users"]').forEach(el => el.classList.remove('hidden'));
        }
        loadRequests();
    } else {
        isAuthenticated = false;
        document.getElementById('loginSection').classList.remove('hidden');
        document.getElementById('adminPanel').classList.add('hidden');
    }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');

    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            sessionStorage.setItem('adminToken', data.token);
            sessionStorage.setItem('adminUsername', username);
            sessionStorage.setItem('adminRole', data.role);
            currentUsername = username;
            currentUserRole = data.role;
            isAuthenticated = true;
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('adminPanel').classList.remove('hidden');
            if (data.role === 'admin') {
                document.querySelectorAll('[data-section="users"]').forEach(el => el.classList.remove('hidden'));
            }
            loadRequests();
            errorDiv.classList.add('hidden');
        } else {
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        errorDiv.classList.remove('hidden');
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminUsername');
    sessionStorage.removeItem('adminRole');
    currentUsername = '';
    currentUserRole = '';
    isAuthenticated = false;
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('adminPanel').classList.add('hidden');
});

function switchSection(sectionName) {
    document.querySelectorAll('.section-content').forEach(section => {
        section.classList.add('hidden');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.style.background = '';
        item.style.boxShadow = '';
        item.classList.remove('text-slate-900', 'font-semibold');
        item.classList.add('text-slate-400', 'font-medium', 'hover:bg-slate-800/60');
    });

    const targetSection = document.getElementById(sectionName + 'Section');
    if (targetSection) {
        targetSection.classList.remove('hidden');
        targetSection.classList.add('slide-up');
    }

    const activeNavItem = document.querySelector(`[data-section="${sectionName}"]`);
    if (activeNavItem) {
        activeNavItem.style.background = 'var(--accent-gradient)';
        activeNavItem.style.boxShadow = '0 2px 12px rgba(67, 234, 128, 0.25)';
        activeNavItem.classList.add('text-slate-900', 'font-semibold');
        activeNavItem.classList.remove('text-slate-400', 'font-medium', 'hover:bg-slate-800/60');
    }

    if (sectionName === 'users') {
        loadUsers();
    } else if (sectionName === 'reports') {
        loadReports();
    } else if (sectionName === 'audit') {
        loadAuditLogs();
    }
}

async function loadRequests() {
    if (!isAuthenticated) return;

    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/requests', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            sessionStorage.removeItem('adminToken');
            checkAuth();
            return;
        }

        const newData = await response.json();

        const currentRequestIds = new Set(newData.map(r => r.id));
        const hasNewRequests = newData.some(r => !previousRequestIds.has(r.id));

        if (hasNewRequests && previousRequestIds.size > 0) {
            newRequestIds.clear();
            newData.forEach(r => {
                if (!previousRequestIds.has(r.id)) {
                    newRequestIds.add(r.id);
                }
            });

            playNotificationSound();
        }

        previousRequestIds = currentRequestIds;
        allRequests = newData;
        updateStats();
        displayRequests();
        updateTrafficChart();
        loadOperatorLeaderboard();
    } catch (error) {
        document.getElementById('requestsContainer').innerHTML =
            '<div class="bg-slate-800 rounded-lg border border-red-500 shadow-xl p-8 text-center text-red-400">Veriler yüklenemedi</div>';
    }
}

function playNotificationSound() {
    try {
        const audio = document.getElementById('notificationSound');
        if (audio) {
            audio.currentTime = 0;
            audio.volume = 0.5;
            audio.play().catch(e => console.log('Audio play failed:', e));
        }
    } catch (error) {
        console.log('Notification sound error:', error);
    }
}

function updateStats() {
    const stats = {
        boşta: 0,
        işlemde: 0,
        arandı: 0,
        ulaşılamadı: 0,
        toplam: allRequests.length
    };

    allRequests.forEach(req => {
        if (stats.hasOwnProperty(req.status)) {
            stats[req.status]++;
        }
    });

    document.getElementById('statBosta').textContent = stats.boşta;
    document.getElementById('statIslemde').textContent = stats.işlemde;
    document.getElementById('statArandi').textContent = stats.arandı + stats.ulaşılamadı;
    document.getElementById('statToplam').textContent = stats.toplam;
}

document.getElementById('searchInput')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    displayRequests();
});

function displayRequests() {
    const container = document.getElementById('requestsContainer');
    if (!container) return;

    let filteredRequests = allRequests;
    if (currentFilter !== 'all') {
        filteredRequests = allRequests.filter(req => req.status === currentFilter);
    }

    if (searchQuery) {
        filteredRequests = filteredRequests.filter(req =>
            req.name.toLowerCase().includes(searchQuery) ||
            req.phone.toLowerCase().includes(searchQuery) ||
            (req.username && req.username.toLowerCase().includes(searchQuery))
        );
    }

    if (filteredRequests.length === 0) {
        container.innerHTML = '<div class="bg-slate-800 rounded-lg border border-slate-700 shadow-xl p-8 text-center text-slate-400">Henüz talep bulunmuyor</div>';
        return;
    }

    const statusColors = {
        'boşta': 'border-l-amber-500',
        'işlemde': 'border-l-blue-500',
        'arandı': 'border-l-emerald-500',
        'ulaşılamadı': 'border-l-red-500'
    };

    const statusBadges = {
        'boşta': 'bg-amber-500/20 text-amber-300',
        'işlemde': 'bg-blue-500/20 text-blue-300',
        'arandı': 'bg-emerald-500/20 text-emerald-300',
        'ulaşılamadı': 'bg-red-500/20 text-red-300'
    };

    container.innerHTML = `
        <div class="flex items-center gap-2 mb-4 px-2">
            <input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)" class="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/30">
            <label for="selectAllCheckbox" class="text-xs text-slate-400 font-medium cursor-pointer">Tümünü Seç</label>
        </div>
        ${filteredRequests.map(req => `
            <div class="glass-card rounded-lg border-l-4 ${statusColors[req.status]} ${newRequestIds.has(req.id) ? 'new-request-blink' : ''} mb-4" data-request-id="${req.id}">
                <div class="p-3">
                    <div class="flex gap-3">
                        <div class="mt-1">
                            <input type="checkbox" onchange="toggleRequestSelection(${req.id}, this.checked)" ${selectedRequests.has(req.id) ? 'checked' : ''} class="request-checkbox w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/30">
                        </div>
                        <div class="flex-1">
                            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-2">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <h3 class="text-sm font-semibold text-white">${req.name}</h3>
                                    <span class="px-2 py-0.5 text-xs font-medium rounded-full uppercase ${statusBadges[req.status]}">${req.status}</span>
                                </div>
                                <div class="flex gap-1 flex-wrap">
                                    ${req.status === 'boşta' ? `
                                        <button onclick="takeRequest(${req.id})" class="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition">
                                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M9 11l3 3L22 4"/>
                                                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                                            </svg>
                                            Üstüne Al
                                        </button>
                                    ` : ''}
                                    ${req.status === 'işlemde' ? `
                                        <button onclick="completeRequest(${req.id}, 'arandı')" class="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded transition">
                                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <polyline points="20 6 9 17 4 12"/>
                                            </svg>
                                            Arandı
                                        </button>
                                        <button onclick="openReasonModal(${req.id})" class="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded transition">
                                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"/>
                                            </svg>
                                            Ulaşılamadı
                                        </button>
                                    ` : ''}
                                    <button onclick="openNotesModal(${req.id})" class="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded transition" title="Not Ekle">
                                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                    </button>
                                    <button onclick="deleteRequest(${req.id})" class="inline-flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded transition">
                                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300 mt-2">
                                ${req.username ? `
                                    <div class="flex items-center gap-1">
                                        <svg class="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                        </svg>
                                        <span class="truncate">${req.username}</span>
                                    </div>
                                ` : ''}
                                <div class="flex items-center gap-1">
                                    <svg class="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                                    </svg>
                                    <span class="font-medium text-white">${req.phone}</span>
                                </div>
                                ${req.assigned_to ? `
                                    <div class="flex items-center gap-1">
                                        <svg class="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                        <span class="truncate">Atanan: <span class="font-medium text-white">${req.assigned_to}</span></span>
                                    </div>
                                ` : ''}
                                <div class="flex items-center gap-1">
                                    <svg class="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="M12 6v6l4 2"/>
                                    </svg>
                                    <span class="text-slate-500 truncate">${formatDate(req.created_at)}</span>
                                </div>
                            </div>
                            ${req.message ? `
                                <div class="flex items-start gap-1 bg-slate-900/50 p-1.5 rounded mt-2 text-xs">
                                    <svg class="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                    </svg>
                                    <span class="flex-1 text-slate-300">${req.message}</span>
                                </div>
                            ` : ''}
                            ${req.reason ? `
                                <div class="flex items-start gap-1 bg-red-500/10 border border-red-500/30 p-1.5 rounded mt-2 text-xs">
                                    <svg class="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="12" y1="8" x2="12" y2="12"/>
                                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                                    </svg>
                                    <div class="flex-1">
                                        <div class="text-red-400 font-medium">Ulaşılamadı:</div>
                                        <span class="text-red-300">${req.reason}</span>
                                    </div>
                                </div>
                            ` : ''}
                            <div id="notes-${req.id}" class="notes-container mt-2 pt-2 border-t border-slate-700/50"></div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('')}
    `;

    filteredRequests.forEach(req => {
        loadNotesInline(req.id);
    });

    setTimeout(() => {
        newRequestIds.clear();
    }, 1500);
}

async function loadNotesInline(requestId) {
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch(`/api/requests/${requestId}/notes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return;

        const notes = await response.json();
        const container = document.getElementById(`notes-${requestId}`);

        if (!container) return;

        if (notes.length === 0) {
            container.innerHTML = '';
            return;
        }

        const notesHtml = `
            <div class="text-xs text-purple-400 font-semibold mb-1.5 flex items-center gap-1">
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Notlar (${notes.length})
            </div>
            <div class="space-y-1">
                ${notes.slice(0, 2).map(note => `
                    <div class="bg-purple-500/10 border border-purple-500/20 rounded p-1.5">
                        <div class="flex justify-between items-center mb-0.5">
                            <span class="text-xs text-purple-300 font-medium">${note.created_by}</span>
                            <span class="text-xs text-slate-500">${new Date(note.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}</span>
                        </div>
                        <p class="text-xs text-slate-300 leading-tight">${note.note}</p>
                    </div>
                `).join('')}
                ${notes.length > 2 ? `
                    <button onclick="openNotesModal(${requestId})" class="text-xs text-purple-400 hover:text-purple-300 font-medium">+${notes.length - 2} not daha göster...</button>
                ` : ''}
            </div>
        `;

        container.innerHTML = notesHtml;
    } catch (error) {
        console.error('Load inline notes error:', error);
    }
}

async function takeRequest(id) {
    console.log('takeRequest called with id:', id);
    console.log('currentUsername:', currentUsername);

    if (!currentUsername) {
        showCustomAlert('Kullanıcı adı bulunamadı. Lütfen yeniden giriş yapın.');
        return;
    }

    try {
        const token = sessionStorage.getItem('adminToken');
        console.log('Token exists:', !!token);

        const response = await fetch(`/api/requests/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: 'işlemde', assigned_to: currentUsername })
        });

        console.log('Response status:', response.status);

        if (response.ok) {
            showCustomAlert('Talep üzerinize alındı');
            loadRequests();
        } else {
            const errorData = await response.json();
            console.error('Update failed:', errorData);
            showCustomAlert('Talep güncellenemedi: ' + (errorData.error || 'Bilinmeyen hata'));
        }
    } catch (error) {
        console.error('takeRequest error:', error);
        showCustomAlert('Bir hata oluştu: ' + error.message);
    }
}

async function completeRequest(id, status) {
    try {
        const token = sessionStorage.getItem('adminToken');
        await fetch(`/api/requests/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: status })
        });
        loadRequests();
    } catch (error) {
        showCustomAlert('Bir hata oluştu');
    }
}

function openReasonModal(id) {
    document.getElementById('modalRequestId').value = id;
    document.getElementById('reasonModal').classList.remove('hidden');
    document.getElementById('reasonInput').focus();
}

function closeReasonModal() {
    document.getElementById('reasonModal').classList.add('hidden');
    document.getElementById('reasonInput').value = '';
}

async function submitReason() {
    const id = document.getElementById('modalRequestId').value;
    const reason = document.getElementById('reasonInput').value.trim();

    if (!reason) {
        showCustomAlert('Lütfen bir neden belirtin');
        return;
    }

    try {
        const token = sessionStorage.getItem('adminToken');
        await fetch(`/api/requests/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: 'ulaşılamadı', reason: reason })
        });
        closeReasonModal();
        loadRequests();
    } catch (error) {
        showCustomAlert('Bir hata oluştu');
    }
}

function showCustomAlert(message) {
    const alertDiv = document.getElementById('customAlert');
    const alertMessage = document.getElementById('alertMessage');
    alertMessage.textContent = message;
    alertDiv.classList.remove('hidden');
}

function closeCustomAlert() {
    document.getElementById('customAlert').classList.add('hidden');
}

async function deleteRequest(id) {
    if (!confirm('Bu talebi silmek istediğinize emin misiniz?')) {
        return;
    }

    try {
        await fetch(`/api/requests/${id}`, {
            method: 'DELETE'
        });
        loadRequests();
    } catch (error) {
        alert('Bir hata oluştu');
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Az önce';
    if (minutes < 60) return `${minutes} dakika önce`;
    if (hours < 24) return `${hours} saat önce`;
    if (days < 7) return `${days} gün önce`;

    return date.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.style.background = '';
            b.style.boxShadow = '';
            b.classList.remove('text-slate-900');
            b.classList.add('bg-slate-800/60', 'text-slate-400', 'border', 'border-slate-700/50', 'hover:bg-slate-700/60', 'hover:text-white');
        });
        btn.style.background = 'var(--accent-gradient)';
        btn.style.boxShadow = '0 2px 8px rgba(67, 234, 128, 0.2)';
        btn.classList.remove('bg-slate-800/60', 'text-slate-400', 'border', 'border-slate-700/50', 'hover:bg-slate-700/60', 'hover:text-white');
        btn.classList.add('text-slate-900');
        currentFilter = btn.dataset.filter;
        displayRequests();
    });
});

async function loadUsers() {
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            showCustomAlert('Kullanıcılar yüklenemedi');
            return;
        }

        const users = await response.json();
        displayUsers(users);
    } catch (error) {
        showCustomAlert('Bir hata oluştu');
    }
}

function displayUsers(users) {
    const container = document.getElementById('usersList');

    if (users.length === 0) {
        container.innerHTML = '<div class="bg-slate-800 rounded-lg border border-slate-700 shadow-xl p-8 text-center text-slate-400">Henüz kullanıcı yok</div>';
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="bg-slate-800 rounded-lg border border-slate-700 shadow-xl p-4 flex items-center justify-between">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-semibold">
                    ${user.username[0].toUpperCase()}
                </div>
                <div>
                    <div class="text-white font-medium">${user.username}</div>
                    <div class="text-xs text-slate-400">${user.role === 'admin' ? 'Admin' : 'Kullanıcı'}</div>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="editUser(${user.id}, '${user.username}', '${user.role}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition">
                    Düzenle
                </button>
                <button onclick="deleteUser(${user.id})" class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md transition">
                    Sil
                </button>
            </div>
        </div>
    `).join('');
}

function openCreateUserModal() {
    document.getElementById('userFormTitle').textContent = 'Yeni Kullanıcı';
    document.getElementById('editUserId').value = '';
    document.getElementById('userUsername').value = '';
    document.getElementById('userPassword').value = '';
    document.getElementById('userPassword').required = true;
    document.getElementById('passwordOptional').classList.add('hidden');
    document.getElementById('userRole').value = 'user';
    document.getElementById('userFormModal').classList.remove('hidden');
}

function editUser(id, username, role) {
    document.getElementById('userFormTitle').textContent = 'Kullanıcıyı Düzenle';
    document.getElementById('editUserId').value = id;
    document.getElementById('userUsername').value = username;
    document.getElementById('userPassword').value = '';
    document.getElementById('userPassword').required = false;
    document.getElementById('passwordOptional').classList.remove('hidden');
    document.getElementById('userRole').value = role;
    document.getElementById('userFormModal').classList.remove('hidden');
}

function closeUserFormModal() {
    document.getElementById('userFormModal').classList.add('hidden');
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const userId = document.getElementById('editUserId').value;
    const username = document.getElementById('userUsername').value;
    const password = document.getElementById('userPassword').value;
    const role = document.getElementById('userRole').value;

    const token = sessionStorage.getItem('adminToken');
    const url = userId ? `/api/users/${userId}` : '/api/users';
    const method = userId ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ username, password, role })
        });

        if (response.ok) {
            closeUserFormModal();
            loadUsers();
            showCustomAlert('Kullanıcı kaydedildi');
        } else {
            const data = await response.json();
            showCustomAlert(data.error || 'Bir hata oluştu');
        }
    } catch (error) {
        showCustomAlert('Bir hata oluştu');
    }
});

async function deleteUser(id) {
    if (!confirm('Bu kullanıcıyı silmek istediğinize emin misiniz?')) {
        return;
    }

    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch(`/api/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            loadUsers();
            showCustomAlert('Kullanıcı silindi');
        } else {
            const data = await response.json();
            showCustomAlert(data.error || 'Kullanıcı silinemedi');
        }
    } catch (error) {
        showCustomAlert('Bir hata oluştu');
    }
}

function openNotesModal(requestId) {
    document.getElementById('noteRequestId').value = requestId;
    document.getElementById('noteInput').value = '';
    loadNotes(requestId);
    document.getElementById('notesModal').classList.remove('hidden');
}

function closeNotesModal() {
    document.getElementById('notesModal').classList.add('hidden');
}

async function loadNotes(requestId) {
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch(`/api/requests/${requestId}/notes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            document.getElementById('notesList').innerHTML = '<div class="text-sm text-slate-400">Notlar yüklenemedi</div>';
            return;
        }

        const notes = await response.json();

        if (notes.length === 0) {
            document.getElementById('notesList').innerHTML = '<div class="text-sm text-slate-400 text-center py-4">Henüz not eklenmemiş</div>';
            return;
        }

        const notesHtml = notes.map(note => `
            <div class="bg-slate-900 rounded-lg p-3 border border-slate-700">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-xs text-emerald-400 font-medium">${note.created_by}</span>
                    <span class="text-xs text-slate-500">${formatDate(note.created_at)}</span>
                </div>
                <p class="text-sm text-slate-300">${note.note}</p>
            </div>
        `).join('');

        document.getElementById('notesList').innerHTML = notesHtml;
    } catch (error) {
        document.getElementById('notesList').innerHTML = '<div class="text-sm text-slate-400">Notlar yüklenemedi</div>';
    }
}

async function saveNote() {
    const requestId = document.getElementById('noteRequestId').value;
    const note = document.getElementById('noteInput').value.trim();

    if (!note) {
        showCustomAlert('Lütfen bir not yazın');
        return;
    }

    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch(`/api/requests/${requestId}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ note })
        });

        if (response.ok) {
            document.getElementById('noteInput').value = '';
            loadNotes(requestId);
            loadNotesInline(requestId);
        } else {
            showCustomAlert('Not kaydedilemedi');
        }
    } catch (error) {
        showCustomAlert('Bir hata oluştu');
    }
}

async function loadReports() {
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/requests', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return;

        const requests = await response.json();

        const total = requests.length;
        const completed = requests.filter(r => r.status === 'arandı').length;
        const unreachable = requests.filter(r => r.status === 'ulaşılamadı').length;
        const active = requests.filter(r => r.status === 'işlemde').length;
        const pending = requests.filter(r => r.status === 'boşta').length;

        const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        document.getElementById('reportTotalRequests').textContent = total;
        document.getElementById('reportCompletedRequests').textContent = completed;
        document.getElementById('reportActiveRequests').textContent = active + pending;
        document.getElementById('reportUnreachable').textContent = unreachable;
        document.getElementById('reportSuccessRate').textContent = successRate + '%';

        const userStats = {};
        requests.forEach(req => {
            if (req.assigned_to) {
                if (!userStats[req.assigned_to]) {
                    userStats[req.assigned_to] = { total: 0, completed: 0 };
                }
                userStats[req.assigned_to].total++;
                if (req.status === 'arandı') {
                    userStats[req.assigned_to].completed++;
                }
            }
        });

        const userPerformanceHtml = Object.entries(userStats)
            .sort((a, b) => b[1].completed - a[1].completed)
            .slice(0, 5)
            .map(([username, stats]) => `
                <div class="flex justify-between items-center text-sm">
                    <span class="text-slate-300">${username}</span>
                    <span class="text-emerald-400">${stats.completed}/${stats.total}</span>
                </div>
            `).join('');

        document.getElementById('reportUserPerformance').innerHTML = userPerformanceHtml || '<div class="text-sm text-slate-400">Veri yok</div>';

        const recentRequests = requests.slice(0, 5);
        const recentHtml = recentRequests.map(req => `
            <div class="flex justify-between items-center p-3 bg-slate-700 rounded-lg">
                <div>
                    <div class="text-white font-medium">${req.name}</div>
                    <div class="text-xs text-slate-400">${req.phone}</div>
                </div>
                <span class="px-2 py-1 text-xs rounded-full ${req.status === 'arandı' ? 'bg-emerald-500/20 text-emerald-300' :
                req.status === 'işlemde' ? 'bg-blue-500/20 text-blue-300' :
                    req.status === 'ulaşılamadı' ? 'bg-red-500/20 text-red-300' :
                        'bg-amber-500/20 text-amber-300'
            }">${req.status}</span>
            </div>
        `).join('');

        document.getElementById('reportRecentRequests').innerHTML = recentHtml || '<div class="text-sm text-slate-400">Veri yok</div>';

    } catch (error) {
        console.error('Reports error:', error);
    }
}

// Bulk Selection Logic
function toggleRequestSelection(id, checked) {
    if (checked) {
        selectedRequests.add(id);
    } else {
        selectedRequests.delete(id);
    }
    updateBulkBar();
}

function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('.request-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const id = parseInt(cb.closest('[data-request-id]').dataset.requestId);
        if (checked) selectedRequests.add(id);
        else selectedRequests.delete(id);
    });
    updateBulkBar();
}

function updateBulkBar() {
    const bar = document.getElementById('bulkActionsBar');
    const countSpan = document.getElementById('selectedCount');
    if (!bar || !countSpan) return;
    if (selectedRequests.size > 0) {
        bar.classList.remove('hidden');
        countSpan.textContent = `${selectedRequests.size} Seçili`;
    } else {
        bar.classList.add('hidden');
    }
}

async function bulkUpdateStatus(status) {
    if (selectedRequests.size === 0) return;
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/requests/bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ ids: Array.from(selectedRequests), action: 'update', status })
        });
        if (response.ok) {
            showCustomAlert('Toplu güncelleme başarılı');
            selectedRequests.clear();
            updateBulkBar();
            loadRequests();
        }
    } catch (error) {
        showCustomAlert('İşlem başarısız');
    }
}

async function bulkDelete() {
    if (selectedRequests.size === 0) return;
    if (!confirm('Seçilen tüm talepleri silmek istediğinize emin misiniz?')) return;
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/requests/bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ ids: Array.from(selectedRequests), action: 'delete' })
        });
        if (response.ok) {
            showCustomAlert('Toplu silme başarılı');
            selectedRequests.clear();
            updateBulkBar();
            loadRequests();
        }
    } catch (error) {
        showCustomAlert('İşlem başarısız');
    }
}

// Global Leaderboard Logic
async function loadOperatorLeaderboard() {
    const leaderboardDiv = document.getElementById('operatorLeaderboard');
    if (!leaderboardDiv) return;

    const userStats = {};
    allRequests.forEach(req => {
        if (req.assigned_to) {
            if (!userStats[req.assigned_to]) userStats[req.assigned_to] = { total: 0, completed: 0 };
            userStats[req.assigned_to].total++;
            if (req.status === 'arandı') userStats[req.assigned_to].completed++;
        }
    });

    const sortedUsers = Object.entries(userStats)
        .sort((a, b) => b[1].completed - a[1].completed)
        .slice(0, 5);

    if (sortedUsers.length === 0) {
        leaderboardDiv.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm">Henüz veri yok</div>';
        return;
    }

    leaderboardDiv.innerHTML = sortedUsers.map(([username, stats], index) => {
        const medalColor = index === 0 ? 'text-amber-400' : index === 1 ? 'text-slate-300' : index === 2 ? 'text-amber-600' : 'text-slate-500';
        const progressWidth = Math.min(100, (stats.completed / (stats.total || 1)) * 100);
        return `
            <div class="relative">
                <div class="flex justify-between items-center mb-1">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold ${medalColor}">#${index + 1}</span>
                        <span class="text-sm font-medium text-white">${username}</span>
                    </div>
                    <span class="text-xs font-bold text-emerald-400">${stats.completed} Çağrı</span>
                </div>
                <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000" style="width: ${progressWidth}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

// Chart Logic
async function updateTrafficChart() {
    if (!isAuthenticated) return;
    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/stats/hourly', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return;
        const data = await response.json();

        const hours = data.map(d => d.hour);
        const counts = data.map(d => d.count);

        const options = {
            series: [{ name: 'Talep Sayısı', data: counts }],
            chart: {
                type: 'area',
                height: 250,
                toolbar: { show: false },
                animations: { enabled: true },
                background: 'transparent',
                foreColor: '#94a3b8'
            },
            colors: ['#43ea80'],
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.45,
                    opacityTo: 0.05,
                    stops: [20, 100, 100, 100]
                }
            },
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth', width: 3 },
            xaxis: {
                categories: hours,
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: { show: false },
            grid: {
                borderColor: '#1e293b',
                strokeDashArray: 4,
                xaxis: { lines: { show: true } },
                yaxis: { lines: { show: false } }
            },
            tooltip: { theme: 'dark' }
        };

        if (trafficChart) {
            trafficChart.updateOptions(options);
        } else {
            trafficChart = new ApexCharts(document.querySelector("#trafficChart"), options);
            trafficChart.render();
        }
    } catch (error) {
        console.error('Chart error:', error);
    }
}

// Audit Logs Logic
async function loadAuditLogs() {
    const body = document.getElementById('auditLogsBody');
    if (!body) return;

    try {
        const token = sessionStorage.getItem('adminToken');
        const response = await fetch('/api/admin/audit-logs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return;
        const logs = await response.json();

        if (logs.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-slate-500">Kayıt bulunamadı</td></tr>';
            return;
        }

        body.innerHTML = logs.map(log => `
            <tr class="hover:bg-slate-800/30 transition-colors">
                <td class="px-6 py-4 text-xs text-slate-400 font-mono">${new Date(log.created_at).toLocaleString('tr-TR')}</td>
                <td class="px-6 py-4">
                    <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold">${log.username}</span>
                </td>
                <td class="px-6 py-4 text-sm text-white font-medium">${log.action}</td>
                <td class="px-6 py-4 text-xs text-slate-400 italic">${log.details || '-'}</td>
            </tr>
        `).join('');
    } catch (error) {
        body.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-red-500">Loglar yüklenemedi</td></tr>';
    }
}

checkAuth();
setInterval(() => {
    loadRequests();
    if (document.getElementById('auditSection').classList.contains('hidden')) return;
    loadAuditLogs();
}, 5000);
