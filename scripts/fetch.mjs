#!/usr/bin/env node
// Pulls WoW Forever characters from Blizzard's public Armory into docs/data.json.
//
//   CHARACTERS="Stardew Honeymelon, Trandy Reid" node scripts/fetch.mjs
//
// The character list comes from the CHARACTERS repository variable on GitHub (names separated by commas
// or new lines), so it can be changed in the repo settings without editing any files. If it's unset or
// empty, the characters already in docs/data.json are refreshed instead of the page being wiped.
//
// Blizzard's official API doesn't document Forever yet, but every Armory character page embeds the full
// profile as JSON (`var characterProfileInitialState = {...}`). This reads that: one request per character.
// If Blizzard changes the page, the run fails loudly and the site keeps the last good data.

import { appendFileSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'docs', 'data.json');
const REGION = process.env.WOW_REGION || 'us';
const ARMORY = `https://worldofwarcraft.blizzard.com/en-us/forever/${REGION}/armory/character`;
const USER_AGENT = 'wow-forever-dashboard (small friends leaderboard, a few requests every 3 hours)';

const SLOT_ORDER = [
  'HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET',
  'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND', 'RANGED',
];

// Each section is compared separately, so `updated` records when that part of a character last changed.
const SECTIONS = {
  summary: (c) => ({
    name: c.name ?? null,
    surname: c.surname ?? null,
    level: c.level ?? null,
    race: c.race?.name ?? null,
    class: c.class?.name ?? null,
    faction: c.faction?.name ?? null,
    guild: c.guild?.name ?? null,
    ruleset: c.ruleset?.name ?? null,
    itemLevel: c.averageItemLevel ?? null,
    lastUpdated: c.lastUpdatedTimestamp?.epoch ?? null,
    honorableKills: c.pvp?.honorableKills?.value ?? null,
  }),
  talents: (c) =>
    c.specs
      ? c.specs
          .map((s) => ({ name: s.name ?? null, points: s.spentPoints ?? 0 }))
          .filter((s) => s.points > 0)
          .sort((a, b) => b.points - a.points)
      : null,
  equipment: (c) =>
    c.gear
      ? Object.values(c.gear)
          .map((i) => ({
            slot: i.slot?.name ?? null,
            slotType: i.slot?.type ?? null,
            id: i.item?.id ?? i.id ?? null,
            name: i.name ?? null,
            quality: i.quality?.type ?? null,
            itemLevel: i.level?.value ?? null,
            icon: i.media?.content?.assets?.find((a) => a.key === 'icon')?.value ?? null,
            stats: (i.stats ?? []).map((s) => s.display?.display_string).filter(Boolean),
            enchants: (i.enchantments ?? []).map((e) => e.display_string).filter(Boolean),
          }))
          .sort((a, b) => slotRank(a.slotType) - slotRank(b.slotType))
      : null,
  professions: (c) => {
    if (!c.professions) return null;
    const one = (p, primary) => {
      // Skill sits on "tiers"; Forever has one per profession, but take the highest in case that changes.
      const tier = (p.tiers ?? []).reduce((best, t) => ((t.maxSkillPoints ?? 0) > (best?.maxSkillPoints ?? -1) ? t : best), null) ?? {};
      return { name: p.name ?? null, skill: tier.skillPoints ?? null, max: tier.maxSkillPoints ?? null, icon: p.icon?.url ?? null, primary };
    };
    return [...(c.professions.primaries ?? []).map((p) => one(p, true)), ...(c.professions.secondaries ?? []).map((p) => one(p, false))];
  },
  media: (c) => ({
    avatar: c.media?.avatar?.url ?? c.avatar?.url ?? null,
    render: c.media?.['main-raw']?.url ?? null,
  }),
};

try {
  await update();
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}

async function update() {
  const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
  const previous = existsSync(DATA_FILE) ? JSON.parse(await readFile(DATA_FILE, 'utf8')) : { characters: [] };
  const before = new Map(previous.characters.map((c) => [c.slug, c]));
  const names = characterList(previous);
  const now = new Date().toISOString();

  const characters = [];
  let failures = 0;
  for (const name of names) {
    const slug = slugFor(name);
    const old = before.get(slug) ?? {};
    const c = { slug, character: name, sections: { ...old.sections }, updated: { ...old.updated }, error: null };
    try {
      const profile = await armoryProfile(slug);
      for (const [key, shape] of Object.entries(SECTIONS)) {
        const fresh = shape(profile);
        if (fresh == null) continue;
        if (JSON.stringify(fresh) !== JSON.stringify(old.sections?.[key])) {
          c.sections[key] = fresh;
          c.updated[key] = now;
        }
      }
      const s = c.sections.summary;
      console.log(`ok    ${slug.padEnd(28)} level ${s.level}  ${s.race} ${s.class}  ilvl ${s.itemLevel}`);
    } catch (err) {
      failures++;
      c.error = err.message;
      console.log(`fail  ${slug.padEnd(28)} ${err.message}`);
    }
    characters.push(c);
  }

  // Everyone failing almost always means Blizzard changed or blocked the page. Fail the run and
  // leave the published data alone rather than overwrite it with errors.
  if (failures === characters.length) {
    throw new Error('Every character failed. The Armory page may have changed; data.json left untouched.');
  }

  const data = { title: config.title ?? 'WoW Forever', region: REGION, fetchedAt: now, characters };
  const { fetchedAt: _next, ...nextComparable } = data;
  const { fetchedAt: _prev, ...prevComparable } = previous;
  const changed = JSON.stringify(nextComparable) !== JSON.stringify(prevComparable);

  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${characters.length} characters to docs/data.json (${changed ? 'changed' : 'no changes'})`);
  // Tells the GitHub Action whether there's anything worth committing.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

// Names from CHARACTERS, split on commas or new lines. An unset or emptied variable keeps the current
// list, so a slip in the settings page can't wipe everyone off the board.
function characterList(previous) {
  const fromVariable = (process.env.CHARACTERS ?? '').split(/[\n,]/).map((n) => n.trim()).filter(Boolean);
  const names = fromVariable.length ? fromVariable : previous.characters.map((c) => c.character);
  if (!names.length) throw new Error('No characters to fetch. Set CHARACTERS, e.g. CHARACTERS="Trandy Reid, Stardew Honeymelon".');
  if (!fromVariable.length) console.warn(`CHARACTERS isn't set, so refreshing the ${names.length} characters already on the page.\n`);
  const seen = new Set();
  return names.filter((name) => {
    const slug = slugFor(name);
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

async function armoryProfile(slug, attempt = 1) {
  const res = await fetch(`${ARMORY}/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status >= 500 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return armoryProfile(slug, attempt + 1);
  }
  // The Armory answers unknown characters with HTTP 500, not 404.
  if (res.status === 500 || res.status === 404) throw new Error(`not on the Armory yet (HTTP ${res.status}). Check the spelling; characters appear after level 10 and a logout.`);
  if (!res.ok) throw new Error(`Armory returned HTTP ${res.status}`);
  const state = extractJson(await res.text(), 'var characterProfileInitialState =');
  if (!state?.character) throw new Error('the Armory page had no character data (its layout may have changed)');
  return state.character;
}

// Finds `marker` in the page and parses the JSON object that follows it.
function extractJson(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  return null;
}

// Forever characters have no realm: the Armory looks them up as "firstname-surname".
function slugFor(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function slotRank(type) {
  const i = SLOT_ORDER.indexOf(type);
  return i < 0 ? SLOT_ORDER.length : i;
}
