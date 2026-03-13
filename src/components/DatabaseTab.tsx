import CodeBox from './CodeBox'

const sqlSchema = `-- =========================================
-- PixelStream Supabase Schema (Personal Use)
-- =========================================

-- Movies table
CREATE TABLE movies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pixeldrain_id TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  year          INTEGER,
  genre         TEXT,
  poster        TEXT,          -- TMDB poster URL
  stremio_id    TEXT GENERATED ALWAYS AS ('pd_movie:' || pixeldrain_id) STORED,
  added_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Series episodes table
CREATE TABLE episodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pixeldrain_id TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,  -- Show name
  year          INTEGER,
  genre         TEXT,
  poster        TEXT,
  season        INTEGER NOT NULL DEFAULT 1,
  episode       INTEGER NOT NULL,
  episode_title TEXT,
  stremio_id    TEXT GENERATED ALWAYS AS ('pd_series:' || pixeldrain_id) STORED,
  added_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_movies_title    ON movies(title);
CREATE INDEX idx_episodes_title  ON episodes(title);
CREATE INDEX idx_episodes_season ON episodes(title, season, episode);`

const rlsPolicy = `-- Enable RLS (Row Level Security)
ALTER TABLE movies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

-- Allow all reads (public addon access)
CREATE POLICY "public_read_movies"
  ON movies FOR SELECT USING (true);

CREATE POLICY "public_read_episodes"
  ON episodes FOR SELECT USING (true);

-- Restrict writes to service role only
-- (Use SUPABASE_SERVICE_KEY in bot, never in frontend)`

const envExample = `# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...   # service_role key (not anon)

# Telegram
BOT_TOKEN=123456789:ABC...

# Addon
ADDON_URL=https://your-addon.fly.dev`

const supabaseQuery = `-- Get all movies for Stremio catalog
SELECT id, pixeldrain_id, title, year, genre, poster, stremio_id
FROM movies
ORDER BY added_at DESC;

-- Get all episodes for a specific show (for Stremio meta)
SELECT season, episode, episode_title, pixeldrain_id
FROM episodes
WHERE title = 'Breaking Bad'
ORDER BY season, episode;

-- Get unique series names for catalog
SELECT DISTINCT title, year, genre, poster
FROM episodes
ORDER BY title;`

interface TableRow {
  column: string
  type: string
  notes: string
}

const movieCols: TableRow[] = [
  { column: 'id', type: 'UUID', notes: 'Primary key, auto' },
  { column: 'pixeldrain_id', type: 'TEXT', notes: 'Unique Pixeldrain file ID' },
  { column: 'title', type: 'TEXT', notes: 'Movie title' },
  { column: 'year', type: 'INTEGER', notes: 'Release year' },
  { column: 'genre', type: 'TEXT', notes: 'Genre string' },
  { column: 'poster', type: 'TEXT', notes: 'TMDB poster URL' },
  { column: 'stremio_id', type: 'TEXT', notes: 'Auto: pd_movie:{pixeldrain_id}' },
  { column: 'added_at', type: 'TIMESTAMPTZ', notes: 'Auto timestamp' },
]

const episodeCols: TableRow[] = [
  { column: 'id', type: 'UUID', notes: 'Primary key, auto' },
  { column: 'pixeldrain_id', type: 'TEXT', notes: 'Unique Pixeldrain file ID' },
  { column: 'title', type: 'TEXT', notes: 'Show name (e.g. Breaking Bad)' },
  { column: 'year', type: 'INTEGER', notes: 'Show start year' },
  { column: 'genre', type: 'TEXT', notes: 'Genre string' },
  { column: 'poster', type: 'TEXT', notes: 'Show poster URL' },
  { column: 'season', type: 'INTEGER', notes: 'Season number' },
  { column: 'episode', type: 'INTEGER', notes: 'Episode number' },
  { column: 'episode_title', type: 'TEXT', notes: 'Episode name' },
  { column: 'stremio_id', type: 'TEXT', notes: 'Auto: pd_series:{pixeldrain_id}' },
  { column: 'added_at', type: 'TIMESTAMPTZ', notes: 'Auto timestamp' },
]

function SchemaTable({ rows, title, color }: { rows: TableRow[]; title: string; color: string }) {
  return (
    <div>
      <div className={`inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-lg text-xs font-semibold ${color}`}>
        <span>TABLE</span>
        <span className="font-mono">{title}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/5 border-b border-white/10">
              <th className="text-left px-4 py-2.5 text-white/40 font-medium text-xs uppercase tracking-wide">Column</th>
              <th className="text-left px-4 py-2.5 text-white/40 font-medium text-xs uppercase tracking-wide">Type</th>
              <th className="text-left px-4 py-2.5 text-white/40 font-medium text-xs uppercase tracking-wide">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map(r => (
              <tr key={r.column} className="hover:bg-white/3 transition">
                <td className="px-4 py-2.5 font-mono text-violet-300 text-xs">{r.column}</td>
                <td className="px-4 py-2.5 font-mono text-blue-300 text-xs">{r.type}</td>
                <td className="px-4 py-2.5 text-white/50 text-xs">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DatabaseTab() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-1">Supabase Database Schema</h2>
        <p className="text-white/40 text-sm">Simple 2-table design. Movies and Episodes (series). No extra fluff.</p>
      </div>

      {/* Schema Tables */}
      <div className="space-y-6">
        <SchemaTable rows={movieCols} title="movies" color="bg-violet-500/20 text-violet-300" />
        <SchemaTable rows={episodeCols} title="episodes" color="bg-blue-500/20 text-blue-300" />
      </div>

      {/* SQL */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide">① Run this in Supabase SQL Editor</h3>
        <CodeBox code={sqlSchema} lang="sql" title="schema.sql" />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide">② Enable RLS Policies</h3>
        <CodeBox code={rlsPolicy} lang="sql" title="rls.sql" />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide">③ Environment Variables</h3>
        <CodeBox code={envExample} lang="env" title=".env" />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide">Useful Queries</h3>
        <CodeBox code={supabaseQuery} lang="sql" title="queries.sql" />
      </div>

      {/* Note */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-200">
        <p className="font-semibold mb-1">⚠️ Important</p>
        <p className="text-amber-200/70">Always use <code className="bg-white/10 px-1 rounded">SUPABASE_SERVICE_KEY</code> (service_role) in the bot and addon backend — never the anon key. The service key bypasses RLS for writes.</p>
      </div>
    </div>
  )
}
