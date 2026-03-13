import { useState } from 'react'
import Dashboard from './components/Dashboard'
import { Film, Tv, Database, Rocket } from 'lucide-react'

export type Tab = 'movies' | 'series' | 'database' | 'deploy'

export default function App() {
  const [tab, setTab] = useState<Tab>('movies')

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'movies',   label: 'Movies',   icon: <Film size={15} /> },
    { id: 'series',   label: 'Series',   icon: <Tv size={15} /> },
    { id: 'database', label: 'Database', icon: <Database size={15} /> },
    { id: 'deploy',   label: 'Render',   icon: <Rocket size={15} /> },
  ]

  return (
    <div className="min-h-screen bg-[#0f1117] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0f1117]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center font-bold text-sm shadow-lg shadow-violet-500/20">
              P
            </div>
            <div className="leading-none">
              <div className="font-semibold text-sm">PixelStream</div>
              <div className="text-[10px] text-white/30">on render.com</div>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id
                    ? 'bg-violet-600 text-white shadow shadow-violet-500/30'
                    : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                }`}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Dashboard tab={tab} />
      </main>
    </div>
  )
}
