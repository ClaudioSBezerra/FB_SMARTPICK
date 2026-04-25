import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { MessageCircle, X, Send, Loader2, Trash2, GraduationCap } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const PAGE_LABELS: Record<string, string> = {
  '/dashboard/ampliar':    'Painel de Calibragem — Ampliar Slot',
  '/dashboard/reduzir':    'Painel de Calibragem — Reduzir Slot',
  '/dashboard/calibrados': 'Painel de Calibragem — Já Calibrados',
  '/dashboard/curva-a':    'Painel de Calibragem — Curva A Revisar',
  '/dashboard/ignorados':  'Painel de Calibragem — Produtos Ignorados',
  '/upload/csv':           'Importação CSV — Upload',
  '/upload/log':           'Importação CSV — Log de Importação',
  '/historico':            'Histórico de Calibragem',
  '/historico/compliance': 'Histórico — Compliance',
  '/reincidencia':         'Reincidência de Calibragem',
  '/resultados':           'Painel de Resultados',
  '/pdf/gerar':            'Geração de PDF',
  '/gestao/filiais':       'Administração — Filiais e CDs',
  '/gestao/regras':        'Administração — Regras de Calibragem',
}

// Renderização básica de markdown: **bold**, \n, listas
function renderMarkdown(text: string) {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>
      }
      return part
    })
    const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ')
    const isNumbered = /^\d+\./.test(line.trimStart())
    return (
      <span key={i} className={`block ${isBullet || isNumbered ? 'pl-3' : ''} ${i > 0 ? 'mt-0.5' : ''}`}>
        {parts}
      </span>
    )
  })
}

const WELCOME: Message = {
  role: 'assistant',
  content: `Olá! Sou o assistente de treinamento do **SmartPick**. 👋

Posso te ajudar com:
- Como calibrar, aprovar ou rejeitar propostas
- O que significam os indicadores e alertas
- Como importar um CSV e gerar calibragens
- Regras da Curva A, Curva ABC e delta
- Qualquer dúvida sobre o sistema

É só perguntar!`,
}

export function AjudaChat() {
  const { token } = useAuth()
  const location  = useLocation()
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg: Message = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setLoading(true)

    const pageCtx = PAGE_LABELS[location.pathname] ?? location.pathname

    // Envia apenas as últimas 10 mensagens para não crescer demais
    const apiMessages = history
      .filter(m => m.role !== 'assistant' || m !== WELCOME)
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/sp/ajuda/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ messages: apiMessages, context: pageCtx }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Desculpe, ocorreu um erro: ${(err as Error).message}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* ── Botão flutuante ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-primary text-primary-foreground shadow-lg rounded-full pl-4 pr-5 py-3 text-sm font-medium hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
          title="Assistente de Treinamento SmartPick"
        >
          <GraduationCap className="h-5 w-5" />
          Treinamento
        </button>
      )}

      {/* ── Painel de chat ── */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[380px] h-[540px] bg-white border rounded-2xl shadow-2xl overflow-hidden">

          {/* Cabeçalho */}
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground shrink-0">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold leading-tight">Assistente SmartPick</p>
                <p className="text-[10px] opacity-75 leading-tight">Treinamento interativo</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([WELCOME])}
                className="p-1.5 rounded hover:bg-white/20 transition-colors"
                title="Limpar conversa"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-white/20 transition-colors"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mr-2 mt-0.5">
                    <MessageCircle className="h-3.5 w-3.5 text-primary-foreground" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-white border rounded-tl-sm text-foreground shadow-sm'
                  }`}
                >
                  {msg.role === 'assistant'
                    ? renderMarkdown(msg.content)
                    : msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mr-2 mt-0.5">
                  <MessageCircle className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
                <div className="bg-white border rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t bg-white px-3 py-2.5 flex gap-2 items-center">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Digite sua dúvida..."
              className="text-xs h-8 flex-1"
              disabled={loading}
            />
            <Button
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              onClick={send}
              disabled={!input.trim() || loading}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>

        </div>
      )}
    </>
  )
}
