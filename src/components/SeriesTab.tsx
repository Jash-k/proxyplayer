import { useState } from 'react'
import { mockSeries, Series } from '../data/mockData'
import { ExternalLink, Tv, Search, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

export default function SeriesTab() {
  const [episodes, setEpisodes] = useState<Series[]>(mockSeries)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])

  const remove = (id: string) => setEpisodes(prev => prev.filter(e => e.id !== id))

  // Group by title
  const grouped = episodes.reduce<Record<string, Series[]>>((acc, ep) => {
    if (!acc[ep.title]) acc[ep.title] = []
    acc[ep.title].push(ep)
    return acc
  }, {})

  const filteredKeys = Object.keys(grouped).filter(title =>
    title.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (title: string) =>
    setExpanded(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title])

  const genreColor: Record<string, string> = {
    'Crime': 'bg-red-500/20 text-red-300',
    'Drama': 'bg-purple-500/20 text-purple-300',
    'Comedy': 'bg-yellow-500/20 text-yellow-300',
    'Action': 'bg-orange-500/20 text-orange-300',
    'Sci-Fi': 'bg-blue-500/20 text-blue-300',
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <p className="text-white/40 text-xs uppercase tracking-wide">Total Shows</p>
          <p className="text-3xl font-bold mt-1">{Object.keys(grouped).length}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <p className="text-white/40 text-xs uppercase tracking-wide">Total Episodes</p>
          <p className="text-3xl font-bold mt-1">{episodes.length}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 col-span-2 sm:col-span-1">
          <p className="text-white/40 text-xs uppercase tracking-wide">Latest Show</p>
          <p className="text-sm font-semibold mt-1 truncate">{Object.keys(grouped).slice(-1)[0] ?? '—'}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search series..."
          className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500 transition"
        />
      </div>

      {/* Grouped list */}
      {filteredKeys.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <Tv size={40} className="mx-auto mb-3 opacity-30" />
          <p>No series found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredKeys.map(title => {
            const eps = grouped[title]
            const isOpen = expanded.includes(title)
            const first = eps[0]

            return (
              <div key={title} className="border border-white/10 rounded-xl overflow-hidden bg-white/5">
                {/* Show Header */}
                <button
                  onClick={() => toggle(title)}
                  className="w-full flex items-center gap-4 p-3 hover:bg-white/5 transition text-left"
                >
                  <img
                    src={first.poster}
                    alt={title}
                    className="w-10 h-14 object-cover rounded-lg flex-shrink-0 bg-white/10"
                    onError={e => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40x56/1a1d27/ffffff?text=?' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{title}</span>
                      <span className="text-white/30 text-xs">{first.year}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${genreColor[first.genre] ?? 'bg-white/10 text-white/50'}`}>
                        {first.genre}
                      </span>
                    </div>
                    <p className="text-xs text-white/30 mt-0.5">{eps.length} episode{eps.length > 1 ? 's' : ''}</p>
                  </div>
                  {isOpen ? <ChevronDown size={16} className="text-white/30 flex-shrink-0" /> : <ChevronRight size={16} className="text-white/30 flex-shrink-0" />}
                </button>

                {/* Episodes */}
                {isOpen && (
                  <div className="border-t border-white/10 divide-y divide-white/5">
                    {eps
                      .sort((a, b) => a.season - b.season || a.episode - b.episode)
                      .map(ep => (
                        <div key={ep.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition group">
                          <span className="text-xs text-white/30 font-mono w-14 flex-shrink-0">
                            S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')}
                          </span>
                          <span className="text-sm flex-1 truncate">{ep.episode_title}</span>
                          <span className="text-xs text-white/20 font-mono hidden sm:block">{ep.pixeldrain_id}</span>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                            <a
                              href={`https://pixeldrain.com/u/${ep.pixeldrain_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-violet-600 transition"
                            >
                              <ExternalLink size={13} />
                            </a>
                            <button
                              onClick={() => remove(ep.id)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-600 transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
