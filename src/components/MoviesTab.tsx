import { useState } from 'react'
import { mockMovies, Movie } from '../data/mockData'
import { ExternalLink, Film, Search, Trash2 } from 'lucide-react'

export default function MoviesTab() {
  const [movies, setMovies] = useState<Movie[]>(mockMovies)
  const [search, setSearch] = useState('')

  const filtered = movies.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    m.genre.toLowerCase().includes(search.toLowerCase())
  )

  const remove = (id: string) => setMovies(prev => prev.filter(m => m.id !== id))

  const genreColor: Record<string, string> = {
    'Sci-Fi': 'bg-blue-500/20 text-blue-300',
    'Drama': 'bg-purple-500/20 text-purple-300',
    'Crime': 'bg-red-500/20 text-red-300',
    'Action': 'bg-orange-500/20 text-orange-300',
    'Comedy': 'bg-yellow-500/20 text-yellow-300',
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <p className="text-white/40 text-xs uppercase tracking-wide">Total Movies</p>
          <p className="text-3xl font-bold mt-1">{movies.length}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <p className="text-white/40 text-xs uppercase tracking-wide">Genres</p>
          <p className="text-3xl font-bold mt-1">{new Set(movies.map(m => m.genre)).size}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 col-span-2 sm:col-span-1">
          <p className="text-white/40 text-xs uppercase tracking-wide">Latest Added</p>
          <p className="text-sm font-semibold mt-1 truncate">{movies[movies.length - 1]?.title ?? '—'}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search movies..."
          className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500 transition"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <Film size={40} className="mx-auto mb-3 opacity-30" />
          <p>No movies found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(movie => (
            <div
              key={movie.id}
              className="flex items-center gap-4 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl p-3 transition group"
            >
              {/* Poster */}
              <img
                src={movie.poster}
                alt={movie.title}
                className="w-10 h-14 object-cover rounded-lg flex-shrink-0 bg-white/10"
                onError={e => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40x56/1a1d27/ffffff?text=?' }}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{movie.title}</span>
                  <span className="text-white/30 text-xs">{movie.year}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${genreColor[movie.genre] ?? 'bg-white/10 text-white/50'}`}>
                    {movie.genre}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="text-xs text-white/30 font-mono">ID: {movie.pixeldrain_id}</span>
                  <span className="text-xs text-white/20">Added {movie.added_at}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                <a
                  href={`https://pixeldrain.com/u/${movie.pixeldrain_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-violet-600 transition"
                  title="Open on Pixeldrain"
                >
                  <ExternalLink size={14} />
                </a>
                <button
                  onClick={() => remove(movie.id)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-red-600 transition"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
