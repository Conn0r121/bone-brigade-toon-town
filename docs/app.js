// Renders data.json (written by scripts/fetch.mjs) as a sortable roster with expandable characters.

const MAX_LEVEL = 60;
// The classic client's own class and item-quality colors.
const CLASS_COLORS = {
  Warrior: '#C79C6E', Paladin: '#F58CBA', Hunter: '#ABD473', Rogue: '#FFF569', Priest: '#FFFFFF',
  Shaman: '#0070DE', Mage: '#69CCF0', Warlock: '#9482C9', Druid: '#FF7D0A',
};
const QUALITY_COLORS = {
  POOR: '#9d9d9d', COMMON: '#ffffff', UNCOMMON: '#1eff00', RARE: '#0070dd',
  EPIC: '#a335ee', LEGENDARY: '#ff8000', ARTIFACT: '#e6cc80', HEIRLOOM: '#00ccff',
};

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const dash = (title = 'Not available yet') => `<span class="dash" title="${esc(title)}">—</span>`;
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function ago(ts) {
  if (!ts) return null;
  const secs = (new Date(ts).getTime() - Date.now()) / 1000;
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return 'just now';
}

const skillOf = (r, name) => r.professions?.find((p) => p.name === name)?.skill ?? null;

function toRow(c) {
  const s = c.sections?.summary ?? {};
  const professions = c.sections?.professions ?? null;
  const primaries = professions?.filter((p) => p.primary) ?? [];
  const talents = c.sections?.talents ?? null;
  return {
    c,
    s,
    professions,
    primaries,
    talents,
    gear: c.sections?.equipment ?? null,
    name: s.name ? [s.name, s.surname].filter(Boolean).join(' ') : c.character,
    spec: talents?.[0] ?? null,
    topSkill: primaries.reduce((best, p) => ((p.skill ?? -1) > (best?.skill ?? -1) ? p : best), null),
    color: CLASS_COLORS[s.class] ?? 'var(--text)',
  };
}

const COLUMNS = [
  { key: 'name', label: 'Character', value: (r) => r.name.toLowerCase(), cell: characterCell },
  { key: 'level', label: 'Level', value: (r) => r.s.level, cell: levelCell },
  { key: 'ilvl', label: 'Item level', num: true, value: (r) => r.s.itemLevel, cell: (r) => r.s.itemLevel ?? dash() },
  // `hide` drops a column on narrower screens ('md' tablets and down, 'sm' phones); the expanded panel still shows it.
  {
    key: 'spec', label: 'Spec', hide: 'md', value: (r) => r.spec?.name?.toLowerCase(),
    cell: (r) => (r.spec ? `${esc(r.spec.name)} <span class="muted">${r.spec.points}</span>` : dash()),
  },
  { key: 'prof', label: 'Professions', hide: 'sm', value: (r) => r.topSkill?.skill, cell: professionsCell },
  { key: 'seen', label: 'Last seen', hide: 'md', value: (r) => r.s.lastUpdated, cell: (r) => esc(ago(r.s.lastUpdated)) || dash() },
];
const TEXT_COLUMNS = new Set(['name', 'spec']);
const cls = (col) => [col.num && 'num', col.hide && `hide-${col.hide}`].filter(Boolean).join(' ');

const state = { data: null, rows: [], sort: 'level', dir: 'desc', open: new Set() };

function sortedRows() {
  const col = COLUMNS.find((c) => c.key === state.sort);
  const dir = state.dir === 'asc' ? 1 : -1;
  return [...state.rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    if (x == null || y == null) return x == null && y == null ? a.name.localeCompare(b.name) : x == null ? 1 : -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name);
  });
}

function render() {
  const { data } = state;
  document.title = data.title;
  $('#title').textContent = data.title;
  $('#updated').textContent = `Updated ${ago(data.fetchedAt)} · checks the Armory every 3 hours`;
  $('#leaders').innerHTML = leaders(state.rows);
  $('#roster thead').innerHTML = `<tr>${COLUMNS.map(headerCell).join('')}</tr>`;
  $('#roster tbody').innerHTML = sortedRows().map(rowHtml).join('');
}

function headerCell(col) {
  const aria = state.sort === col.key ? ` aria-sort="${state.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
  return `<th class="${cls(col)}"${aria}><button type="button" data-sort="${col.key}">${col.label}</button></th>`;
}

function rowHtml(r) {
  const open = state.open.has(r.c.slug);
  const row = `<tr class="row" data-slug="${esc(r.c.slug)}" tabindex="0" aria-expanded="${open}">${COLUMNS.map((col) => `<td class="${cls(col)}">${col.cell(r)}</td>`).join('')}</tr>`;
  return open ? `${row}<tr class="detail"><td colspan="${COLUMNS.length}">${detail(r)}</td></tr>` : row;
}

function characterCell(r) {
  const avatar = r.c.sections?.media?.avatar;
  const pic = avatar
    ? `<img class="avatar" src="${esc(avatar)}" alt="" loading="lazy">`
    : `<span class="avatar blank" style="color:${r.color}">${esc(r.name[0] ?? '?')}</span>`;
  const meta = [r.s.race, r.s.class].filter(Boolean).join(' ');
  const warn = r.c.error ? ` <span class="warn" title="Last update failed: ${esc(r.c.error)}">⚠</span>` : '';
  return `<div class="who">${pic}<div><div class="name" style="color:${r.color}">${esc(r.name)}${warn}</div><div class="meta">${esc(meta) || '&nbsp;'}</div></div></div>`;
}

function levelCell(r) {
  const level = r.s.level;
  if (level == null) return dash();
  const pct = Math.min(100, (level / MAX_LEVEL) * 100);
  return `<div class="level"><b>${level}</b><span class="bar" title="${level} of ${MAX_LEVEL}"><i style="width:${pct}%"></i></span></div>`;
}

function professionsCell(r) {
  if (!r.professions) return dash();
  if (!r.primaries.length) return '<span class="muted">None</span>';
  return `<div class="chips">${r.primaries.map((p) => `<span class="chip">${esc(p.name)} <b>${p.skill ?? '?'}</b></span>`).join('')}</div>`;
}

function leaders(rows) {
  const top = (value) => rows.filter((r) => value(r) != null).sort((a, b) => value(b) - value(a))[0];
  const cards = [
    ['Highest level', top((r) => r.s.level), (r) => `Level ${r.s.level}`],
    ['Best geared', top((r) => r.s.itemLevel), (r) => `Item level ${r.s.itemLevel}`],
    ['Top profession', top((r) => r.topSkill?.skill), (r) => `${r.topSkill.name} ${r.topSkill.skill}`],
    ['Best angler', top((r) => skillOf(r, 'Fishing')), (r) => `Fishing ${skillOf(r, 'Fishing')}`],
  ];
  return cards
    .filter(([, r]) => r)
    .map(([label, r, value]) => `
      <div class="card">
        <div class="card-label">${label}</div>
        <div class="card-name" style="color:${r.color}">${esc(r.name)}</div>
        <div class="card-value">${esc(value(r))}</div>
      </div>`)
    .join('');
}

function detail(r) {
  const renderUrl = r.c.sections?.media?.render;
  const lastChange = Object.values(r.c.updated ?? {}).sort().at(-1);
  const facts = [
    ['Race', r.s.race],
    ['Class', r.s.class],
    ['Faction', r.s.faction],
    ['Guild', r.s.guild],
    ['Ruleset', r.s.ruleset],
    ['Honorable kills', r.s.honorableKills || null],
    ['Last seen', ago(r.s.lastUpdated)],
  ].filter(([, v]) => v != null && v !== '');
  const failed = r.c.error
    ? `<p class="note warn-note">The last update failed (${esc(r.c.error)}). Showing data from ${esc(ago(lastChange) ?? 'earlier')}.</p>`
    : '';
  return `${failed}
    <div class="detail-grid${renderUrl ? ' has-render' : ''}">
      ${renderUrl ? `<div class="render"><img src="${esc(renderUrl)}" alt="${esc(r.name)}" loading="lazy" onerror="this.parentNode.remove()"></div>` : ''}
      <section>
        <h3>Gear</h3>
        ${gearList(r.gear)}
      </section>
      <section>
        <h3>Professions</h3>
        ${professionList(r.professions)}
        ${r.talents?.length ? `<h3>Talents</h3><p class="talents">${r.talents.map((t) => `${esc(t.name)} <b>${t.points}</b>`).join(' · ')}</p>` : ''}
        <h3>Details</h3>
        <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </section>
    </div>`;
}

function gearList(gear) {
  if (!gear?.length) return '<p class="note">No gear data yet.</p>';
  const items = gear.map((i) => {
    const color = QUALITY_COLORS[i.quality] ?? 'inherit';
    const icon = i.icon
      ? `<img class="icon" src="${esc(i.icon)}" alt="" loading="lazy" style="border-color:${color}">`
      : '<span class="icon"></span>';
    const sub = [i.slot, ...(i.stats ?? [])].filter(Boolean).map(esc).join(' · ');
    const enchants = i.enchants?.length ? `<div class="ench">${i.enchants.map(esc).join(', ')}</div>` : '';
    return `<li>${icon}<div class="gear-text">
      <div class="gear-top"><span class="item" style="color:${color}">${esc(i.name)}</span><span class="ilvl">${i.itemLevel ?? ''}</span></div>
      <div class="gear-sub" title="${sub}">${sub}</div>${enchants}
    </div></li>`;
  });
  return `<ul class="gear">${items.join('')}</ul>`;
}

function professionList(list) {
  if (!list) return '<p class="note">No profession data yet.</p>';
  if (!list.length) return '<p class="note">None learned yet.</p>';
  const items = list.map((p) => {
    const pct = p.max ? Math.min(100, ((p.skill ?? 0) / p.max) * 100) : 0;
    const icon = p.icon ? `<img class="icon" src="${esc(p.icon)}" alt="" loading="lazy">` : '<span class="icon"></span>';
    return `<li class="${p.primary ? '' : 'secondary'}">${icon}<div class="skillbar">
      <i style="width:${pct}%"></i><span>${esc(p.name)}</span><span>${p.skill ?? '?'} / ${p.max ?? '?'}</span>
    </div></li>`;
  });
  return `<ul class="profs">${items.join('')}</ul>`;
}

function setSort(key) {
  if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  else {
    state.sort = key;
    state.dir = TEXT_COLUMNS.has(key) ? 'asc' : 'desc';
  }
  render();
}

function toggle(slug) {
  if (state.open.has(slug)) state.open.delete(slug);
  else state.open.add(slug);
  render();
  document.querySelector(`tr.row[data-slug="${CSS.escape(slug)}"]`)?.focus();
}

document.addEventListener('click', (e) => {
  const sortButton = e.target.closest('[data-sort]');
  if (sortButton) return setSort(sortButton.dataset.sort);
  const row = e.target.closest('tr.row');
  if (row) toggle(row.dataset.slug);
});

document.addEventListener('keydown', (e) => {
  const row = e.target.closest?.('tr.row');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    toggle(row.dataset.slug);
  }
});

function showEmpty(message) {
  $('#updated').textContent = '';
  document.querySelector('.table-wrap').hidden = true;
  $('#empty').textContent = message;
  $('#empty').hidden = false;
}

(async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch {
    return showEmpty("No data yet. The first update hasn't run.");
  }
  state.rows = (state.data.characters ?? []).map(toRow);
  if (!state.rows.length) return showEmpty('No characters yet.');
  render();
})();
