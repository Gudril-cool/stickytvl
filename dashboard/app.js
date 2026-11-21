// StickyTVL dashboard — renders window.STICKY (written by main.ts as data.js).
// Fully offline: no network, no links, no imports.
(function () {
  var D = window.STICKY;
  if (!D) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="7">No data loaded.</td></tr>';
    return;
  }

  var rows = D.rows;
  var state = { q: '', category: '', watchOnly: false, sort: 'rank', dir: 1, tab: 'radar' };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
    return '$' + Math.round(n);
  }
  function pct(c) {
    if (c === null || c === undefined) return '—';
    return (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function tier(d) {
    if (d >= 0.95) return 'glacier';
    if (d >= 0.85) return 'steady';
    if (d >= 0.75) return 'drifting';
    return 'restless';
  }

  // Header meta + method panel.
  var top = rows[0];
  document.getElementById('meta').innerHTML =
    '<b>' + rows.length + ' protocols ranked</b><br>' +
    rows.filter(function (r) { return r.watchlist; }).length + ' on the watchlist · ' +
    D.live_size + ' already trading, set aside<br>Top implied: ' + esc(top ? top.name : '—') + ' · ' + money(top ? top.implied_value_usd : 0);
  document.getElementById('asof').textContent = D.as_of;
  document.getElementById('method-text').textContent = D.method;

  var maxBucket = Math.max.apply(null, D.durability_buckets.map(function (b) { return b.count; })) || 1;
  document.getElementById('buckets').innerHTML = D.durability_buckets.map(function (b) {
    return '<div class="bucket"><div class="bar"><i style="width:' + Math.round(100 * b.count / maxBucket) + '%"></i></div>' +
      '<div class="lbl"><b>' + b.count + '</b> ' + esc(b.label) + '</div></div>';
  }).join('');

  // Category filter options.
  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var sel = document.getElementById('category');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var k = state.sort;
    list.sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (typeof av === 'string') return av.localeCompare(bv) * state.dir;
      return (av - bv) * state.dir;
    });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    var html = list.map(function (r) {
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (r.watchlist ? 'watch' : '') + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(r.change_7d) + '</td>' +
        '<td><span class="gauge"><span class="track"><i style="width:' + Math.round(r.durability * 100) + '%"></i></span>' +
        r.durability.toFixed(2) + ' · ' + tier(r.durability) + '</span></td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="7">No protocols match this filter.</td></tr>';
    document.getElementById('count').textContent = list.length + ' of ' + rows.length + ' ranked protocols shown · sorted by ' + state.sort + ' · click a row for its detail view and farm plan.';
    document.querySelectorAll('#rows tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = 'p=' + tr.getAttribute('data-slug'); });
    });
  }

  function renderLive() {
    document.getElementById('live-rows').innerHTML = D.live.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category) + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + p.multiple.toFixed(2) + 'x</td></tr>';
    }).join('');
  }

  function arcGauge(d) {
    var len = Math.PI * 90;
    var shown = (len * d).toFixed(1);
    return '<svg width="200" height="120" viewBox="0 0 200 120" role="img" aria-label="Durability ' + d.toFixed(2) + '">' +
      '<path d="M 20 110 A 90 90 0 0 1 180 110" fill="none" stroke="#123152" stroke-width="14" stroke-linecap="round"/>' +
      '<path d="M 20 110 A 90 90 0 0 1 180 110" fill="none" stroke="#7dd3fc" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + shown + ' ' + len.toFixed(1) + '"/>' +
      '</svg>';
  }

  function renderDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var panel = document.getElementById('detail-panel');
    var board = document.getElementById('board-panel');
    var livePanel = document.getElementById('live-panel');
    if (!r) { panel.hidden = true; board.hidden = false; return; }
    board.hidden = true;
    livePanel.hidden = true;
    panel.hidden = false;
    var swing = r.change_7d === null ? null : Math.abs(r.change_7d);
    var factor = (0.75 + 0.45 * r.durability).toFixed(3);
    var age = r.age_days === null ? 'unreported' : (r.age_days < 365 ? Math.max(1, Math.round(r.age_days / 30)) + ' months' : (r.age_days / 365).toFixed(1) + ' years');
    document.getElementById('detail').innerHTML =
      '<div class="detail-head"><div class="gauge-wrap">' + arcGauge(r.durability) +
      '<div class="score">' + r.durability.toFixed(2) + '</div>' +
      '<div class="cap">durability · ' + tier(r.durability) + '</div></div>' +
      '<div class="math"><h2>' + esc(r.name) + ' <span style="color:#7dd3fc;font-size:16px">rank #' + r.rank + '</span></h2>' +
      '<p class="sub">' + esc(r.category) + ' · ' + r.chains + ' chain' + (r.chains === 1 ? '' : 's') + ' · tracked for ' + age +
      ' · ' + (r.watchlist ? 'on the watchlist' : 'below the watchlist floor') + ' · records no token</p>' +
      '<table><tbody>' +
      '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td>7-day change (as recorded)</td><td>' + pct(r.change_7d) + '</td></tr>' +
      '<tr><td>Weekly swing |change_7d|</td><td>' + (swing === null ? 'unreported' : swing.toFixed(2) + '%') + '</td></tr>' +
      '<tr><td>Durability = clamp(1 − swing / 75, 0.60, 1.00)</td><td>' + r.durability.toFixed(3) + '</td></tr>' +
      '<tr><td>Base multiple (category median FDV/TVL)</td><td>' + r.base_multiple.toFixed(3) + 'x</td></tr>' +
      '<tr><td>Durability factor (0.75 + 0.45 × durability)</td><td>' + factor + 'x</td></tr>' +
      '<tr><td>Adjusted multiple</td><td>' + r.adjusted_multiple.toFixed(3) + 'x</td></tr>' +
      '<tr><td>Survival × breadth</td><td>' + r.survival.toFixed(3) + ' × ' + r.breadth.toFixed(2) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table></div></div>' +
      '<div class="steps"><h3>Farm plan — the long hold</h3><ol>' +
      r.farm_steps.map(function (s, i) { return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    window.scrollTo(0, 0);
  }

  function showTab(tab) {
    state.tab = tab;
    document.getElementById('tab-radar').classList.toggle('active', tab === 'radar');
    document.getElementById('tab-live').classList.toggle('active', tab === 'live');
    document.getElementById('board-panel').hidden = tab !== 'radar';
    document.getElementById('live-panel').hidden = tab !== 'live';
    document.getElementById('detail-panel').hidden = true;
    if (tab === 'live') renderLive();
  }

  document.getElementById('tab-radar').addEventListener('click', function () { showTab('radar'); renderBoard(); });
  document.getElementById('tab-live').addEventListener('click', function () { showTab('live'); });
  document.getElementById('back').addEventListener('click', function () {
    location.hash = '';
    document.getElementById('detail-panel').hidden = true;
    document.getElementById('board-panel').hidden = false;
    renderBoard();
  });
  document.getElementById('search').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('watchlist-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
      renderBoard();
    });
  });

  function route() {
    var h = location.hash.replace(/^#/, '');
    var params = new URLSearchParams(h);
    if (params.get('p')) { renderDetail(params.get('p')); return; }
    if (params.get('category')) {
      state.category = params.get('category');
      sel.value = state.category;
    }
    showTab('radar');
    renderBoard();
  }
  window.addEventListener('hashchange', route);
  route();
})();
