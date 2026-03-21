#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');

function parseDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = parseDotEnv(envPath);
const fromEnv = (key, fallback = '') => process.env[key] || fileEnv[key] || fallback;

const TMDB_API_KEY = fromEnv('VITE_TMDB_API_KEY') || fromEnv('TMDB_API_KEY');
const ALGOLIA_APP_ID = fromEnv('VITE_ALGOLIA_APP_ID') || fromEnv('ALGOLIA_APP_ID');
const ALGOLIA_ADMIN_KEY =
  fromEnv('ALGOLIA_ADMIN_KEY') ||
  fromEnv('VITE_ALGOLIA_ADMIN_KEY') ||
  fromEnv('ALGOLIA_WRITE_KEY');
const ALGOLIA_INDEX_NAME =
  fromEnv('VITE_ALGOLIA_INDEX_NAME') ||
  fromEnv('ALGOLIA_INDEX_NAME') ||
  'delulu_content';

const DEFAULT_PAGES = 20;
const pagesArg = Number(process.argv.find((a) => a.startsWith('--pages='))?.split('=')[1] || DEFAULT_PAGES);
const pages = Number.isFinite(pagesArg) && pagesArg > 0 ? Math.min(Math.floor(pagesArg), 50) : DEFAULT_PAGES;
const shouldClear = !process.argv.includes('--no-clear');

if (!TMDB_API_KEY) {
  console.error('[Algolia Sync] Missing TMDB API key (VITE_TMDB_API_KEY or TMDB_API_KEY).');
  process.exit(1);
}
if (!ALGOLIA_APP_ID || !ALGOLIA_ADMIN_KEY) {
  console.error('[Algolia Sync] Missing Algolia credentials (VITE_ALGOLIA_APP_ID + ALGOLIA_ADMIN_KEY).');
  process.exit(1);
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const ALGOLIA_BASE = `https://${ALGOLIA_APP_ID}.algolia.net`;

async function fetchTmdb(endpoint, pageNum = 1) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('page', String(pageNum));
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`TMDB ${endpoint} page=${pageNum} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchTmdbList(mediaType, endpoint, totalPages) {
  const all = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    const data = await fetchTmdb(`/${mediaType}/${endpoint}`, pageNum);
    all.push(...(data.results || []));
    if (pageNum % 5 === 0 || pageNum === totalPages) {
      console.log(`[Algolia Sync] Fetched ${mediaType}/${endpoint} page ${pageNum}/${totalPages}`);
    }
  }
  return all;
}

function mapMovie(movie) {
  return {
    objectID: `movie_${movie.id}`,
    tmdb_id: movie.id,
    id: movie.id,
    media_type: 'movie',
    title: movie.title || '',
    original_title: movie.original_title || movie.title || '',
    name: null,
    original_name: null,
    overview: movie.overview || '',
    poster_path: movie.poster_path || null,
    backdrop_path: movie.backdrop_path || null,
    release_date: movie.release_date || '',
    first_air_date: '',
    popularity: movie.popularity || 0,
    vote_average: movie.vote_average || 0,
    vote_count: movie.vote_count || 0,
    genre_ids: movie.genre_ids || [],
    adult: Boolean(movie.adult),
  };
}

function mapTV(show) {
  return {
    objectID: `tv_${show.id}`,
    tmdb_id: show.id,
    id: show.id,
    media_type: 'tv',
    title: null,
    original_title: null,
    name: show.name || '',
    original_name: show.original_name || show.name || '',
    overview: show.overview || '',
    poster_path: show.poster_path || null,
    backdrop_path: show.backdrop_path || null,
    release_date: '',
    first_air_date: show.first_air_date || '',
    popularity: show.popularity || 0,
    vote_average: show.vote_average || 0,
    vote_count: show.vote_count || 0,
    genre_ids: show.genre_ids || [],
    adult: false,
  };
}

async function algoliaRequest(method, pathname, body) {
  const res = await fetch(`${ALGOLIA_BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': ALGOLIA_APP_ID,
      'X-Algolia-API-Key': ALGOLIA_ADMIN_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Algolia ${method} ${pathname} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

async function waitTask(taskId) {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i += 1) {
    const task = await algoliaRequest('GET', `/1/indexes/${encodeURIComponent(ALGOLIA_INDEX_NAME)}/task/${taskId}`);
    if (task.status === 'published') return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for Algolia task ${taskId}`);
}

async function pushInBatches(records, batchSize = 1000) {
  let uploaded = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    const requests = chunk.map((record) => ({ action: 'addObject', body: record }));
    const task = await algoliaRequest('POST', `/1/indexes/${encodeURIComponent(ALGOLIA_INDEX_NAME)}/batch`, { requests });
    await waitTask(task.taskID);
    uploaded += chunk.length;
    console.log(`[Algolia Sync] Uploaded ${uploaded}/${records.length}`);
  }
}

async function setIndexSettings() {
  const settings = {
    searchableAttributes: [
      'unordered(title)',
      'unordered(name)',
      'unordered(original_title)',
      'unordered(original_name)',
      'overview',
    ],
    customRanking: [
      'desc(popularity)',
      'desc(vote_count)',
      'desc(vote_average)',
    ],
    attributesForFaceting: [
      'filterOnly(media_type)',
    ],
    typoTolerance: true,
    ignorePlurals: true,
    removeStopWords: true,
    separatorsToIndex: '_-',
    queryLanguages: ['en'],
  };
  const task = await algoliaRequest(
    'PUT',
    `/1/indexes/${encodeURIComponent(ALGOLIA_INDEX_NAME)}/settings`,
    settings
  );
  await waitTask(task.taskID);
  console.log('[Algolia Sync] Index settings applied');
}

async function main() {
  console.log(`[Algolia Sync] Starting sync -> index "${ALGOLIA_INDEX_NAME}"`);
  console.log(`[Algolia Sync] Pages per endpoint: ${pages}`);

  const [popularMovies, topMovies, popularTv, topTv] = await Promise.all([
    fetchTmdbList('movie', 'popular', pages),
    fetchTmdbList('movie', 'top_rated', pages),
    fetchTmdbList('tv', 'popular', pages),
    fetchTmdbList('tv', 'top_rated', pages),
  ]);

  const deduped = new Map();
  for (const m of [...popularMovies, ...topMovies]) {
    deduped.set(`movie_${m.id}`, mapMovie(m));
  }
  for (const tv of [...popularTv, ...topTv]) {
    deduped.set(`tv_${tv.id}`, mapTV(tv));
  }

  const records = Array.from(deduped.values());
  console.log(`[Algolia Sync] Prepared ${records.length} unique records`);

  if (shouldClear) {
    console.log('[Algolia Sync] Clearing existing records...');
    const clearTask = await algoliaRequest('POST', `/1/indexes/${encodeURIComponent(ALGOLIA_INDEX_NAME)}/clear`);
    await waitTask(clearTask.taskID);
  }

  await setIndexSettings();
  await pushInBatches(records);

  console.log('[Algolia Sync] Completed successfully');
}

main().catch((error) => {
  console.error('[Algolia Sync] Failed:', error.message || error);
  process.exit(1);
});

