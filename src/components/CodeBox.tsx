import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  code: string
  lang?: string
  title?: string
}

export default function CodeBox({ code, lang = 'js', title }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#1a1d27]">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
          <span className="text-xs text-white/50 font-mono">{title}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-violet-400 font-mono">{lang}</span>
            <button
              onClick={copy}
              className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition px-2 py-0.5 rounded bg-white/5 hover:bg-white/10"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      {!title && (
        <div className="flex justify-end p-2 bg-white/5 border-b border-white/10">
          <button
            onClick={copy}
            className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition px-2 py-0.5 rounded bg-white/5 hover:bg-white/10"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="p-4 text-sm text-green-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}
