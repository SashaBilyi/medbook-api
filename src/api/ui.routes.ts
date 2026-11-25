import type { FastifyInstance } from 'fastify';

const FAVICON_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1e40af"/><path d="M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7z" fill="#fff"/></svg>',
  );

const UI_HTML = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="MedBook — онлайн-запис пацієнтів до лікарів, актуальний розклад вільних слотів та швидке бронювання." />
  <title>MedBook — Запис до лікаря</title>
  <link rel="icon" href="${FAVICON_SVG}" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      line-height: 1.45;
    }
    .topbar {
      background: #1e40af;
      color: #ffffff;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      min-height: 60px;
    }
    .topbar h1 { margin: 0; font-size: 20px; }
    .badge { font-size: 13px; color: #ffffff; font-weight: 500; }
    .container { max-width: 1100px; margin: 20px auto; padding: 0 16px; }
    .banner {
      background: #e0f2fe;
      color: #0c4a6e;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
      min-height: 54px;
      display: flex;
      align-items: center;
    }
    .panel {
      background: #ffffff;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    .panel h2 { margin: 0 0 12px; font-size: 17px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { font-size: 13px; font-weight: 600; color: #334155; }
    .form-row input, .form-row select {
      padding: 8px 12px;
      border: 1px solid #94a3b8;
      border-radius: 6px;
      font-size: 14px;
      background: #ffffff;
      color: #0f172a;
    }
    .btn {
      padding: 9px 16px;
      background: #1d4ed8;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }
    .btn:disabled { background: #64748b; cursor: not-allowed; }
    .status-msg { margin-top: 8px; font-size: 14px; color: #334155; min-height: 20px; }
    .vitals-grid { font-size: 14px; color: #1e293b; min-height: 22px; }
    .controls { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
    .pager { display: flex; gap: 8px; align-items: center; }
    .table-wrap { min-height: 760px; overflow-x: auto; }
    .schedule-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .schedule-table th, .schedule-table td {
      border-bottom: 1px solid #e2e8f0;
      padding: 7px 10px;
      text-align: left;
      height: 34px;
    }
    .status-free { color: #15803d; font-weight: 700; }
    .status-booked { color: #b91c1c; font-weight: 600; }
  </style>
  <script src="/ui/app.js" defer></script>
</head>
<body>
  <header class="topbar">
    <h1>MedBook — Онлайн-запис до лікарів</h1>
    <div id="version-badge" class="badge">medbook-api v1.0.0</div>
  </header>

  <main class="container">
    <section id="stats-banner" class="banner" aria-live="polite">
      Завантаження актуальних вільних слотів клініки...
    </section>

    <section class="panel">
      <h2>Швидке бронювання</h2>
      <form id="booking-form" class="form-row">
        <div class="field">
          <label for="schedule-id">ID слоту</label>
          <input id="schedule-id" type="number" min="1" placeholder="Напр. 3" required />
        </div>
        <div class="field">
          <label for="patient-name">ПІБ пацієнта</label>
          <input id="patient-name" type="text" placeholder="Іван Франко" required minlength="2" />
        </div>
        <button class="btn" type="submit">Забронювати</button>
      </form>
      <div id="booking-status" class="status-msg" role="status"></div>
    </section>

    <section class="panel">
      <h2>Web Vitals (Live)</h2>
      <div id="vitals-output" class="vitals-grid">Збір метрик...</div>
    </section>

    <section class="panel">
      <div class="controls">
        <h2>Вільні слоти розкладу</h2>
        <div class="form-row">
          <div class="field">
            <label for="doctor-filter">Лікар</label>
            <select id="doctor-filter">
              <option value="">Усі лікарі</option>
            </select>
          </div>
          <div class="pager">
            <button id="prev-page" class="btn" type="button" disabled>Назад</button>
            <span id="page-label">Стор. 1</span>
            <button id="next-page" class="btn" type="button">Далі</button>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="schedule-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Лікар</th>
              <th>Спеціалізація</th>
              <th>Час</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody id="schedules-body">
            <tr><td colspan="5">Завантаження розкладу...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`;

const UI_JS = `(function () {
  var PAGE_SIZE = 20;
  var currentOffset = 0;
  var currentDoctorId = '';

  window.__webVitals = { ttfb: null, fcp: null, lcp: null, cls: 0 };

  function renderVitals() {
    var el = document.getElementById('vitals-output');
    if (!el) return;
    var v = window.__webVitals;
    el.textContent =
      'TTFB: ' + (v.ttfb !== null ? v.ttfb.toFixed(1) + ' ms' : '...') +
      ' | FCP: ' + (v.fcp !== null ? v.fcp.toFixed(1) + ' ms' : '...') +
      ' | LCP: ' + (v.lcp !== null ? v.lcp.toFixed(1) + ' ms' : '...') +
      ' | CLS: ' + v.cls.toFixed(4);
  }

  try {
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav) window.__webVitals.ttfb = nav.responseStart;

    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        if (entry.name === 'first-contentful-paint') {
          window.__webVitals.fcp = entry.startTime;
          renderVitals();
        }
      });
    }).observe({ type: 'paint', buffered: true });

    new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      var last = entries[entries.length - 1];
      if (last) {
        window.__webVitals.lcp = last.startTime;
        renderVitals();
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        if (!entry.hadRecentInput) {
          window.__webVitals.cls += entry.value;
          renderVitals();
        }
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {
    // PerformanceObserver may be unsupported
  }

  async function loadSchedulesPage() {
    var params = new URLSearchParams({
      availableOnly: 'true',
      limit: String(PAGE_SIZE),
      offset: String(currentOffset),
    });
    if (currentDoctorId) {
      params.set('doctorId', currentDoctorId);
    }

    var res = await fetch('/api/schedules?' + params.toString());
    var schedules = await res.json();

    var tbody = document.getElementById('schedules-body');
    if (tbody) {
      if (schedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Вільних слотів не знайдено.</td></tr>';
      } else {
        tbody.innerHTML = schedules
          .map(function (s) {
            var cls = s.isBooked ? 'status-booked' : 'status-free';
            var label = s.isBooked ? 'Зайнято' : 'Вільно';
            return (
              '<tr><td>' + s.id + '</td><td>' + s.doctorName + '</td><td>' + s.specialization +
              '</td><td>' + new Date(s.slotTime).toLocaleString('uk-UA') +
              '</td><td class="' + cls + '">' + label + '</td></tr>'
            );
          })
          .join('');
      }
    }

    var prevBtn = document.getElementById('prev-page');
    var nextBtn = document.getElementById('next-page');
    var pageLabel = document.getElementById('page-label');
    if (prevBtn) prevBtn.disabled = currentOffset === 0;
    if (nextBtn) nextBtn.disabled = schedules.length < PAGE_SIZE;
    if (pageLabel) pageLabel.textContent = 'Стор. ' + (Math.floor(currentOffset / PAGE_SIZE) + 1);

    return schedules.length;
  }

  async function initDashboard() {
    var results = await Promise.all([
      fetch('/api/version').then(function (r) { return r.json(); }),
      fetch('/api/doctors').then(function (r) { return r.json(); }),
      loadSchedulesPage(),
    ]);

    var versionData = results[0];
    var doctors = results[1];
    var loadedSlots = results[2];

    var versionEl = document.getElementById('version-badge');
    if (versionEl) {
      versionEl.textContent =
        versionData.service + ' v' + versionData.version + ' (' + versionData.commitSha + ')';
    }

    var banner = document.getElementById('stats-banner');
    if (banner) {
      banner.textContent =
        'Лікарів у клініці: ' + doctors.length +
        ' | Показано вільних слотів на сторінці: ' + loadedSlots +
        ' (пагінація по ' + PAGE_SIZE + ' записів)';
    }

    var select = document.getElementById('doctor-filter');
    if (select) {
      var fragment = document.createDocumentFragment();
      doctors.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = String(d.id);
        opt.textContent = d.name + ' (' + d.specialization + ')';
        fragment.appendChild(opt);
      });
      select.appendChild(fragment);
    }

    renderVitals();
  }

  initDashboard();

  var doctorFilter = document.getElementById('doctor-filter');
  if (doctorFilter) {
    doctorFilter.addEventListener('change', function (e) {
      currentDoctorId = e.target.value;
      currentOffset = 0;
      loadSchedulesPage();
    });
  }

  var prevBtn = document.getElementById('prev-page');
  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
      loadSchedulesPage();
    });
  }

  var nextBtn = document.getElementById('next-page');
  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      currentOffset += PAGE_SIZE;
      loadSchedulesPage();
    });
  }

  var form = document.getElementById('booking-form');
  if (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var scheduleId = Number(document.getElementById('schedule-id').value);
      var patientName = document.getElementById('patient-name').value;
      var statusEl = document.getElementById('booking-status');
      var res = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        },
        body: JSON.stringify({ scheduleId: scheduleId, patientName: patientName }),
      });
      var data = await res.json();
      if (statusEl) {
        statusEl.textContent = res.ok
          ? 'Успішно заброньовано запис #' + data.id
          : 'Помилка (' + res.status + '): ' + (data.message || 'Невідома помилка');
      }
      if (res.ok) {
        loadSchedulesPage();
      }
    });
  }
})();`;

export async function uiRoutes(app: FastifyInstance) {
  app.get('/ui', async (_request, reply) => {
    return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(UI_HTML);
  });

  app.get('/ui/app.js', async (_request, reply) => {
    return reply
      .header('cache-control', 'public, max-age=3600')
      .type('application/javascript; charset=utf-8')
      .send(UI_JS);
  });
}
