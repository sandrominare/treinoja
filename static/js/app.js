let DATA = {};
let currentTreino = 'A';
let restTimer = null;
let restRemaining = 0;
let fsOn = false;
let isResting = false;
let currentRestTotal = 0;
let HISTORY = [];
let workoutTimerInterval = null;
let workoutSeconds = 0;
let currentUser = null;
let currentUserStatus = null;
let saveTimer = null;

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
    const r = await fetch(url, options);
    if (r.status === 401) {
        currentUser = null;
        showView('view-login');
        throw new Error('Sessão expirada');
    }
    if (!r.ok) {
        let detail = 'Erro na requisição';
        try { detail = (await r.json()).detail || detail; } catch (_) {}
        throw new Error(detail);
    }
    return r;
}

const api = {
    async get(url) { return (await apiFetch(url)).json(); },
    async post(url, data) {
        return (await apiFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })).json();
    },
    async put(url, data) {
        return (await apiFetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })).json();
    },
    async delete(url) { return (await apiFetch(url, { method: 'DELETE' })).json(); }
};

// ── Auth ─────────────────────────────────────────────────────────────────────

async function performLogin() {
    const username = document.getElementById('login-user').value.trim().toLowerCase();
    const password = document.getElementById('login-pass').value.trim();

    if (!username || !password) { alert('Preencha usuário e senha'); return; }

    try {
        const res = await api.post('/api/auth/login', { username, password });
        currentUser = res.username;
        document.getElementById('login-pass').value = '';
        await initUserData();
    } catch (e) {
        alert(e.message);
    }
}

function showRegister() {
    document.getElementById('reg-user').value = '';
    document.getElementById('reg-pass').value = '';
    document.getElementById('reg-academia').value = '';
    showView('view-register');
}

async function performRegister() {
    const username = document.getElementById('reg-user').value.trim().toLowerCase();
    const password = document.getElementById('reg-pass').value.trim();
    const academiaRaw = document.getElementById('reg-academia').value.trim();
    const academia_codigo = academiaRaw ? academiaRaw.toUpperCase() : null;

    if (!username) { alert('Preencha o usuário'); return; }

    try {
        await api.post('/api/auth/register', { username, password, academia_codigo });
        alert('Usuário criado com sucesso!');
        showView('view-login');
    } catch (e) {
        alert(e.message);
    }
}

async function logout() {
    try { await api.post('/api/auth/logout', {}); } catch (_) {}
    currentUser = null;
    DATA = {};
    HISTORY = [];
    showView('view-login');
}

// ── Data persistence ─────────────────────────────────────────────────────────

function saveData() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try { await api.put('/api/workouts', DATA); } catch (e) { console.error('Erro ao salvar:', e); }
    }, 500);
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function initUserData() {
    try {
        [DATA, HISTORY] = await Promise.all([
            api.get('/api/workouts'),
            api.get('/api/history')
        ]);
    } catch (e) {
        alert('Erro ao carregar dados: ' + e.message);
        return;
    }

    const sel = document.querySelector('#sel-treino');
    sel.innerHTML = '';
    Object.keys(DATA).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = `Treino ${k}`;
        sel.appendChild(opt);
    });

    try {
        const prog = await api.get('/api/progress');
        if (prog && DATA[prog.treino]) {
            currentTreino = prog.treino;
        } else {
            currentTreino = getNextWorkout() || Object.keys(DATA)[0] || 'A';
        }
    } catch (_) {
        currentTreino = getNextWorkout() || Object.keys(DATA)[0] || 'A';
    }

    sel.value = currentTreino;
    render();
    updateRest();
    showHome();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(sec) {
    const m = Math.floor(sec / 60), s = ('0' + Math.floor(sec % 60)).slice(-2);
    return `${m}:${s}`;
}

function getVal(val, i) {
    if (Array.isArray(val)) {
        if (val.length === 0) return '';
        return i - 1 >= val.length ? val[val.length - 1] : val[i - 1];
    }
    return val;
}

// ── Render workout ────────────────────────────────────────────────────────────

function render() {
    const container = document.querySelector('#container');
    container.innerHTML = '';
    const treino = DATA[currentTreino];
    if (!treino) return;

    const title = document.createElement('div');
    title.className = 'small';
    title.textContent = treino.nome;
    container.appendChild(title);

    treino.exercicios.forEach((ex, idx) => {
        const card = document.createElement('div');
        card.className = 'card';

        const header = document.createElement('div');
        header.className = 'card-header';
        const divInfo = document.createElement('div');
        const h3 = document.createElement('h3');
        h3.textContent = ex.nome;
        const sub = document.createElement('div');
        sub.className = 'small';
        const totalSeries = Number(ex.series) || 1;
        sub.textContent = `${totalSeries} séries`;
        divInfo.append(h3, sub);
        const arrow = document.createElement('div');
        arrow.textContent = '▼';
        arrow.id = `ex-arrow-${idx}`;
        header.append(divInfo, arrow);

        const body = document.createElement('div');
        body.className = 'card-body';
        body.style.display = 'none';
        body.id = `ex-body-${idx}`;

        header.onclick = () => {
            const isHidden = body.style.display === 'none';
            toggleExercise(idx, isHidden);
        };

        card.appendChild(header);

        const sets = document.createElement('div');
        sets.className = 'sets';

        for (let i = 1; i <= totalSeries; i++) {
            const valReps = getVal(ex.reps, i);
            const valCarga = getVal(ex.carga, i);
            const valDesc = getVal(ex.descanso, i);

            const left = document.createElement('div');
            left.className = 'badge';
            left.innerHTML = `<span class="kbd">${i}</span>`;

            const reps = document.createElement('div');
            reps.className = 'badge';
            reps.textContent = valReps || '—';

            const carga = document.createElement('div');
            carga.className = 'badge';
            carga.textContent = (valCarga || 0) + ' kg';

            const descanso = document.createElement('div');
            descanso.textContent = valDesc ? fmt(valDesc) : '—';

            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '8px';

            const btnEdit = document.createElement('button');
            btnEdit.textContent = 'Editar';
            btnEdit.onclick = () => openEdit(ex, idx, i);

            const chk = document.createElement('span');
            chk.className = 'checkbox';
            if (ex.done && ex.done[i - 1]) chk.classList.add('done');
            if (isResting) chk.classList.add('disabled');

            chk.onclick = () => {
                if (isResting) return;
                const isChecking = !chk.classList.contains('done');
                if (isChecking) {
                    if (i > 1 && !(ex.done && ex.done[i - 2])) {
                        alert('Complete as séries na ordem correta.');
                        return;
                    }
                } else {
                    if (ex.done && ex.done[i]) {
                        alert('Desmarque as séries posteriores primeiro.');
                        return;
                    }
                }
                chk.classList.toggle('done');
                if (!ex.done) ex.done = [];
                ex.done[i - 1] = chk.classList.contains('done');
                saveData();
                if (chk.classList.contains('done')) {
                    startRest(valDesc || 60, idx, i === totalSeries);
                }
            };

            const btnStart = document.createElement('button');
            btnStart.textContent = 'Timer';
            btnStart.onclick = () => startRest(valDesc || 60, idx, i === totalSeries);

            actions.append(btnEdit, btnStart, chk);
            sets.append(left, reps, carga, descanso, actions);
        }

        body.appendChild(sets);

        if (ex.mensagem) {
            const msg = document.createElement('div');
            msg.className = 'msg';
            msg.textContent = ex.mensagem;
            body.appendChild(msg);
        }

        card.appendChild(body);
        container.appendChild(card);
    });
}

// ── Edit set modal ────────────────────────────────────────────────────────────

function openEdit(ex, idx, seriesIdx) {
    const modal = document.querySelector('#modal');
    modal.style.display = 'flex';
    document.querySelector('#edit-name').textContent = `${ex.nome} (Série ${seriesIdx})`;

    document.querySelector('#edit-carga').value = getVal(ex.carga, seriesIdx) || 0;
    document.querySelector('#edit-reps').value = getVal(ex.reps, seriesIdx) || '';
    document.querySelector('#edit-rest').value = getVal(ex.descanso, seriesIdx) || 60;

    const chkApply = document.querySelector('#edit-applyall');
    chkApply.checked = !(Array.isArray(ex.carga) || Array.isArray(ex.reps) || Array.isArray(ex.descanso));

    document.querySelector('#btn-save').onclick = () => {
        const newCarga = Number(document.querySelector('#edit-carga').value) || 0;
        const newReps = document.querySelector('#edit-reps').value || '';
        const newDesc = Number(document.querySelector('#edit-rest').value) || 60;
        const applyAll = chkApply.checked;

        if (applyAll) {
            ex.carga = newCarga;
            ex.reps = newReps;
            ex.descanso = newDesc;
        } else {
            const totalSeries = Number(ex.series) || 1;
            const ensureArray = (val, fill) => {
                if (Array.isArray(val)) {
                    while (val.length < totalSeries) val.push(val[val.length - 1] || fill);
                    return val;
                }
                return new Array(totalSeries).fill(val !== undefined ? val : fill);
            };
            ex.carga = ensureArray(ex.carga, 0);
            ex.reps = ensureArray(ex.reps, '');
            ex.descanso = ensureArray(ex.descanso, 60);
            ex.carga[seriesIdx - 1] = newCarga;
            ex.reps[seriesIdx - 1] = newReps;
            ex.descanso[seriesIdx - 1] = newDesc;
        }

        saveData();
        render();
        closeModal();
    };
}

function closeModal() { document.querySelector('#modal').style.display = 'none'; }

// ── Rest timer ────────────────────────────────────────────────────────────────

function startRest(sec, exIdx = -1, isLastSeries = false) {
    if (restTimer) clearInterval(restTimer);
    if (!fsOn) toggleFS();

    isResting = true;
    currentRestTotal = sec;
    restRemaining = sec;
    updateCheckboxes();
    updateSkipButton();
    updateRest();

    restTimer = setInterval(() => {
        restRemaining--;
        updateRest();
        if (restRemaining <= 0) {
            clearInterval(restTimer);
            isResting = false;
            updateCheckboxes();
            updateSkipButton();
            beep();
            if (fsOn) toggleFS();
            if (exIdx !== -1 && isLastSeries) {
                toggleExercise(exIdx, false);
                toggleExercise(exIdx + 1, true);
            }
        }
    }, 1000);
}

function toggleExercise(idx, show) {
    const body = document.getElementById(`ex-body-${idx}`);
    const arrow = document.getElementById(`ex-arrow-${idx}`);
    if (body && arrow) {
        body.style.display = show ? 'block' : 'none';
        arrow.textContent = show ? '▲' : '▼';
        if (show) setTimeout(() => body.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
}

function skipRest() {
    if (restTimer) clearInterval(restTimer);
    restRemaining = 0;
    updateRest();
    isResting = false;
    updateCheckboxes();
    updateSkipButton();
    if (fsOn) toggleFS();
}

function updateCheckboxes() {
    document.querySelectorAll('.checkbox').forEach(c => {
        if (isResting) c.classList.add('disabled');
        else c.classList.remove('disabled');
    });
}

function updateSkipButton() {
    const btn = document.getElementById('btn-skip');
    if (btn) btn.style.display = isResting ? 'inline-block' : 'none';
}

function updateRest() {
    const t = document.querySelector('#rest-time');
    if (t) t.textContent = fmt(Math.max(restRemaining, 0));

    const fsTime = document.querySelector('#fs-time');
    if (fsTime) fsTime.textContent = Math.max(restRemaining, 0);

    const circle = document.querySelector('.donut-segment');
    if (circle && currentRestTotal > 0) {
        const circumference = 2 * Math.PI * 45;
        const offset = circumference - (Math.max(restRemaining, 0) / currentRestTotal) * circumference;
        circle.style.strokeDashoffset = offset;
    }
}

function beep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 1000;
        o.connect(g);
        g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.01);
        o.start();
        setTimeout(() => { o.stop(); ctx.close(); }, 600);
    } catch (_) {}
}

function toggleFS() {
    const fs = document.querySelector('#fs');
    fsOn = !fsOn;
    fs.style.display = fsOn ? 'flex' : 'none';
    document.querySelector('#fs-time').textContent = document.querySelector('#rest-time').textContent;
}

// ── Workout logic ─────────────────────────────────────────────────────────────

function getNextWorkout() {
    const keys = Object.keys(DATA).sort();
    if (!keys.length) return null;
    if (!HISTORY.length) return keys[0];
    const lastKey = HISTORY[0].treino;
    const idx = keys.indexOf(lastKey);
    return keys[(idx === -1 ? 0 : idx + 1) % keys.length];
}

function renderHome() {
    const nextKey = getNextWorkout();
    const letter = document.getElementById('home-next-letter');
    const name = document.getElementById('home-next-name');
    const btn = document.querySelector('#view-home .accent.big-btn');
    const warning = document.getElementById('home-warning');

    // Account or plan status
    if (currentUserStatus && !currentUserStatus.is_active) {
        letter.textContent = '⚠';
        name.textContent = 'Conta suspensa. Contate seu professor.';
        name.style.color = '#ef4444';
        if (btn) btn.disabled = true;
        if (warning) warning.style.display = 'none';
        return;
    }
    if (currentUserStatus?.plan_expired) {
        const expDate = currentUserStatus.plan_expires_at
            ? new Date(currentUserStatus.plan_expires_at).toLocaleDateString('pt-BR')
            : '';
        letter.textContent = '⏰';
        name.textContent = `Plano vencido${expDate ? ' em ' + expDate : ''}. Contate seu professor.`;
        name.style.color = '#f59e0b';
        if (btn) btn.disabled = true;
        if (warning) warning.style.display = 'none';
        return;
    }

    if (btn) btn.disabled = false;
    name.style.color = '';

    if (!nextKey) return;
    letter.textContent = nextKey;
    name.textContent = DATA[nextKey]?.nome || '';

    // Expiry warning (7 days)
    if (currentUserStatus?.plan_expires_at && warning) {
        const daysLeft = Math.ceil((new Date(currentUserStatus.plan_expires_at) - new Date()) / 86400000);
        if (daysLeft <= 7 && daysLeft > 0) {
            warning.textContent = `⚠ Plano vence em ${daysLeft} dia(s).`;
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
    }

    const count = HISTORY.length;
    document.getElementById('home-stats-count').textContent = count;

    let sinceText = 'desde -';
    if (count > 0) {
        const first = HISTORY[HISTORY.length - 1];
        if (first?.date) {
            sinceText = `desde ${new Date(first.date).toLocaleDateString('pt-BR')}`;
        }
    }
    document.getElementById('home-stats-since').textContent = sinceText;
}

function renderHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    if (!HISTORY.length) {
        list.innerHTML = '<div style="text-align:center; color:var(--muted); margin-top:20px;">Nenhum treino registrado.</div>';
        return;
    }
    HISTORY.forEach(h => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const date = new Date(h.date);
        item.innerHTML = `
            <div>
                <div class="history-name">Treino ${h.treino}</div>
                <div class="small">${DATA[h.treino]?.nome || ''}</div>
            </div>
            <div class="history-date">
                ${date.toLocaleDateString('pt-BR')}
                <br>
                ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>`;
        list.appendChild(item);
    });
}

async function startWorkout() {
    const nextKey = getNextWorkout();
    if (!nextKey) return;

    try {
        const prog = await api.get('/api/progress');
        if (prog && prog.treino && prog.treino !== nextKey) {
            if (DATA[prog.treino]?.exercicios) {
                DATA[prog.treino].exercicios.forEach(ex => { ex.done = []; });
            }
        }
        await api.put('/api/progress', { treino: nextKey });
    } catch (_) {}

    currentTreino = nextKey;
    saveData();

    const sel = document.getElementById('sel-treino');
    if (sel) sel.value = currentTreino;
    render();
    startWorkoutTimer();
    showView('view-workout');
}

async function finishWorkout() {
    if (!confirm('Deseja finalizar o treino?')) return;

    stopWorkoutTimer();

    const entry = {
        date: new Date().toISOString(),
        treino: currentTreino,
        duration: workoutSeconds
    };

    try {
        await api.post('/api/history', entry);
        HISTORY.unshift(entry);
    } catch (e) {
        alert('Erro ao salvar histórico: ' + e.message);
    }

    if (DATA[currentTreino]?.exercicios) {
        DATA[currentTreino].exercicios.forEach(ex => { ex.done = []; });
        saveData();
    }

    try { await api.delete('/api/progress'); } catch (_) {}

    document.querySelectorAll('.checkbox').forEach(c => c.classList.remove('done'));
    showHome();
}

function startWorkoutTimer() {
    if (workoutTimerInterval) clearInterval(workoutTimerInterval);
    workoutSeconds = 0;
    updateWorkoutTimerDisplay();
    workoutTimerInterval = setInterval(() => {
        workoutSeconds++;
        updateWorkoutTimerDisplay();
    }, 1000);
}

function stopWorkoutTimer() {
    if (workoutTimerInterval) clearInterval(workoutTimerInterval);
}

function updateWorkoutTimerDisplay() {
    const el = document.getElementById('workout-time');
    if (el) el.textContent = fmt(workoutSeconds);
}

// ── Edit workout ──────────────────────────────────────────────────────────────

function renderEditWorkout() {
    const list = document.getElementById('edit-list');
    list.innerHTML = '';
    const treino = DATA[currentTreino];
    if (!treino?.exercicios) return;

    treino.exercicios.forEach((ex, idx) => {
        const item = document.createElement('div');
        item.className = 'card';
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px;';

        const info = document.createElement('div');
        info.innerHTML = `<div style="font-weight:bold">${ex.nome}</div><div class="small">${ex.series} séries • ${ex.reps} reps</div>`;

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px;';

        const btnUp = document.createElement('button');
        btnUp.textContent = '⬆️';
        btnUp.style.padding = '6px 10px';
        btnUp.disabled = idx === 0;
        if (idx === 0) btnUp.style.opacity = '0.3';
        btnUp.onclick = () => moveExercise(idx, -1);

        const btnDown = document.createElement('button');
        btnDown.textContent = '⬇️';
        btnDown.style.padding = '6px 10px';
        btnDown.disabled = idx === treino.exercicios.length - 1;
        if (idx === treino.exercicios.length - 1) btnDown.style.opacity = '0.3';
        btnDown.onclick = () => moveExercise(idx, 1);

        const btnEdit = document.createElement('button');
        btnEdit.textContent = '✏️';
        btnEdit.onclick = () => openExerciseModal(idx);

        const btnDel = document.createElement('button');
        btnDel.textContent = '🗑️';
        btnDel.style.cssText = 'background:#e74c3c; border:none;';
        btnDel.onclick = () => deleteExercise(idx);

        actions.append(btnUp, btnDown, btnEdit, btnDel);
        item.append(info, actions);
        list.appendChild(item);
    });
}

function moveExercise(idx, direction) {
    const exs = DATA[currentTreino].exercicios;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= exs.length) return;
    [exs[idx], exs[newIdx]] = [exs[newIdx], exs[idx]];
    saveData();
    renderEditWorkout();
    render();
}

function deleteExercise(idx) {
    if (!confirm('Excluir exercício?')) return;
    DATA[currentTreino].exercicios.splice(idx, 1);
    saveData();
    renderEditWorkout();
    render();
}

function addExercise() { openExerciseModal(-1); }

function openExerciseModal(idx) {
    const modal = document.getElementById('modal-exercise');
    modal.style.display = 'flex';
    const isNew = idx === -1;
    const ex = isNew
        ? { nome: '', tipo: '', series: 3, reps: '10', carga: 0, descanso: 60, mensagem: '' }
        : DATA[currentTreino].exercicios[idx];

    document.getElementById('ex-name').value = ex.nome || '';
    document.getElementById('ex-type').value = ex.tipo || '';
    document.getElementById('ex-series').value = ex.series || 3;
    document.getElementById('ex-reps').value = ex.reps || '';
    document.getElementById('ex-carga').value = ex.carga || 0;
    document.getElementById('ex-rest').value = ex.descanso || 60;
    document.getElementById('ex-msg').value = ex.mensagem || '';

    document.getElementById('btn-save-ex').onclick = () => {
        const newEx = {
            nome: document.getElementById('ex-name').value,
            tipo: document.getElementById('ex-type').value,
            series: Number(document.getElementById('ex-series').value),
            reps: document.getElementById('ex-reps').value,
            carga: Number(document.getElementById('ex-carga').value),
            descanso: Number(document.getElementById('ex-rest').value),
            mensagem: document.getElementById('ex-msg').value
        };
        if (!newEx.nome) { alert('Nome é obrigatório'); return; }
        if (isNew) {
            if (!DATA[currentTreino].exercicios) DATA[currentTreino].exercicios = [];
            DATA[currentTreino].exercicios.push(newEx);
        } else {
            DATA[currentTreino].exercicios[idx] = newEx;
        }
        saveData();
        renderEditWorkout();
        render();
        closeExerciseModal();
    };
}

function closeExerciseModal() { document.getElementById('modal-exercise').style.display = 'none'; }

// ── Navigation ────────────────────────────────────────────────────────────────

function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById(id);
    const centered = ['view-home', 'view-login', 'view-register'];
    view.style.display = centered.includes(id) ? 'flex' : 'block';
    window.scrollTo(0, 0);
}

function showHome() { stopWorkoutTimer(); renderHome(); showView('view-home'); }
function showHistory() { renderHistory(); showView('view-history'); }
function showEditWorkout() { renderEditWorkout(); showView('view-edit-workout'); }

// ── Backup / Restore ──────────────────────────────────────────────────────────

async function exportData() {
    try {
        const r = await apiFetch('/api/backup/export');
        const blob = await r.blob();
        const cd = r.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : 'backup.json';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Erro ao exportar: ' + e.message);
    }
}

async function processImport(input) {
    const file = input.files[0];
    if (!file) return;
    if (!confirm('Isso irá substituir os dados atuais pelos do arquivo de backup. Deseja continuar?')) {
        input.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const r = await apiFetch('/api/backup/import', { method: 'POST', body: formData });
        const res = await r.json();
        alert(res.message);
        input.value = '';
        await initUserData();
    } catch (e) {
        alert('Erro ao restaurar: ' + e.message);
        input.value = '';
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
    const sel = document.querySelector('#sel-treino');
    sel.onchange = () => { currentTreino = sel.value; render(); };

    try {
        const me = await api.get('/api/auth/me');
        currentUser = me.username;
        currentUserStatus = me;
        await initUserData();
    } catch (_) {
        showView('view-login');
    }
});
