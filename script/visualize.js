/**
 * Dormitoration - Data Visualization & Analytics Script
 * File: /script/visualize.js
 *
 * Shows REAL data only: door scans (access_logs), door-unit status (rooms + device_events)
 * and three anomaly rules. Nothing on this page is made up; with no data it says so.
 */

const METHOD_LABELS = { qr: 'QR code', rfid: 'RFID card', keycode: 'Keypad PIN', exit: 'Exit button' };
const METHOD_COLORS = { qr: '#47f59b', rfid: '#60a5fa', keycode: '#fb923c', exit: '#facc15' };
const BASE_METHODS = ['qr', 'rfid'];          // always shown; other methods appear when they send data
const GRANTED_COLOR = '#34d399';
const DENIED_COLOR = '#f87171';
const REASON_LABELS = { unknown_code: 'Unknown code', unknown_card: 'Unregistered card', expired: 'Code expired' };

// Different data, different refresh rate (Chapter 5, slide 20): status moves fast, charts do not.
const HARDWARE_REFRESH_MS = 20 * 1000;
const OVERVIEW_REFRESH_MS = 2 * 60 * 1000;
const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

let currentRange = '7d';
let lastOverview = null;
const charts = { method: null, hourly: null, scatter: null };

/* ---------------- small helpers ---------------- */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function getAdminId() {
    try {
        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
        return userData.id || userData.user_id || null;
    } catch (e) {
        return null;
    }
}

function methodLabel(method) { return METHOD_LABELS[method] || method || 'Unknown'; }
function methodColor(method) { return METHOD_COLORS[method] || '#a78bfa'; }

// QR and RFID always get a lane; any other method that has data gets one too.
function lanesFor(o) {
    const extra = new Set();
    o.by_method.forEach(m => extra.add(m.method));
    o.hourly.forEach(h => extra.add(h.method));
    o.points.forEach(p => extra.add(p.method));
    BASE_METHODS.forEach(m => extra.delete(m));
    return [...BASE_METHODS, ...[...extra].filter(Boolean).sort()];
}

function hourOfDay(localTime) {
    const m = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):(\d{2})$/.exec(localTime || '');
    return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600 : null;
}

function dayTime(local) { return local ? local.slice(0, 16) : ''; }

// The server stores some timestamps as UTC ISO text inside messages; show them in Malaysia time.
function localizeIsoTimes(text) {
    return String(text || '').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, iso => {
        const ms = Date.parse(iso);
        return Number.isNaN(ms) ? iso : new Date(ms + MY_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
    });
}

function relativeAgo(seconds) {
    if (seconds === null || seconds === undefined) return 'unknown';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
    return Math.floor(seconds / 86400) + ' d ago';
}

function showError(text) {
    const box = document.getElementById('vizError');
    box.textContent = text;
    box.style.display = '';
}

function hideError() {
    document.getElementById('vizError').style.display = 'none';
}

/* ---------------- charts ---------------- */

function isLight() { return document.body.classList.contains('light-mode'); }

// Theme.js only ever adds/removes "light-mode", so that is the class to test.
function chartTheme() {
    const css = getComputedStyle(document.body).getPropertyValue('--text-color').trim();
    return {
        text: css || (isLight() ? '#1e293b' : '#bcfcd2'),
        grid: isLight() ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'
    };
}

function destroyChart(key) {
    if (charts[key]) {
        charts[key].destroy();
        charts[key] = null;
    }
}

// message = text to show instead of the chart; null = show the chart
function setChartState(canvasId, emptyId, message) {
    const canvas = document.getElementById(canvasId);
    const empty = document.getElementById(emptyId);
    if (message) {
        canvas.style.display = 'none';
        empty.textContent = message;
        empty.style.display = 'flex';
    } else {
        canvas.style.display = '';
        empty.style.display = 'none';
    }
}

// Returns true if the chart was drawn
function drawChart(key, canvasId, emptyId, config) {
    destroyChart(key);
    if (typeof Chart === 'undefined') {
        setChartState(canvasId, emptyId, 'The chart library could not be loaded. Check your internet connection and refresh.');
        return false;
    }
    setChartState(canvasId, emptyId, null);
    charts[key] = new Chart(document.getElementById(canvasId), config);
    return true;
}

function renderMethodChart(o) {
    if (o.kpis.total === 0) {
        destroyChart('method');
        setChartState('methodChart', 'methodEmpty', 'No scans in this period yet.');
        return;
    }
    const t = chartTheme();
    const lanes = lanesFor(o);
    const by = Object.fromEntries(o.by_method.map(m => [m.method, m]));

    drawChart('method', 'methodChart', 'methodEmpty', {
        type: 'bar',
        data: {
            labels: lanes.map(methodLabel),
            datasets: [
                { label: 'Granted', data: lanes.map(m => (by[m] ? by[m].granted : 0)), backgroundColor: GRANTED_COLOR },
                { label: 'Denied', data: lanes.map(m => (by[m] ? by[m].total - by[m].granted : 0)), backgroundColor: DENIED_COLOR }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: t.text }, grid: { color: t.grid } },
                // Bars must start at zero (Chapter 5, slide 22: never truncate the axis)
                y: { beginAtZero: true, ticks: { color: t.text, precision: 0 }, grid: { color: t.grid }, title: { display: true, text: 'Number of scans', color: t.text } }
            },
            plugins: { legend: { labels: { color: t.text } } }
        }
    });
}

function renderHourlyChart(o) {
    if (o.kpis.total === 0) {
        destroyChart('hourly');
        setChartState('hourlyChart', 'hourlyEmpty', 'No scans in this period yet.');
        return;
    }
    const t = chartTheme();
    const lanes = lanesFor(o);
    const labels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

    drawChart('hourly', 'hourlyChart', 'hourlyEmpty', {
        type: 'bar',
        data: {
            labels,
            datasets: lanes.map(m => {
                const counts = new Array(24).fill(0);
                o.hourly.filter(h => h.method === m).forEach(h => { if (h.hr >= 0 && h.hr < 24) counts[h.hr] = h.n; });
                return { label: methodLabel(m), data: counts, backgroundColor: methodColor(m) };
            })
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, ticks: { color: t.text }, grid: { color: t.grid }, title: { display: true, text: 'Hour of day (Malaysia time)', color: t.text } },
                y: { stacked: true, beginAtZero: true, ticks: { color: t.text, precision: 0 }, grid: { color: t.grid }, title: { display: true, text: 'Number of scans', color: t.text } }
            },
            plugins: { legend: { labels: { color: t.text } } }
        }
    });
}

function renderScatter(o) {
    const note = document.getElementById('scatterNote');
    if (o.points.length === 0) {
        destroyChart('scatter');
        setChartState('scatterChart', 'scatterEmpty', 'No scans in this period yet.');
        note.style.display = 'none';
        return;
    }

    const t = chartTheme();
    const lanes = lanesFor(o);
    const byLane = lanes.map(() => []);

    for (const p of o.points) {
        const lane = lanes.indexOf(p.method);
        const x = hourOfDay(p.local_time);
        if (lane < 0 || x === null) continue;
        // A small, repeatable offset so dots from the same minute do not hide each other
        const jitter = ((((Number(p.id) || 0) * 37) % 100) / 100 - 0.5) * 0.5;
        byLane[lane].push({ x, y: lane + jitter, t: p.local_time.slice(11, 16), day: p.local_time.slice(0, 10), ok: p.success });
    }

    drawChart('scatter', 'scatterChart', 'scatterEmpty', {
        type: 'scatter',
        data: {
            datasets: lanes.map((m, i) => ({
                label: methodLabel(m),
                data: byLane[i],
                // Semi-transparent dots: where many overlap the colour gets darker, which shows density
                backgroundColor: byLane[i].map(d => (d.ok ? methodColor(m) + '99' : DENIED_COLOR + 'dd')),
                borderColor: byLane[i].map(d => (d.ok ? methodColor(m) : DENIED_COLOR)),
                pointStyle: byLane[i].map(d => (d.ok ? 'circle' : 'rectRot')),
                pointRadius: 4,
                pointHoverRadius: 7
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear', min: 0, max: 24,
                    ticks: { stepSize: 2, color: t.text, callback: v => String(v).padStart(2, '0') + ':00' },
                    grid: { color: t.grid },
                    title: { display: true, text: 'Time of day (Malaysia time)', color: t.text }
                },
                y: {
                    min: -0.6, max: lanes.length - 0.4,
                    ticks: { stepSize: 1, color: t.text, callback: v => (Number.isInteger(v) && lanes[v] ? methodLabel(lanes[v]) : '') },
                    grid: { color: t.grid }
                }
            },
            plugins: {
                legend: { labels: { color: t.text } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} \u00B7 ${ctx.raw.day} ${ctx.raw.t} \u00B7 ${ctx.raw.ok ? 'Granted' : 'Denied'}` } }
            }
        }
    });

    if (o.points_truncated) {
        note.textContent = 'Showing the latest 2,000 scans of this period. The other charts count all of them.';
        note.style.display = '';
    } else {
        note.style.display = 'none';
    }
}

/* ---------------- summary numbers, anomalies, log ---------------- */

function renderKpis(o) {
    document.getElementById('kpiTotal').textContent = o.kpis.total;
    document.getElementById('kpiRate').textContent = o.kpis.success_rate === null ? '\u2013' : o.kpis.success_rate + '%';
    document.getElementById('kpiDenied').textContent = o.kpis.denied;
}

function fillAnomalyList(listId, countId, items, total, buildItem, emptyText, extraNote) {
    const list = document.getElementById(listId);
    list.innerHTML = '';
    const badge = document.getElementById(countId);
    badge.textContent = total;
    badge.className = 'count-badge' + (total > 0 ? ' alert' : '');

    if (items.length === 0) {
        list.appendChild(el('p', 'muted-line', emptyText));
        return;
    }
    items.forEach(it => list.appendChild(buildItem(it)));
    if (total > items.length) list.appendChild(el('p', 'muted-line', `Showing the latest ${items.length} of ${total}.`));
    if (extraNote) list.appendChild(el('p', 'muted-line', extraNote));
}

function renderAnomalies(o) {
    const c = o.config;
    const windows = c.unusual_windows.map(w => `${w.start}\u2013${w.end}`).join(', ');
    const summary = document.getElementById('ruleSummary');
    summary.textContent = '';
    summary.append(
        `Rules: scans between ${windows} (Malaysia time${c.unusual_is_default ? ', default' : ''}); ` +
        `${c.burst.fails}+ denied scans at one door within ${c.burst.minutes} minutes; ` +
        `a door unit silent for more than ${c.silent_minutes} minutes. `
    );
    const link = el('a', 'rule-link', 'Change the unusual-hours windows');
    link.href = '/admin/setting.html';
    summary.appendChild(link);

    const a = o.anomalies;

    fillAnomalyList('listUnusual', 'countUnusual', a.unusual_hours.items, a.unusual_hours.total, it => {
        const row = el('div', 'anomaly-item');
        row.appendChild(el('span', '', `${dayTime(it.local_time)} \u00B7 ${it.who}`));
        row.appendChild(el('span', 'item-meta', `${it.door} \u00B7 ${methodLabel(it.method)} \u00B7 ${it.success ? 'Granted' : 'Denied'}`));
        return row;
    }, 'No scans inside the unusual-hours windows.');

    fillAnomalyList('listBursts', 'countBursts', a.bursts, a.bursts.length, b => {
        const row = el('div', 'anomaly-item red');
        row.appendChild(el('span', '', `${b.door}: ${b.count} denied scans`));
        const sameDay = b.start_local.slice(0, 10) === b.end_local.slice(0, 10);
        row.appendChild(el('span', 'item-meta', `${dayTime(b.start_local)} to ${sameDay ? b.end_local.slice(11, 16) : dayTime(b.end_local)}`));
        return row;
    }, 'No bursts of denied scans.', a.bursts_truncated ? 'Only the 5,000 most recent denied scans were checked.' : null);

    fillAnomalyList('listSilent', 'countSilent', a.silent, a.silent.length, s => {
        const row = el('div', 'anomaly-item red');
        row.appendChild(el('span', '', `${s.door}: stopped sending heartbeats`));
        const state = s.ongoing ? 'still offline' : `back online ${dayTime(s.recovered_local)}`;
        row.appendChild(el('span', 'item-meta', `Detected ${dayTime(s.detected_local)} \u00B7 ${state}`));
        if (s.detail) row.appendChild(el('span', 'item-meta', localizeIsoTimes(s.detail)));
        return row;
    }, 'No door unit went silent.');
}

function renderLogs(o) {
    const body = document.getElementById('logBody');
    body.innerHTML = '';
    document.getElementById('logNote').textContent = o.logs.length === 0
        ? 'Latest scans in the selected period.'
        : `Latest ${o.logs.length} scans in the selected period.`;

    if (o.logs.length === 0) {
        const tr = el('tr');
        const td = el('td', 'muted-cell', 'No scans in this period yet.');
        td.colSpan = 5;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }

    o.logs.forEach(l => {
        const tr = el('tr');
        tr.appendChild(el('td', '', l.local_time));
        tr.appendChild(el('td', '', l.door));
        tr.appendChild(el('td', '', methodLabel(l.method)));
        tr.appendChild(el('td', '', l.who));
        const outcome = el('td');
        outcome.appendChild(el('span', l.success ? 'pill ok' : 'pill bad', l.success ? 'Granted' : 'Denied'));
        if (!l.success && l.reason && REASON_LABELS[l.reason]) outcome.appendChild(el('span', 'item-meta', ' ' + REASON_LABELS[l.reason]));
        tr.appendChild(outcome);
        body.appendChild(tr);
    });
}

function renderOverview(o) {
    renderKpis(o);
    renderMethodChart(o);
    renderHourlyChart(o);
    renderScatter(o);
    renderAnomalies(o);
    renderLogs(o);
}

/* ---------------- hardware status ---------------- */

function renderHardware(hw) {
    const units = document.getElementById('hwUnits');
    units.innerHTML = '';
    if (hw.rooms.length === 0) {
        units.appendChild(el('p', 'muted-line', 'No door unit has connected yet. A unit appears here after its first heartbeat.'));
    }
    hw.rooms.forEach(r => {
        const row = el('div', 'hw-row');
        const left = el('div');
        left.appendChild(el('div', 'hw-name', r.label));
        const meta = el('div', 'hw-meta', 'Last heartbeat ' + relativeAgo(r.seconds_since));
        if (r.last_seen_local) meta.title = r.last_seen_local + ' (Malaysia time)';
        left.appendChild(meta);
        row.appendChild(left);
        row.appendChild(el('span', r.online ? 'pill ok' : 'pill bad', r.online ? 'Online' : 'Offline'));
        units.appendChild(row);
    });

    const online = hw.rooms.filter(r => r.online).length;
    document.getElementById('kpiRooms').textContent = hw.rooms.length === 0 ? '\u2013' : `${online} / ${hw.rooms.length}`;

    const hist = document.getElementById('hwHistory');
    hist.innerHTML = '';
    if (!hw.history_ready) {
        hist.appendChild(el('p', 'muted-line', 'The history table does not exist yet. Run visualize_migration.sql in D1.'));
        return;
    }
    if (hw.events.length === 0) {
        hist.appendChild(el('p', 'muted-line', 'No online/offline changes recorded yet. History starts from the day this feature was switched on.'));
        return;
    }
    hw.events.forEach(e => {
        const item = el('div', 'hw-event');
        item.appendChild(el('span', e.event === 'online' ? 'pill ok' : 'pill bad', e.event === 'online' ? 'Online' : 'Offline'));
        item.appendChild(el('span', '', ` ${e.door}`));
        item.appendChild(el('span', 'hw-meta', `${dayTime(e.local_time)}${e.detail ? ' \u00B7 ' + localizeIsoTimes(e.detail) : ''}`));
        hist.appendChild(item);
    });
}

/* ---------------- loading ---------------- */

async function loadOverview() {
    const adminId = getAdminId();
    if (!adminId) {
        showError('Please log in as an admin to see this page.');
        return;
    }
    try {
        const res = await fetch(`/api/admin/visualize/overview?admin_id=${encodeURIComponent(adminId)}&range=${encodeURIComponent(currentRange)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.error || `Could not load the data (error ${res.status}).`);
            return;
        }
        hideError();
        lastOverview = data;
        renderOverview(data);
        document.getElementById('updatedAt').textContent = 'Updated ' + new Date(Date.parse(data.generated_at) + MY_OFFSET_MS).toISOString().slice(11, 16);
    } catch (err) {
        console.error('Visualize overview error:', err);
        showError('Network error. Could not load the data.');
    }
}

async function loadHardware() {
    const adminId = getAdminId();
    const units = document.getElementById('hwUnits');
    if (!adminId) {
        units.innerHTML = '';
        units.appendChild(el('p', 'muted-line', 'Please log in as an admin to see hardware status.'));
        return;
    }
    try {
        const res = await fetch(`/api/admin/visualize/hardware?admin_id=${encodeURIComponent(adminId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            units.innerHTML = '';
            units.appendChild(el('p', 'muted-line', data.error || `Could not load hardware status (error ${res.status}).`));
            return;
        }
        renderHardware(data);
    } catch (err) {
        console.error('Visualize hardware error:', err);
        units.innerHTML = '';
        units.appendChild(el('p', 'muted-line', 'Network error. Could not load hardware status.'));
    }
}

/* ---------------- init ---------------- */

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.range-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.range-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentRange = tab.dataset.range;
            loadOverview();
        });
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadOverview();
        loadHardware();
    });

    // Redraw the charts with matching colours when the theme is switched
    new MutationObserver(() => {
        if (lastOverview) {
            renderMethodChart(lastOverview);
            renderHourlyChart(lastOverview);
            renderScatter(lastOverview);
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    loadOverview();
    loadHardware();

    // Skip refreshing while the tab is hidden, so an open-but-forgotten tab does not keep querying the database
    setInterval(() => { if (!document.hidden) loadHardware(); }, HARDWARE_REFRESH_MS);
    setInterval(() => { if (!document.hidden) loadOverview(); }, OVERVIEW_REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadHardware(); });
});