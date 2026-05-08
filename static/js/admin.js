// ── State ────────────────────────────────────────────────────────────────────
let currentAdmin = null;
let currentTab = 'users';
let academias = [];

// Workout editor state
let workoutUserId = null;
let workoutUserObj = null;
let workoutData = {};
let workoutLetter = 'A';
let editingExIdx = -1;

// Modal editing state
let editingUserId = null;
let editingTrainerId = null;
let editingAcademiaId = null;

// ── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
    const r = await fetch(url, opts);
    if (r.status === 401) { showLogin(); throw new Error('Sessão expirada'); }
    if (!r.ok) {
        let msg = 'Erro';
        try { msg = (await r.json()).detail || msg; } catch (_) {}
        throw new Error(msg);
    }
    return r;
}

const api = {
    get:    url => apiFetch(url).then(r => r.json()),
    post:   (url, d) => apiFetch(url, { method:'POST',   headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) }).then(r => r.json()),
    put:    (url, d) => apiFetch(url, { method:'PUT',    headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) }).then(r => r.json()),
    delete: url      => apiFetch(url, { method:'DELETE' }).then(r => r.json()),
};

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = type;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function showLogin() {
    document.getElementById('view-login').style.display = 'flex';
    document.getElementById('view-app').style.display = 'none';
}

function showApp() {
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-app').style.display = 'flex';
}

async function doLogin() {
    const username = document.getElementById('l-user').value.trim().toLowerCase();
    const password = document.getElementById('l-pass').value;
    if (!username || !password) { toast('Preencha usuário e senha', 'err'); return; }
    try {
        const res = await api.post('/api/admin/auth/login', { username, password });
        currentAdmin = res;
        await afterLogin();
    } catch (e) { toast(e.message, 'err'); }
}

async function afterLogin() {
    const label = currentAdmin.is_superadmin
        ? `👤 ${currentAdmin.username} (super)`
        : `👤 ${currentAdmin.username}${currentAdmin.academia_nome ? ' · ' + currentAdmin.academia_nome : ''}`;
    document.getElementById('sidebar-user').textContent = label;
    await setupSuperAdminUI();
    showApp();
    showTab('users');
}

async function doLogout() {
    try { await api.post('/api/admin/auth/logout', {}); } catch (_) {}
    currentAdmin = null;
    showLogin();
}

// ── Super-admin UI ────────────────────────────────────────────────────────────
function isSuperAdmin() {
    return !!(currentAdmin && currentAdmin.is_superadmin);
}

async function setupSuperAdminUI() {
    document.querySelectorAll('.super-only').forEach(el => {
        el.style.display = isSuperAdmin() ? '' : 'none';
    });

    if (isSuperAdmin()) {
        try { academias = await api.get('/api/admin/academias'); } catch (_) { academias = []; }
    } else {
        academias = [];
    }
    populateAcademiaSelects();
}

function populateAcademiaSelects() {
    ['u-academia', 't-academia'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">— Nenhuma —</option>';
        academias.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.nome} (${a.codigo})`;
            sel.appendChild(opt);
        });
    });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function showTab(tab) {
    currentTab = tab;
    ['users', 'trainers', 'academias'].forEach(t => {
        const tabEl = document.getElementById('tab-' + t);
        const navEl = document.getElementById('nav-' + t);
        if (tabEl) tabEl.style.display = t === tab ? 'block' : 'none';
        if (navEl) navEl.classList.toggle('active', t === tab);
    });
    if (tab === 'users') loadUsers();
    if (tab === 'trainers') loadTrainers();
    if (tab === 'academias') loadAcademias();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtDateInput(iso) {
    if (!iso) return '';
    return iso.slice(0, 10);
}

function statusBadge(u) {
    if (!u.is_active) return '<span class="badge badge-danger">Suspenso</span>';
    if (u.plan_expired) return '<span class="badge badge-warning">Vencido</span>';
    return '<span class="badge badge-ok">Ativo</span>';
}

function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
    let users;
    try { users = await api.get('/api/admin/users'); } catch (e) { toast(e.message, 'err'); return; }

    const tbody = document.getElementById('users-tbody');
    const empty = document.getElementById('users-empty');
    tbody.innerHTML = '';

    const thAcademia = document.getElementById('th-academia-user');
    if (thAcademia) thAcademia.style.display = isSuperAdmin() ? '' : 'none';

    if (!users.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    users.forEach(u => {
        const tr = document.createElement('tr');
        const expires = u.plan_expires_at
            ? `<span style="color:${u.plan_expired ? 'var(--danger)' : 'var(--text)'}">${fmtDate(u.plan_expires_at)}</span>`
            : '<span style="color:var(--muted)">Sem validade</span>';

        const academiaCell = isSuperAdmin()
            ? `<td>${esc(u.academia_nome || '—')}</td>`
            : '';

        tr.innerHTML = `
            <td><strong>${esc(u.username)}</strong></td>
            <td>${statusBadge(u)}</td>
            <td>${expires}</td>
            ${academiaCell}
            <td>${u.workouts_done}</td>
            <td>${fmtDate(u.last_workout)}</td>
            <td class="td-actions">
                <button class="btn btn-secondary btn-sm" onclick="openWorkoutModal(${u.id},'${esc(u.username)}')">🏋️ Treinos</button>
                <button class="btn btn-secondary btn-sm" onclick="openUserModal(${u.id})">✏️ Editar</button>
                ${u.is_active
                    ? `<button class="btn btn-warning btn-sm" onclick="toggleUser(${u.id},false)">⏸ Suspender</button>`
                    : `<button class="btn btn-ok btn-sm" onclick="toggleUser(${u.id},true)">▶ Ativar</button>`}
                <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id},'${esc(u.username)}')">🗑</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

function openUserModal(userId = null) {
    editingUserId = userId;
    const isNew = userId === null;
    document.getElementById('user-modal-title').textContent = isNew ? 'Novo Usuário' : 'Editar Usuário';
    document.getElementById('u-pass-hint').style.display = isNew ? 'none' : 'inline';
    document.getElementById('u-active-row').style.display = isNew ? 'none' : 'flex';
    document.getElementById('u-username').value = '';
    document.getElementById('u-password').value = '';
    document.getElementById('u-expires').value = '';
    document.getElementById('u-active').checked = true;

    const acadField = document.getElementById('u-academia-field');
    if (acadField) acadField.style.display = isSuperAdmin() ? '' : 'none';

    if (!isNew) {
        api.get('/api/admin/users').then(users => {
            const u = users.find(x => x.id === userId);
            if (!u) return;
            document.getElementById('u-username').value = u.username;
            document.getElementById('u-expires').value = fmtDateInput(u.plan_expires_at);
            document.getElementById('u-active').checked = u.is_active;
            if (isSuperAdmin()) {
                const sel = document.getElementById('u-academia');
                if (sel) sel.value = u.academia_id || '';
            }
        });
    }
    document.getElementById('modal-user').classList.add('open');
}

function closeUserModal() {
    document.getElementById('modal-user').classList.remove('open');
    editingUserId = null;
}

async function saveUser() {
    const username = document.getElementById('u-username').value.trim();
    const password = document.getElementById('u-password').value.trim();
    const expiresRaw = document.getElementById('u-expires').value;
    const isActive = document.getElementById('u-active').checked;
    const plan_expires_at = expiresRaw ? expiresRaw + 'T23:59:59' : null;

    try {
        if (editingUserId === null) {
            if (!password) { toast('Senha obrigatória', 'err'); return; }
            const body = { username, password, plan_expires_at };
            if (isSuperAdmin()) {
                const sel = document.getElementById('u-academia');
                body.academia_id = sel && sel.value ? Number(sel.value) : null;
            }
            await api.post('/api/admin/users', body);
            toast('Usuário criado!');
        } else {
            const body = { username, is_active: isActive, plan_expires_at };
            if (password) body.password = password;
            if (isSuperAdmin()) {
                const sel = document.getElementById('u-academia');
                body.academia_id = sel && sel.value ? Number(sel.value) : null;
            }
            await api.put(`/api/admin/users/${editingUserId}`, body);
            toast('Usuário atualizado!');
        }
        closeUserModal();
        loadUsers();
    } catch (e) { toast(e.message, 'err'); }
}

async function toggleUser(userId, active) {
    try {
        await api.put(`/api/admin/users/${userId}`, { is_active: active });
        toast(active ? 'Usuário ativado!' : 'Usuário suspenso!');
        loadUsers();
    } catch (e) { toast(e.message, 'err'); }
}

async function deleteUser(userId, username) {
    if (!confirm(`Excluir usuário "${username}" e todos os seus dados?`)) return;
    try {
        await api.delete(`/api/admin/users/${userId}`);
        toast('Usuário excluído!');
        loadUsers();
    } catch (e) { toast(e.message, 'err'); }
}

// ── Trainers ──────────────────────────────────────────────────────────────────
async function loadTrainers() {
    let trainers;
    try { trainers = await api.get('/api/admin/trainers'); } catch (e) { toast(e.message, 'err'); return; }

    const tbody = document.getElementById('trainers-tbody');
    const empty = document.getElementById('trainers-empty');
    tbody.innerHTML = '';

    const thAcademia = document.getElementById('th-academia-trainer');
    if (thAcademia) thAcademia.style.display = isSuperAdmin() ? '' : 'none';

    if (!trainers.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    trainers.forEach(t => {
        const isSelf = currentAdmin && t.id === currentAdmin.id;
        const academiaCell = isSuperAdmin()
            ? `<td>${esc(t.academia_nome || '—')}</td>`
            : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(t.username)}</strong>${isSelf ? ' <span class="badge badge-muted">você</span>' : ''}</td>
            <td>${t.is_active ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-danger">Inativo</span>'}</td>
            <td>${fmtDate(t.created_at)}</td>
            ${academiaCell}
            <td class="td-actions">
                <button class="btn btn-secondary btn-sm" onclick="openTrainerModal(${t.id})">✏️ Editar</button>
                ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteTrainer(${t.id},'${esc(t.username)}')">🗑</button>` : ''}
            </td>`;
        tbody.appendChild(tr);
    });
}

function openTrainerModal(trainerId = null) {
    editingTrainerId = trainerId;
    const isNew = trainerId === null;
    document.getElementById('trainer-modal-title').textContent = isNew ? 'Novo Professor' : 'Editar Professor';
    document.getElementById('t-pass-hint').style.display = isNew ? 'none' : 'inline';
    document.getElementById('t-active-row').style.display = isNew ? 'none' : 'flex';
    document.getElementById('t-username').value = '';
    document.getElementById('t-password').value = '';
    document.getElementById('t-active').checked = true;

    const acadField = document.getElementById('t-academia-field');
    if (acadField) acadField.style.display = isSuperAdmin() ? '' : 'none';

    if (!isNew) {
        api.get('/api/admin/trainers').then(trainers => {
            const t = trainers.find(x => x.id === trainerId);
            if (!t) return;
            document.getElementById('t-username').value = t.username;
            document.getElementById('t-active').checked = t.is_active;
            if (isSuperAdmin()) {
                const sel = document.getElementById('t-academia');
                if (sel) sel.value = t.academia_id || '';
            }
        });
    }
    document.getElementById('modal-trainer').classList.add('open');
}

function closeTrainerModal() {
    document.getElementById('modal-trainer').classList.remove('open');
    editingTrainerId = null;
}

async function saveTrainer() {
    const username = document.getElementById('t-username').value.trim();
    const password = document.getElementById('t-password').value.trim();
    const isActive = document.getElementById('t-active').checked;

    try {
        if (editingTrainerId === null) {
            if (!password) { toast('Senha obrigatória', 'err'); return; }
            const body = { username, password };
            if (isSuperAdmin()) {
                const sel = document.getElementById('t-academia');
                body.academia_id = sel && sel.value ? Number(sel.value) : null;
            }
            await api.post('/api/admin/trainers', body);
            toast('Professor criado!');
        } else {
            const body = { username, is_active: isActive };
            if (password) body.password = password;
            if (isSuperAdmin()) {
                const sel = document.getElementById('t-academia');
                body.academia_id = sel && sel.value ? Number(sel.value) : null;
            }
            await api.put(`/api/admin/trainers/${editingTrainerId}`, body);
            toast('Professor atualizado!');
        }
        closeTrainerModal();
        loadTrainers();
    } catch (e) { toast(e.message, 'err'); }
}

async function deleteTrainer(trainerId, username) {
    if (!confirm(`Excluir professor "${username}"?`)) return;
    try {
        await api.delete(`/api/admin/trainers/${trainerId}`);
        toast('Professor excluído!');
        loadTrainers();
    } catch (e) { toast(e.message, 'err'); }
}

// ── Academias (super-admin only) ──────────────────────────────────────────────
async function loadAcademias() {
    try { academias = await api.get('/api/admin/academias'); } catch (e) { toast(e.message, 'err'); return; }

    const tbody = document.getElementById('academias-tbody');
    const empty = document.getElementById('academias-empty');
    tbody.innerHTML = '';

    if (!academias.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    academias.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(a.nome)}</strong></td>
            <td><code style="background:var(--surface2);padding:2px 6px;border-radius:4px">${esc(a.codigo)}</code></td>
            <td>${a.is_active ? '<span class="badge badge-ok">Ativa</span>' : '<span class="badge badge-danger">Inativa</span>'}</td>
            <td>${a.users_count}</td>
            <td>${a.trainers_count}</td>
            <td class="td-actions">
                <button class="btn btn-secondary btn-sm" onclick="openAcademiaModal(${a.id})">✏️ Editar</button>
                ${a.is_active
                    ? `<button class="btn btn-warning btn-sm" onclick="toggleAcademia(${a.id},false)">⏸ Desativar</button>`
                    : `<button class="btn btn-ok btn-sm" onclick="toggleAcademia(${a.id},true)">▶ Ativar</button>`}
                <button class="btn btn-danger btn-sm" onclick="deleteAcademia(${a.id},'${esc(a.nome)}')">🗑</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

function openAcademiaModal(academiaId = null) {
    editingAcademiaId = academiaId;
    const isNew = academiaId === null;
    document.getElementById('academia-modal-title').textContent = isNew ? 'Nova Academia' : 'Editar Academia';
    document.getElementById('a-nome').value = '';
    document.getElementById('a-codigo').value = '';
    document.getElementById('a-active').checked = true;
    document.getElementById('a-active-row').style.display = isNew ? 'none' : 'flex';

    if (!isNew) {
        const a = academias.find(x => x.id === academiaId);
        if (a) {
            document.getElementById('a-nome').value = a.nome;
            document.getElementById('a-codigo').value = a.codigo;
            document.getElementById('a-active').checked = a.is_active;
        }
    }
    document.getElementById('modal-academia').classList.add('open');
}

function closeAcademiaModal() {
    document.getElementById('modal-academia').classList.remove('open');
    editingAcademiaId = null;
}

async function saveAcademia() {
    const nome = document.getElementById('a-nome').value.trim();
    const codigo = document.getElementById('a-codigo').value.trim().toUpperCase();
    const is_active = document.getElementById('a-active').checked;

    if (!nome || !codigo) { toast('Nome e código são obrigatórios', 'err'); return; }

    try {
        if (editingAcademiaId === null) {
            await api.post('/api/admin/academias', { nome, codigo, is_active: true });
            toast('Academia criada!');
        } else {
            await api.put(`/api/admin/academias/${editingAcademiaId}`, { nome, codigo, is_active });
            toast('Academia atualizada!');
        }
        closeAcademiaModal();
        await loadAcademias();
        populateAcademiaSelects();
    } catch (e) { toast(e.message, 'err'); }
}

async function toggleAcademia(academiaId, active) {
    try {
        await api.put(`/api/admin/academias/${academiaId}`, { is_active: active });
        toast(active ? 'Academia ativada!' : 'Academia desativada!');
        await loadAcademias();
        populateAcademiaSelects();
    } catch (e) { toast(e.message, 'err'); }
}

async function deleteAcademia(academiaId, nome) {
    if (!confirm(`Excluir academia "${nome}"? Alunos e professores serão desvinculados.`)) return;
    try {
        await api.delete(`/api/admin/academias/${academiaId}`);
        toast('Academia excluída!');
        await loadAcademias();
        populateAcademiaSelects();
    } catch (e) { toast(e.message, 'err'); }
}

// ── Workout Modal ─────────────────────────────────────────────────────────────
async function openWorkoutModal(userId, username) {
    workoutUserId = userId;
    workoutUserObj = { id: userId, username };
    document.getElementById('workout-modal-title').textContent = `Treinos de ${username}`;

    try {
        const users = await api.get('/api/admin/users');
        const u = users.find(x => x.id === userId);
        document.getElementById('w-expires').value = u ? fmtDateInput(u.plan_expires_at) : '';

        workoutData = await api.get(`/api/admin/users/${userId}/workouts`);
    } catch (e) { toast(e.message, 'err'); return; }

    workoutLetter = Object.keys(workoutData).sort()[0] || 'A';
    buildWorkoutTabs();
    renderExercises();
    document.getElementById('modal-workout').classList.add('open');
}

function closeWorkoutModal() {
    document.getElementById('modal-workout').classList.remove('open');
    workoutUserId = null;
}

function buildWorkoutTabs() {
    const tabs = document.getElementById('workout-tabs');
    tabs.innerHTML = '';
    Object.keys(workoutData).sort().forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'workout-tab' + (letter === workoutLetter ? ' active' : '');
        btn.textContent = `Treino ${letter}`;
        btn.onclick = () => { workoutLetter = letter; buildWorkoutTabs(); renderExercises(); };
        tabs.appendChild(btn);
    });
}

function renderExercises() {
    const tbody = document.getElementById('exercises-tbody');
    const empty = document.getElementById('exercises-empty');
    const treino = workoutData[workoutLetter];
    document.getElementById('workout-tab-name').textContent = treino?.nome || '';
    tbody.innerHTML = '';

    const exs = treino?.exercicios || [];
    if (!exs.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    exs.forEach((ex, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${esc(ex.nome)}</strong></td>
            <td><span style="color:var(--muted)">${esc(ex.tipo || '')}</span></td>
            <td>${ex.series}</td>
            <td>${esc(Array.isArray(ex.reps) ? ex.reps.join(', ') : String(ex.reps || ''))}</td>
            <td>${Array.isArray(ex.carga) ? ex.carga.join(', ') : (ex.carga || 0)} kg</td>
            <td>${Array.isArray(ex.descanso) ? ex.descanso.join(', ') : (ex.descanso || 0)}s</td>
            <td class="td-actions">
                <button class="btn btn-secondary btn-sm" onclick="moveEx(${idx},-1)" ${idx===0?'disabled':''}>⬆</button>
                <button class="btn btn-secondary btn-sm" onclick="moveEx(${idx},1)" ${idx===exs.length-1?'disabled':''}>⬇</button>
                <button class="btn btn-secondary btn-sm" onclick="openExerciseModal(${idx})">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEx(${idx})">🗑</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

function moveEx(idx, dir) {
    const exs = workoutData[workoutLetter].exercicios;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= exs.length) return;
    [exs[idx], exs[newIdx]] = [exs[newIdx], exs[idx]];
    renderExercises();
}

function deleteEx(idx) {
    if (!confirm('Excluir exercício?')) return;
    workoutData[workoutLetter].exercicios.splice(idx, 1);
    renderExercises();
}

async function saveWorkouts() {
    try {
        await api.put(`/api/admin/users/${workoutUserId}/workouts`, workoutData);
        toast('Treinos salvos!');
    } catch (e) { toast(e.message, 'err'); }
}

async function saveExpiry() {
    const expiresRaw = document.getElementById('w-expires').value;
    const plan_expires_at = expiresRaw ? expiresRaw + 'T23:59:59' : null;
    try {
        await api.put(`/api/admin/users/${workoutUserId}`, { plan_expires_at });
        toast('Validade salva!');
        if (currentTab === 'users') loadUsers();
    } catch (e) { toast(e.message, 'err'); }
}

async function resetWorkouts() {
    if (!confirm('Restaurar treinos padrão? Os treinos personalizados serão perdidos.')) return;
    try {
        await api.delete(`/api/admin/users/${workoutUserId}/workouts`);
        workoutData = await api.get(`/api/admin/users/${workoutUserId}/workouts`);
        workoutLetter = Object.keys(workoutData).sort()[0] || 'A';
        buildWorkoutTabs();
        renderExercises();
        toast('Treinos restaurados ao padrão!');
    } catch (e) { toast(e.message, 'err'); }
}

// ── Exercise Modal ────────────────────────────────────────────────────────────
function openExerciseModal(idx) {
    editingExIdx = idx;
    const isNew = idx === -1;
    document.getElementById('ex-modal-title').textContent = isNew ? 'Novo Exercício' : 'Editar Exercício';
    const ex = isNew
        ? { nome: '', tipo: '', series: 3, reps: '10', carga: 0, descanso: 60, mensagem: '' }
        : workoutData[workoutLetter].exercicios[idx];

    document.getElementById('ex-nome').value = ex.nome || '';
    document.getElementById('ex-tipo').value = ex.tipo || '';
    document.getElementById('ex-series').value = ex.series || 3;
    document.getElementById('ex-reps').value = Array.isArray(ex.reps) ? ex.reps[0] : (ex.reps || '');
    document.getElementById('ex-carga').value = Array.isArray(ex.carga) ? ex.carga[0] : (ex.carga || 0);
    document.getElementById('ex-descanso').value = Array.isArray(ex.descanso) ? ex.descanso[0] : (ex.descanso || 60);
    document.getElementById('ex-msg').value = ex.mensagem || '';
    document.getElementById('modal-exercise').classList.add('open');
}

function closeExerciseModal() {
    document.getElementById('modal-exercise').classList.remove('open');
    editingExIdx = -1;
}

function saveExercise() {
    const nome = document.getElementById('ex-nome').value.trim();
    if (!nome) { toast('Nome é obrigatório', 'err'); return; }

    const ex = {
        nome,
        tipo: document.getElementById('ex-tipo').value.trim(),
        series: Number(document.getElementById('ex-series').value) || 3,
        reps: document.getElementById('ex-reps').value.trim(),
        carga: Number(document.getElementById('ex-carga').value) || 0,
        descanso: Number(document.getElementById('ex-descanso').value) || 60,
        mensagem: document.getElementById('ex-msg').value.trim(),
    };

    const exs = workoutData[workoutLetter].exercicios;
    if (editingExIdx === -1) {
        exs.push(ex);
    } else {
        ex.done = exs[editingExIdx].done || [];
        exs[editingExIdx] = ex;
    }

    renderExercises();
    closeExerciseModal();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
    document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    try {
        const me = await api.get('/api/admin/auth/me');
        currentAdmin = me;
        await afterLogin();
    } catch (_) {
        showLogin();
    }
});
