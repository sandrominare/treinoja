// ── State ────────────────────────────────────────────────────────────────────
let me = null;
let stats = null;
let users = [];
let trainers = [];
let academias = [];
let library = [];
let currentView = 'dashboard';
let chartRange = 'week';
let alunosFilter = 'todos';
let searchTerm = '';
let fichaUserId = null;
let editingUserId = null;
let editingTrainerId = null;
let editingAcademiaId = null;

// Montador
let mUserId = null;
let mData = null;
let mLetter = 'A';
let mLibFiltro = 'Todos';

const AVATAR_COLORS = ['#E8491D', '#2E3A40', '#2FA36B', '#8A6BBF', '#B4713D', '#8A8F94'];
const TIPO_ICONS = { 'Costas': '🏋️', 'Peito': '💪', 'Pernas': '🦵', 'Ombro': '🤸', 'Ombros': '🤸', 'Bíceps': '💪', 'Tríceps': '💪', 'Abdômen': '🔥', 'Cardio': '🏃' };

// ── API ──────────────────────────────────────────────────────────────────────
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
    get: url => apiFetch(url).then(r => r.json()),
    post: (url, d) => apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(r => r.json()),
    put: (url, d) => apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(r => r.json()),
    delete: url => apiFetch(url, { method: 'DELETE' }).then(r => r.json()),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, err = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'show' + (err ? ' err' : '');
    setTimeout(() => t.className = '', 2600);
}

function initials(name) {
    const p = String(name).trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || p[0]?.[1] || '')).toUpperCase();
}
function avatarColor(id) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }
function avatarHtml(id, name, cls = '') {
    return `<div class="avatar ${cls}" style="background:${avatarColor(id)}">${esc(initials(name))}</div>`;
}
function tipoIcon(tipo) { return TIPO_ICONS[tipo] || '🏋️'; }

// completed_at chega como UTC-naive → tratar como UTC
function parseUTC(iso) { return iso ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')) : null; }
function fmtTime(iso) { const d = parseUTC(iso); return d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtDate(iso) { const d = parseUTC(iso); return d ? d.toLocaleDateString('pt-BR') : '—'; }
function relDays(iso) {
    if (!iso) return 'Nunca';
    const days = Math.floor((Date.now() - parseUTC(iso).getTime()) / 86400000);
    if (days <= 0) return 'Hoje';
    if (days === 1) return 'Ontem';
    return `${days} dias`;
}
function fmtDur(sec) {
    if (!sec) return '';
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
const STATUS_LABEL = { ativo: 'Ativo', novo: 'Novo', em_risco: 'Em risco', inativo: 'Inativo' };
function userStatus(u) { return (stats?.user_statuses || {})[u.id] || (u.is_active ? 'ativo' : 'inativo'); }
function adesaoPct(u) {
    const n = (stats?.month_counts || {})[u.id] || 0;
    return Math.min(100, Math.round(100 * n / 12));
}

// ── Auth / boot ──────────────────────────────────────────────────────────────
function showLogin() {
    $('view-login').style.display = 'flex';
    $('view-app').style.display = 'none';
}
async function doLogin() {
    try {
        me = await api.post('/api/admin/auth/login', { username: $('l-user').value, password: $('l-pass').value });
        await boot();
    } catch (e) { toast(e.message, true); }
}
async function doLogout() {
    await api.post('/api/admin/auth/logout', {});
    me = null;
    showLogin();
}
async function boot() {
    $('view-login').style.display = 'none';
    $('view-app').style.display = 'flex';
    $('side-academia').textContent = me.is_superadmin ? 'TREINOJÁ' : me.academia_nome;
    $('side-logo').textContent = (me.is_superadmin ? 'T' : (me.academia_nome || 'T')[0]).toUpperCase();
    $('side-user').innerHTML = `Logado como <b>${esc(me.username)}</b>${me.is_superadmin ? ' · super-admin' : ''}`;
    $('admin-badge').style.display = me.is_superadmin ? '' : 'none';
    document.querySelectorAll('.super-only').forEach(el => el.style.display = me.is_superadmin ? '' : 'none');
    await refreshData();
    showView('dashboard');
}
async function refreshData() {
    [stats, users] = await Promise.all([api.get('/api/admin/stats'), api.get('/api/admin/users')]);
    if (me.is_superadmin && !academias.length) academias = await api.get('/api/admin/academias');
}

document.addEventListener('DOMContentLoaded', async () => {
    $('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    try {
        me = await api.get('/api/admin/auth/me');
        await boot();
    } catch (_) { showLogin(); }
});

// ── Navigation ───────────────────────────────────────────────────────────────
const TITLES = {
    dashboard: ['Dashboard', () => `Visão geral da academia · ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`],
    alunos: ['Alunos', () => `${stats?.status_counts?.todos ?? 0} alunos cadastrados`],
    aluno: ['Ficha do aluno', () => 'Ficha completa do aluno'],
    frequencia: ['Frequência', () => 'Check-ins e presença'],
    montador: ['Montador de treino', () => 'Monte e atribua o split A / B / C'],
    gestao: ['Administração', () => 'Professores e academias'],
};
function showView(v) {
    currentView = v;
    document.querySelectorAll('[id^="v-"]').forEach(el => el.style.display = 'none');
    $('v-' + (v === 'aluno' ? 'aluno' : v)).style.display = '';
    document.querySelectorAll('.nav-item').forEach(b =>
        b.classList.toggle('active', b.dataset.view === (v === 'aluno' ? 'alunos' : v)));
    const [t, sub] = TITLES[v];
    $('page-title').textContent = t;
    $('page-sub').textContent = sub();
    ({ dashboard: renderDashboard, alunos: renderAlunos, frequencia: renderFrequencia, montador: renderMontador, gestao: renderGestao, aluno: () => {} })[v]();
}
function onSearch(v) {
    searchTerm = v.trim().toLowerCase();
    if (currentView !== 'alunos' && searchTerm) showView('alunos');
    else if (currentView === 'alunos') renderAlunos();
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function kpiHtml(ico, icoBg, num, label, pill = '') {
    return `<div class="kpi">
      <div class="kpi-top"><div class="kpi-ico" style="background:${icoBg}">${ico}</div>${pill}</div>
      <div class="num">${num}</div><div class="kpi-label">${label}</div></div>`;
}
function renderDashboard() {
    const s = stats;
    $('dash-kpis').innerHTML =
        kpiHtml('👥', 'var(--laranja-soft)', s.active_students, 'Alunos ativos') +
        kpiHtml('🏋️', '#FFF3D6', s.workouts_today, 'Treinos hoje') +
        kpiHtml('✅', 'var(--verde-soft)', s.weekly_frequency_pct + '%', 'Frequência semanal') +
        kpiHtml('⚠️', '#FBE9E7', s.at_risk, 'Alunos em risco', s.at_risk ? '<span class="kpi-pill warn">atenção</span>' : '');
    renderChart();
    $('dash-today-sub').textContent = `${s.today_checkins.length} treino(s) concluído(s) hoje`;
    $('dash-today').innerHTML = s.today_checkins.length ? s.today_checkins.map(c => `
      <div class="row clickable" onclick="openFicha(${c.user_id})">
        ${avatarHtml(c.user_id, c.username)}
        <div class="row-main"><div class="row-title">${esc(c.username)}</div><div class="row-sub">Treino ${esc(c.treino)}${c.duration ? ' · ' + fmtDur(c.duration) : ''}</div></div>
        <div class="row-side">${fmtTime(c.completed_at)}</div>
        <span class="badge ativo">Concluído</span>
      </div>`).join('') : '<div class="empty">Nenhum check-in hoje ainda.</div>';
    $('dash-attention').innerHTML = s.attention.length ? s.attention.map(a => `
      <div class="row clickable" onclick="openFicha(${a.user_id})">
        ${avatarHtml(a.user_id, a.username)}
        <div class="row-main"><div class="row-title">${esc(a.username)}</div>
          <div class="row-sub">${a.days_absent != null ? `Ausente há ${a.days_absent} dias` : 'Nunca treinou'}</div></div>
        <span class="badge em_risco">Em risco</span>
      </div>`).join('') : '<div class="empty">Todos em dia. 💪</div>';
    $('dash-recent').innerHTML = s.recent_activity.length ? s.recent_activity.map(r => `
      <div class="row">
        <div class="ex-ico">${tipoIcon('')}</div>
        <div class="row-main"><div class="row-title">${esc(r.username)}</div><div class="row-sub">Treino ${esc(r.treino)}${r.duration ? ' · ' + fmtDur(r.duration) : ''}</div></div>
        <div class="row-side">${fmtDate(r.completed_at)}<br><span style="font-weight:500;color:var(--terc)">${fmtTime(r.completed_at)}</span></div>
      </div>`).join('') : '<div class="empty">Sem atividade recente.</div>';
}
function setChartRange(r, btn) {
    chartRange = r;
    document.querySelectorAll('#chart-seg .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderChart();
}
function renderChart() {
    const days = chartRange === 'week' ? 7 : 30;
    const by = stats.checkins_by_day || {};
    const cols = [];
    let max = 1;
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const n = by[key] || 0;
        max = Math.max(max, n);
        cols.push({ n, today: i === 0, lbl: chartRange === 'week' ? d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : (d.getDate() % 5 === 0 ? d.getDate() : '') });
    }
    $('dash-chart').innerHTML = cols.map(c => `
      <div class="bar-col">
        ${chartRange === 'week' ? `<span class="bar-val">${c.n || ''}</span>` : ''}
        <div class="bar ${c.today ? 'today' : (c.n === max && max > 0 ? 'hi' : '')}" style="height:${Math.max(4, 100 * c.n / max)}%"></div>
        <span class="bar-lbl">${c.lbl}</span>
      </div>`).join('');
}

// ── Alunos ───────────────────────────────────────────────────────────────────
function filteredUsers() {
    return users.filter(u => {
        if (searchTerm && !u.username.toLowerCase().includes(searchTerm)) return false;
        if (alunosFilter === 'todos') return true;
        const st = userStatus(u);
        if (alunosFilter === 'ativos') return st === 'ativo' || st === 'novo';
        if (alunosFilter === 'em_risco') return st === 'em_risco';
        if (alunosFilter === 'inativos') return st === 'inativo';
        return true;
    });
}
function setAlunosFilter(f) { alunosFilter = f; renderAlunos(); }
function renderAlunos() {
    const c = stats.status_counts;
    $('alunos-chips').innerHTML = [
        ['todos', `Todos <small>· ${c.todos}</small>`],
        ['ativos', `Ativos <small>· ${c.ativos + c.novos}</small>`],
        ['em_risco', `Em risco <small>· ${c.em_risco}</small>`],
        ['inativos', `Inativos <small>· ${c.inativos}</small>`],
    ].map(([k, lbl]) => `<button class="chip ${alunosFilter === k ? 'active' : ''}" onclick="setAlunosFilter('${k}')">${lbl}</button>`).join('');
    const list = filteredUsers();
    $('alunos-empty').style.display = list.length ? 'none' : '';
    $('alunos-tbody').innerHTML = list.map(u => {
        const st = userStatus(u);
        const pct = adesaoPct(u);
        const plano = u.plan_expires_at ? `Vence ${fmtDate(u.plan_expires_at)}` : 'Sem validade';
        const acad = me.is_superadmin ? `<div class="row-sub">${esc(u.academia_nome)}</div>` : '';
        return `<tr onclick="openFicha(${u.id})">
          <td><div class="cell-user">${avatarHtml(u.id, u.username)}<div><div class="row-title">${esc(u.username)}</div>${acad}</div></div></td>
          <td><div class="row-sub" style="font-size:13px;${u.plan_expired ? 'color:#C0331A;font-weight:700' : ''}">${plano}</div></td>
          <td><span class="badge ${st}">${STATUS_LABEL[st]}</span></td>
          <td><div class="adesao"><div class="adesao-track"><div class="adesao-fill ${pct < 50 ? 'low' : ''}" style="width:${pct}%"></div></div><b>${pct}%</b></div></td>
          <td style="text-align:right;font-weight:700">${relDays(u.last_workout)}</td>
          <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openUserModalEdit(${u.id})">✎</button></td>
        </tr>`;
    }).join('');
}

// ── Ficha do aluno ───────────────────────────────────────────────────────────
async function openFicha(id) {
    fichaUserId = id;
    const u = users.find(x => x.id === id);
    if (!u) return;
    showView('aluno');
    $('page-title').textContent = u.username;
    $('f-avatar').outerHTML = avatarHtml(u.id, u.username, 'avatar-xl').replace('class="avatar avatar-xl"', 'class="avatar avatar-xl" id="f-avatar"');
    $('f-nome').textContent = u.username;
    $('f-plano').textContent = (u.plan_expires_at ? `Plano até ${fmtDate(u.plan_expires_at)}` : 'Plano sem validade') + (me.is_superadmin ? ` · ${u.academia_nome}` : '');
    $('f-treinos').innerHTML = '<div class="empty">Carregando…</div>';
    $('f-hist').innerHTML = '<div class="empty">Carregando…</div>';

    const [hist, plan] = await Promise.all([
        api.get(`/api/admin/users/${id}/history`),
        api.get(`/api/admin/users/${id}/workouts`),
    ]);

    // KPIs: total, adesão 28d, sequência de semanas
    const weeks = weeklyCounts(hist, 12);
    let streak = 0;
    for (let i = weeks.length - 1; i >= 0 && weeks[i] > 0; i--) streak++;
    $('f-kpis').innerHTML =
        kpiHtml('🏋️', 'var(--laranja-soft)', hist.length, 'Treinos totais') +
        kpiHtml('✅', 'var(--verde-soft)', adesaoPct(u) + '%', 'Adesão (4 semanas)') +
        kpiHtml('🔥', '#FFF3D6', streak, streak === 1 ? 'Semana seguida' : 'Semanas seguidas');

    // Treino atual
    const letters = Object.keys(plan || {}).sort();
    $('f-treino-sub').textContent = letters.length ? `Split ${letters.join(' / ')}` : 'Sem plano';
    $('f-treinos').innerHTML = letters.map(l => `
      <div class="row clickable" onclick="montadorFor(${id}, '${l}')">
        <div class="ex-ico">${tipoIcon((plan[l].exercicios || [])[0]?.tipo)}</div>
        <div class="row-main"><div class="row-title">Treino ${l} · ${esc(plan[l].nome || '')}</div>
          <div class="row-sub">${(plan[l].exercicios || []).length} exercícios</div></div>
        <div class="row-side">›</div>
      </div>`).join('') || '<div class="empty">Nenhum treino atribuído.</div>';

    // Heatmap 12 semanas (colunas = semanas, linhas = dias)
    renderHeatmap(hist);

    $('f-hist').innerHTML = hist.slice(0, 10).map(h => `
      <div class="row">
        <div class="ex-ico">✅</div>
        <div class="row-main"><div class="row-title">Treino ${esc(h.treino)}</div><div class="row-sub">${h.duration ? fmtDur(h.duration) : ''}</div></div>
        <div class="row-side">${fmtDate(h.completed_at)}<br><span style="font-weight:500;color:var(--terc)">${fmtTime(h.completed_at)}</span></div>
      </div>`).join('') || '<div class="empty">Nenhum treino registrado.</div>';
}
function weeklyCounts(hist, nWeeks) {
    const counts = new Array(nWeeks).fill(0);
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // segunda = 0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    hist.forEach(h => {
        const d = parseUTC(h.completed_at);
        const diff = Math.floor((monday - d) / 604800000);
        const idx = nWeeks - 1 - (d >= monday ? 0 : diff + 1);
        if (idx >= 0 && idx < nWeeks) counts[idx]++;
    });
    return counts;
}
function renderHeatmap(hist) {
    const byDay = {};
    hist.forEach(h => {
        const d = parseUTC(h.completed_at);
        byDay[d.toLocaleDateString('sv')] = (byDay[d.toLocaleDateString('sv')] || 0) + 1;
    });
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow - 77); // 11 semanas antes
    let html = '';
    for (let row = 0; row < 7; row++) {
        for (let w = 0; w < 12; w++) {
            const d = new Date(monday);
            d.setDate(d.getDate() + w * 7 + row);
            const n = byDay[d.toLocaleDateString('sv')] || 0;
            const cls = n === 0 ? 'hm0' : n === 1 ? 'hm1' : n === 2 ? 'hm2' : 'hm3';
            const future = d > now;
            html += `<i class="hm ${cls}" ${future ? 'style="opacity:.25"' : ''} title="${d.toLocaleDateString('pt-BR')}: ${n} treino(s)"></i>`;
        }
    }
    $('f-heatmap').innerHTML = html;
}

// ── Frequência ───────────────────────────────────────────────────────────────
function renderFrequencia() {
    const s = stats;
    $('freq-kpis').innerHTML =
        kpiHtml('✅', 'var(--verde-soft)', s.workouts_today, 'Check-ins hoje') +
        kpiHtml('📅', 'var(--laranja-soft)', s.weekly_frequency_pct + '%', 'Presença semanal') +
        kpiHtml('💪', '#FFF3D6', s.frequent_week, 'Treinaram na semana') +
        kpiHtml('😴', '#FBE9E7', s.absent_week, 'Sem treino na semana');
    $('freq-sub').textContent = `${s.today_checkins.length} check-in(s)`;
    $('freq-list').innerHTML = s.today_checkins.length ? s.today_checkins.map(c => `
      <div class="row clickable" onclick="openFicha(${c.user_id})">
        ${avatarHtml(c.user_id, c.username)}
        <div class="row-main"><div class="row-title">${esc(c.username)}</div><div class="row-sub">Treino ${esc(c.treino)}${c.duration ? ' · ' + fmtDur(c.duration) : ''}</div></div>
        <div class="row-side">${fmtTime(c.completed_at)}</div>
        <span class="badge ativo">Concluído</span>
      </div>`).join('') : '<div class="empty">Nenhum check-in hoje ainda.</div>';
}

// ── Montador ─────────────────────────────────────────────────────────────────
async function renderMontador() {
    const sel = $('m-aluno');
    sel.innerHTML = '<option value="">Selecionar aluno…</option>' +
        users.map(u => `<option value="${u.id}" ${u.id === mUserId ? 'selected' : ''}>${esc(u.username)}</option>`).join('');
    if (!library.length) {
        try { library = await api.get('/api/admin/exercise-library'); } catch (_) {}
    }
    renderLib();
    renderMontadorBody();
}
async function montadorFor(id, letter) {
    if (!id) { mUserId = null; mData = null; renderMontadorBody(); return; }
    mUserId = id;
    mData = null;
    if (currentView !== 'montador') showView('montador'); else renderMontador();
    mData = await api.get(`/api/admin/users/${id}/workouts`);
    mLetter = letter && mData[letter] ? letter : (Object.keys(mData).sort()[0] || 'A');
    renderMontador();
}
function renderMontadorBody() {
    const u = users.find(x => x.id === mUserId);
    $('m-aluno-nome').textContent = u ? u.username : '—';
    if (!mData) {
        $('m-tabs').innerHTML = '';
        $('m-exercicios').innerHTML = `<div class="empty">${mUserId ? 'Carregando…' : 'Selecione um aluno para montar o treino.'}</div>`;
        $('m-treino-nome').value = '';
        return;
    }
    const letters = Object.keys(mData).sort();
    $('m-tabs').innerHTML = letters.map(l =>
        `<button class="chip chip-orange ${l === mLetter ? 'active' : ''}" onclick="mSetLetter('${l}')">Treino ${l}</button>`).join('') +
        (letters.length < 7 ? `<button class="chip" onclick="mAddLetter()">+</button>` : '') +
        (letters.length > 1 ? `<button class="chip" title="Remover este treino" onclick="mDelLetter()">🗑</button>` : '');
    const t = mData[mLetter] || { nome: '', exercicios: [] };
    $('m-treino-nome').value = t.nome || '';
    $('m-exercicios').innerHTML = (t.exercicios || []).map((ex, i) => `
      <div class="ex-row">
        <div class="ex-ico">${tipoIcon(ex.tipo)}</div>
        <div class="ex-nome">
          <input value="${esc(ex.nome)}" onchange="mEdit(${i},'nome',this.value)">
          <span class="ex-tipo">${esc(ex.tipo || '')}</span>
        </div>
        <div class="ex-fields">
          <div class="ex-field"><label>séries</label><input type="number" min="1" value="${ex.series ?? 3}" onchange="mEdit(${i},'series',parseInt(this.value)||1)"></div>
          <div class="ex-field"><label>reps</label><input value="${esc(ex.reps ?? '')}" onchange="mEdit(${i},'reps',this.value)"></div>
          <div class="ex-field"><label>kg</label><input type="number" min="0" step="0.5" value="${ex.carga ?? 0}" onchange="mEdit(${i},'carga',parseFloat(this.value)||0)"></div>
          <div class="ex-field"><label>desc(s)</label><input type="number" min="0" step="5" value="${ex.descanso ?? 60}" onchange="mEdit(${i},'descanso',parseInt(this.value)||0)"></div>
        </div>
        <button class="ex-del" title="Remover" onclick="mRemove(${i})">✕</button>
      </div>`).join('') || '<div class="empty">Nenhum exercício. Adicione pela biblioteca ao lado.</div>';
}
function mSetLetter(l) { mLetter = l; renderMontadorBody(); }
function mAddLetter() {
    if (!mData) return;
    const letters = Object.keys(mData).sort();
    const next = String.fromCharCode(letters[letters.length - 1].charCodeAt(0) + 1);
    mData[next] = { nome: '', exercicios: [] };
    mLetter = next;
    renderMontadorBody();
}
function mDelLetter() {
    if (!mData || Object.keys(mData).length <= 1) return;
    if (!confirm(`Remover o Treino ${mLetter}?`)) return;
    delete mData[mLetter];
    mLetter = Object.keys(mData).sort()[0];
    renderMontadorBody();
}
function montadorRename(v) { if (mData?.[mLetter]) mData[mLetter].nome = v; }
function mEdit(i, k, v) { mData[mLetter].exercicios[i][k] = v; if (k === 'nome') renderMontadorBody(); }
function mRemove(i) { mData[mLetter].exercicios.splice(i, 1); renderMontadorBody(); }
function montadorAddCustom() {
    if (!mData) return toast('Selecione um aluno primeiro', true);
    mData[mLetter].exercicios.push({ nome: 'Novo exercício', tipo: '', series: 3, reps: '8-12', carga: 0, descanso: 60, done: [] });
    renderMontadorBody();
}
function mAddFromLib(idx) {
    if (!mData) return toast('Selecione um aluno primeiro', true);
    const e = library[idx];
    mData[mLetter].exercicios.push({ nome: e.nome, tipo: e.tipo, series: e.series, reps: e.reps, carga: 0, descanso: e.descanso, done: [] });
    renderMontadorBody();
    toast(`${e.nome} adicionado ao Treino ${mLetter}`);
}
function renderLib() {
    const tipos = ['Todos', ...new Set(library.map(e => e.tipo))];
    $('lib-filtros').innerHTML = tipos.map(t =>
        `<button class="chip ${t === mLibFiltro ? 'active' : ''}" onclick="mLibFiltro='${esc(t)}';renderLib()">${esc(t)}</button>`).join('');
    $('lib-list').innerHTML = library.map((e, i) => ({ e, i }))
        .filter(x => mLibFiltro === 'Todos' || x.e.tipo === mLibFiltro)
        .map(({ e, i }) => `
          <div class="row">
            <div class="ex-ico">${tipoIcon(e.tipo)}</div>
            <div class="row-main"><div class="row-title">${esc(e.nome)}</div><div class="row-sub">${esc(e.tipo)} · ${e.series}×${esc(e.reps)}</div></div>
            <button class="lib-add" onclick="mAddFromLib(${i})">+</button>
          </div>`).join('') || '<div class="empty">Biblioteca vazia.</div>';
}
async function montadorSave() {
    if (!mUserId || !mData) return toast('Selecione um aluno primeiro', true);
    try {
        await api.put(`/api/admin/users/${mUserId}/workouts`, mData);
        toast('Treino salvo e enviado ao aluno 💾');
    } catch (e) { toast(e.message, true); }
}
async function montadorReset() {
    if (!mUserId) return;
    if (!confirm('Restaurar o treino padrão? As alterações deste aluno serão perdidas.')) return;
    await api.delete(`/api/admin/users/${mUserId}/workouts`);
    await montadorFor(mUserId);
    toast('Treino padrão restaurado');
}

// ── Administração ────────────────────────────────────────────────────────────
async function renderGestao() {
    trainers = await api.get('/api/admin/trainers');
    $('g-trainers').innerHTML = trainers.map(t => `
      <div class="row clickable" onclick="openTrainerModalEdit(${t.id})">
        ${avatarHtml(t.id + 3, t.username)}
        <div class="row-main"><div class="row-title">${esc(t.username)}</div>
          <div class="row-sub">${t.academia_id == null ? 'Super-admin' : esc(t.academia_nome)}${t.is_active ? '' : ' · desativado'}</div></div>
        <span class="badge ${t.academia_id == null ? 'admin' : 'prof'}">${t.academia_id == null ? 'Admin' : 'Professor'}</span>
      </div>`).join('') || '<div class="empty">Nenhum professor.</div>';
    if (me.is_superadmin) {
        academias = await api.get('/api/admin/academias');
        $('g-academias').innerHTML = academias.map(a => `
          <div class="row clickable" onclick="openAcademiaModalEdit(${a.id})">
            <div class="ex-ico">🏢</div>
            <div class="row-main"><div class="row-title">${esc(a.nome)}</div>
              <div class="row-sub">${esc(a.codigo)} · ${a.users_count} aluno(s) · ${a.trainers_count} professor(es)</div></div>
            <span class="badge ${a.is_active ? 'ativo' : 'inativo'}">${a.is_active ? 'Ativa' : 'Inativa'}</span>
          </div>`).join('') || '<div class="empty">Nenhuma academia.</div>';
    }
}

// ── Modals ───────────────────────────────────────────────────────────────────
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
function fillAcademiaSelect(selId, val) {
    $(selId).innerHTML = '<option value="">— Sem academia —</option>' +
        academias.map(a => `<option value="${a.id}" ${a.id === val ? 'selected' : ''}>${esc(a.nome)}</option>`).join('');
}

// Aluno
function openUserModal() {
    editingUserId = null;
    $('user-modal-title').textContent = 'Novo aluno';
    $('u-username').value = ''; $('u-password').value = ''; $('u-expires').value = '';
    $('u-active').checked = true;
    $('u-pass-hint').style.display = 'none';
    $('u-active-row').style.display = 'none';
    $('u-delete').style.display = 'none';
    if (me.is_superadmin) { $('u-academia-field').style.display = ''; fillAcademiaSelect('u-academia', null); }
    openModal('modal-user');
}
function openUserModalEdit(id) {
    const u = users.find(x => x.id === id);
    if (!u) return;
    editingUserId = id;
    $('user-modal-title').textContent = `Editar ${u.username}`;
    $('u-username').value = u.username;
    $('u-password').value = '';
    $('u-expires').value = u.plan_expires_at ? u.plan_expires_at.slice(0, 10) : '';
    $('u-active').checked = u.is_active;
    $('u-pass-hint').style.display = '';
    $('u-active-row').style.display = '';
    $('u-delete').style.display = '';
    if (me.is_superadmin) { $('u-academia-field').style.display = ''; fillAcademiaSelect('u-academia', u.academia_id); }
    openModal('modal-user');
}
async function saveUser() {
    const body = {
        username: $('u-username').value,
        plan_expires_at: $('u-expires').value ? $('u-expires').value + 'T23:59:59' : null,
    };
    if (me.is_superadmin) body.academia_id = $('u-academia').value ? parseInt($('u-academia').value) : null;
    try {
        if (editingUserId) {
            body.is_active = $('u-active').checked;
            if ($('u-password').value) body.password = $('u-password').value;
            await api.put(`/api/admin/users/${editingUserId}`, body);
        } else {
            body.password = $('u-password').value;
            await api.post('/api/admin/users', body);
        }
        closeModal('modal-user');
        await refreshData();
        showView(currentView === 'aluno' ? 'alunos' : currentView);
        toast('Aluno salvo');
    } catch (e) { toast(e.message, true); }
}
async function deleteUser() {
    const u = users.find(x => x.id === editingUserId);
    if (!confirm(`Excluir o aluno "${u?.username}"? Treinos e histórico serão apagados.`)) return;
    try {
        await api.delete(`/api/admin/users/${editingUserId}`);
        closeModal('modal-user');
        await refreshData();
        showView('alunos');
        toast('Aluno excluído');
    } catch (e) { toast(e.message, true); }
}

// Professor
function openTrainerModal() {
    editingTrainerId = null;
    $('trainer-modal-title').textContent = 'Novo professor';
    $('t-username').value = ''; $('t-password').value = '';
    $('t-active').checked = true;
    $('t-pass-hint').style.display = 'none';
    $('t-active-row').style.display = 'none';
    $('t-delete').style.display = 'none';
    if (me.is_superadmin) { $('t-academia-field').style.display = ''; fillAcademiaSelect('t-academia', null); }
    openModal('modal-trainer');
}
function openTrainerModalEdit(id) {
    const t = trainers.find(x => x.id === id);
    if (!t) return;
    editingTrainerId = id;
    $('trainer-modal-title').textContent = `Editar ${t.username}`;
    $('t-username').value = t.username;
    $('t-password').value = '';
    $('t-active').checked = t.is_active;
    $('t-pass-hint').style.display = '';
    $('t-active-row').style.display = '';
    $('t-delete').style.display = id === me.id ? 'none' : '';
    if (me.is_superadmin) { $('t-academia-field').style.display = ''; fillAcademiaSelect('t-academia', t.academia_id); }
    openModal('modal-trainer');
}
async function saveTrainer() {
    const body = { username: $('t-username').value };
    if ($('t-password').value) body.password = $('t-password').value;
    if (me.is_superadmin) body.academia_id = $('t-academia').value ? parseInt($('t-academia').value) : null;
    try {
        if (editingTrainerId) {
            body.is_active = $('t-active').checked;
            await api.put(`/api/admin/trainers/${editingTrainerId}`, body);
        } else {
            await api.post('/api/admin/trainers', body);
        }
        closeModal('modal-trainer');
        renderGestao();
        toast('Professor salvo');
    } catch (e) { toast(e.message, true); }
}
async function deleteTrainer() {
    const t = trainers.find(x => x.id === editingTrainerId);
    if (!confirm(`Excluir o professor "${t?.username}"?`)) return;
    try {
        await api.delete(`/api/admin/trainers/${editingTrainerId}`);
        closeModal('modal-trainer');
        renderGestao();
        toast('Professor excluído');
    } catch (e) { toast(e.message, true); }
}

// Academia
function openAcademiaModal() {
    editingAcademiaId = null;
    $('academia-modal-title').textContent = 'Nova academia';
    $('a-nome').value = ''; $('a-codigo').value = '';
    $('a-active-row').style.display = 'none';
    $('a-delete').style.display = 'none';
    openModal('modal-academia');
}
function openAcademiaModalEdit(id) {
    const a = academias.find(x => x.id === id);
    if (!a) return;
    editingAcademiaId = id;
    $('academia-modal-title').textContent = `Editar ${a.nome}`;
    $('a-nome').value = a.nome;
    $('a-codigo').value = a.codigo;
    $('a-active').checked = a.is_active;
    $('a-active-row').style.display = '';
    $('a-delete').style.display = '';
    openModal('modal-academia');
}
async function saveAcademia() {
    const body = { nome: $('a-nome').value, codigo: $('a-codigo').value };
    try {
        if (editingAcademiaId) {
            body.is_active = $('a-active').checked;
            await api.put(`/api/admin/academias/${editingAcademiaId}`, body);
        } else {
            await api.post('/api/admin/academias', body);
        }
        closeModal('modal-academia');
        academias = await api.get('/api/admin/academias');
        renderGestao();
        toast('Academia salva');
    } catch (e) { toast(e.message, true); }
}
async function deleteAcademia() {
    const a = academias.find(x => x.id === editingAcademiaId);
    if (!confirm(`Excluir a academia "${a?.nome}"? Alunos e professores ficarão sem vínculo.`)) return;
    try {
        await api.delete(`/api/admin/academias/${editingAcademiaId}`);
        closeModal('modal-academia');
        academias = await api.get('/api/admin/academias');
        renderGestao();
        toast('Academia excluída');
    } catch (e) { toast(e.message, true); }
}
