import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { ArrowUp, ArrowDown, Check, ArrowLeftRight, RotateCcw, FileDown, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD     { id: number; filial_id: number; nome: string }

interface Slot {
  id: number
  codprod: number
  produto: string
  rua: number | null
  predio: number | null
  apto: number | null
  classe_venda: string | null      // curva A/B/C — remodelada por acesso ao picking
  capacidade_atual: number | null
  sugestao_calibragem: number
  sugestao_editada: number | null
  norma_palete: number | null
  status: string
  delta: number
  giro_dia_cx: number | null
  qt_acesso_90: number | null      // acessos ao picking em 90 dias
  fora_linha: boolean | null        // produto descontinuado
}

type PredioFilter = 'todos' | 'par' | 'impar'

// Cores da curva ABC por acesso: A=verde (alta rotatividade), B=amarelo, C=vermelho
const curvaBadge: Record<string, string> = {
  A: 'bg-green-600 text-white',
  B: 'bg-yellow-400 text-yellow-900',
  C: 'bg-red-600 text-white',
}

// Heat map p/ QTACESSO — escala relativa ao dataset carregado
function qtacessoHeatClass(value: number | null, max: number): string {
  if (value == null || max <= 0) return ''
  const r = value / max
  if (r >= 0.80) return 'bg-red-300 text-red-950 font-bold'
  if (r >= 0.60) return 'bg-orange-300 text-orange-950 font-semibold'
  if (r >= 0.40) return 'bg-yellow-200 text-yellow-900'
  if (r >= 0.20) return 'bg-lime-100 text-lime-900'
  return 'bg-green-100 text-green-900'
}

// Ação derivada do delta (AUMENTAR / REDUZIR / OK / CALIBRADO)
function acaoFromDelta(delta: number, status: string): { label: string; cls: string } {
  if (status === 'calibrado') return { label: 'Calibrado', cls: 'bg-blue-100 text-blue-800' }
  if (delta > 0)  return { label: 'Aumentar', cls: 'bg-emerald-100 text-emerald-800 font-semibold' }
  if (delta < 0)  return { label: 'Reduzir',  cls: 'bg-rose-100 text-rose-800 font-semibold' }
  return { label: 'OK', cls: 'text-slate-500' }
}

// Endereço formatado
function fmt(s: Slot) {
  return [s.rua, s.predio, s.apto].filter(v => v != null).join('-') || '—'
}

// ─── Componente de linha arrastável ──────────────────────────────────────────

function SlotRow({
  item, slot, index, moved, total, selected, pendingSwap, onSelect,
  qtacessoMax,
  onMoveUp, onMoveDown,
  onDragStart, onDragOver, onDrop, onDragEnd,
  isDragOver, isDragging,
}: {
  item: Slot; slot: Slot; index: number; moved: boolean; total: number
  selected: boolean; pendingSwap: boolean; onSelect: () => void
  qtacessoMax: number
  onMoveUp: () => void; onMoveDown: () => void
  onDragStart: (i: number) => void
  onDragOver: (e: React.DragEvent, i: number) => void
  onDrop: (i: number) => void
  onDragEnd: () => void
  isDragOver: boolean; isDragging: boolean
}) {
  const sug = item.sugestao_editada ?? item.sugestao_calibragem
  // Sugestão em paletes (decimal, 2 casas)
  const sugPlt = item.norma_palete && item.norma_palete > 0
    ? sug / item.norma_palete
    : null
  // Palete atual = capacidade_atual / norma_palete (2 casas)
  const pltAtual = item.capacidade_atual != null && item.norma_palete && item.norma_palete > 0
    ? item.capacidade_atual / item.norma_palete
    : null
  const acao = acaoFromDelta(item.delta, item.status)
  const heatCls = qtacessoHeatClass(item.qt_acesso_90, qtacessoMax)
  const curvaCls = curvaBadge[item.classe_venda ?? ''] ?? 'bg-slate-200 text-slate-600'
  const isFL = item.fora_linha === true

  return (
    <tr
      data-row-index={index}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
      className={[
        'border-b text-xs select-none transition-colors',
        isDragging    ? 'opacity-50 ring-4 ring-inset ring-blue-600' : '',
        isDragOver && !isDragging ? 'bg-blue-200 ring-4 ring-inset ring-blue-500' : '',
        selected      ? 'bg-green-400 hover:bg-green-500'
                      : moved ? 'bg-orange-400 hover:bg-orange-500' : 'bg-white hover:bg-slate-50',
      ].join(' ')}
    >
      {/* Botão quadrado de seleção (tap-to-swap) */}
      <td className="py-1 px-1.5 align-middle">
        <button
          type="button"
          onPointerDown={e => { e.stopPropagation(); (e.currentTarget as any)._downXY = { x: e.clientX, y: e.clientY } }}
          onPointerUp={e => {
            const s = (e.currentTarget as any)._downXY as { x: number; y: number } | undefined
            ;(e.currentTarget as any)._downXY = undefined
            if (!s) return
            if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) onSelect()
          }}
          className={[
            'h-8 w-8 flex items-center justify-center rounded border-2 transition-colors touch-manipulation',
            selected
              ? 'bg-green-500 border-green-700 text-white shadow-md'
              : pendingSwap
                ? 'bg-blue-50 border-blue-500 text-blue-600 ring-2 ring-blue-200'
                : moved
                  ? 'bg-orange-500 border-orange-700 text-white'
                  : 'bg-white border-slate-400 text-slate-400 hover:border-slate-700 hover:text-slate-700',
          ].join(' ')}
          title={
            selected
              ? 'Selecionado — toque em outro produto p/ trocar de endereço, ou aqui p/ cancelar'
              : pendingSwap
                ? 'Toque para trocar de endereço com o produto VERDE'
                : 'Toque para selecionar este produto p/ trocar de endereço'
          }
          aria-pressed={selected}
        >
          {selected
            ? <Check className="h-4 w-4" strokeWidth={3} />
            : pendingSwap
              ? <ArrowLeftRight className="h-4 w-4" />
              : moved
                ? <Check className="h-4 w-4" strokeWidth={3} />
                : null}
        </button>
      </td>
      {/* Seq */}
      <td className="py-2 px-2 text-center text-slate-400 font-mono w-8">{index + 1}</td>
      {/* Endereço slot (destino fixo) */}
      <td className="py-2 px-2 font-mono font-medium whitespace-nowrap">{fmt(slot)}</td>
      {/* Produto — tap/click no nome também aciona seleção/troca. Badge FL vermelho se fora_linha */}
      <td
        className="py-2 px-2 max-w-[220px] cursor-pointer select-none touch-manipulation"
        onPointerDown={e => { (e.currentTarget as any)._downXY = { x: e.clientX, y: e.clientY } }}
        onPointerUp={e => {
          const s = (e.currentTarget as any)._downXY as { x: number; y: number } | undefined
          ;(e.currentTarget as any)._downXY = undefined
          if (!s) return
          if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) onSelect()
        }}
      >
        <div className="flex items-center gap-1">
          <span className="truncate font-medium" title={item.produto}>{item.produto}</span>
          {isFL && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600 text-white" title="Produto Fora de Linha">FL</span>}
        </div>
        <div className="text-[10px] text-muted-foreground">{item.codprod}</div>
      </td>
      {/* Curva — A=verde, B=amarelo, C=vermelho (por acesso ao picking) */}
      <td className="py-2 px-2 text-center">
        <span className={`inline-flex items-center justify-center h-6 w-6 rounded text-[11px] font-bold ${curvaCls}`}>
          {item.classe_venda ?? '—'}
        </span>
      </td>
      {/* QTACESSO — heat map relativo ao dataset */}
      <td className={`py-2 px-2 text-right whitespace-nowrap font-mono ${heatCls}`} title="Acessos ao picking nos últimos 90 dias">
        {item.qt_acesso_90 != null ? item.qt_acesso_90.toLocaleString('pt-BR') : '—'}
      </td>
      {/* Giro/dia */}
      <td className="py-2 px-2 text-right whitespace-nowrap text-slate-600" title="Giro médio diário em caixas">
        {item.giro_dia_cx != null ? item.giro_dia_cx.toFixed(2) : '—'}
      </td>
      {/* Ação */}
      <td className="py-2 px-2 text-center whitespace-nowrap">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${acao.cls}`}>{acao.label}</span>
      </td>
      {/* Cap. Atual */}
      <td className="py-2 px-2 text-right whitespace-nowrap">
        {item.capacidade_atual != null ? `${item.capacidade_atual} cx` : '—'}
      </td>
      {/* Plt. Atual (decimal, 2 casas) */}
      <td className="py-2 px-2 text-right whitespace-nowrap text-slate-600" title="Paletes que cabem na capacidade atual (capacidade ÷ norma_palete)">
        {pltAtual != null ? pltAtual.toFixed(2) : '—'}
      </td>
      {/* Sugestão (cx) */}
      <td className="py-2 px-2 text-right whitespace-nowrap font-semibold">
        {sug} cx
      </td>
      {/* Sug. Pallet (decimal, 2 casas) */}
      <td className="py-2 px-2 text-right whitespace-nowrap text-slate-500" title="Sugestão convertida em paletes (sug ÷ norma_palete)">
        {sugPlt != null ? sugPlt.toFixed(2) : '—'}
      </td>
      {/* Origem (endereço atual do produto) — destaca se moveu */}
      <td className={`py-2 px-2 font-mono whitespace-nowrap ${moved ? 'text-orange-950 font-bold' : 'text-slate-300'}`}>
        {moved ? fmt(item) : '—'}
      </td>
      {/* Botões ↑↓ (alternativa touch) */}
      <td className="py-1 px-1">
        <div className="flex flex-col gap-0.5">
          <button
            className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25"
            disabled={index === 0}
            onClick={onMoveUp}
            title="Trocar endereço com o produto acima"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25"
            disabled={index === total - 1}
            onClick={onMoveDown}
            title="Trocar endereço com o produto abaixo"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Geração do PDF via window.print() ───────────────────────────────────────

function gerarPDF(ruaSel: string, slots: Slot[], items: Slot[]) {
  const moves = slots
    .map((s, i) => ({ slot: s, product: items[i], moved: items[i].id !== s.id }))

  const totalMoves = moves.filter(m => m.moved).length
  const now = new Date().toLocaleString('pt-BR')
  const qtacessoMax = items.reduce((acc, it) => Math.max(acc, it.qt_acesso_90 ?? 0), 0)

  // Cores curva ABC (A=verde, B=amarelo, C=vermelho)
  const curvaBg: Record<string, string> = { A: '#16a34a', B: '#facc15', C: '#dc2626' }
  const curvaFg: Record<string, string> = { A: '#fff',    B: '#713f12', C: '#fff' }

  // Heat map QTACESSO (mesma escala da UI)
  const heatStyle = (v: number | null): string => {
    if (v == null || qtacessoMax <= 0) return ''
    const r = v / qtacessoMax
    if (r >= 0.80) return 'background:#fca5a5;color:#450a0a;font-weight:700'
    if (r >= 0.60) return 'background:#fdba74;color:#431407;font-weight:600'
    if (r >= 0.40) return 'background:#fef08a;color:#713f12'
    if (r >= 0.20) return 'background:#ecfccb;color:#365314'
    return 'background:#dcfce7;color:#14532d'
  }

  // Ação derivada do delta
  const acaoLabel = (delta: number, status: string): { label: string; bg: string; fg: string } => {
    if (status === 'calibrado') return { label: 'Calibrado', bg: '#dbeafe', fg: '#1e3a8a' }
    if (delta > 0)  return { label: 'Aumentar', bg: '#d1fae5', fg: '#065f46' }
    if (delta < 0)  return { label: 'Reduzir',  bg: '#ffe4e6', fg: '#9f1239' }
    return { label: 'OK', bg: 'transparent', fg: '#64748b' }
  }

  const tableRows = moves.map((m, i) => {
    const sug = m.product.sugestao_editada ?? m.product.sugestao_calibragem
    const sugPlt = m.product.norma_palete && m.product.norma_palete > 0
      ? (sug / m.product.norma_palete).toFixed(2)
      : '—'
    const pltAtual = m.product.capacidade_atual != null && m.product.norma_palete && m.product.norma_palete > 0
      ? (m.product.capacidade_atual / m.product.norma_palete).toFixed(2)
      : '—'
    const cv = m.product.classe_venda ?? '—'
    const cvStyle = curvaBg[cv] ? `background:${curvaBg[cv]};color:${curvaFg[cv]};font-weight:700;text-align:center` : 'text-align:center'
    const heat = heatStyle(m.product.qt_acesso_90)
    const a = acaoLabel(m.product.delta, m.product.status)
    const acaoStyle = `background:${a.bg};color:${a.fg};text-align:center;font-weight:600`
    const rowBg = m.moved ? 'background:#fb923c;' : ''
    const flBadge = m.product.fora_linha
      ? ` <span style="background:#dc2626;color:#fff;padding:1px 4px;border-radius:3px;font-size:8px;font-weight:700;margin-left:4px">FL</span>`
      : ''
    return `
      <tr style="${rowBg}">
        <td>${i + 1}</td>
        <td><strong>${fmt(m.slot)}</strong></td>
        <td>${m.product.produto}${flBadge}</td>
        <td>${m.product.codprod}</td>
        <td style="${cvStyle}">${cv}</td>
        <td style="text-align:right;${heat}">${m.product.qt_acesso_90 != null ? m.product.qt_acesso_90.toLocaleString('pt-BR') : '—'}</td>
        <td style="text-align:right">${m.product.giro_dia_cx != null ? m.product.giro_dia_cx.toFixed(2) : '—'}</td>
        <td style="${acaoStyle}">${a.label}</td>
        <td style="text-align:right">${m.product.capacidade_atual ?? '—'} cx</td>
        <td style="text-align:right">${pltAtual}</td>
        <td style="text-align:right;font-weight:600">${sug} cx</td>
        <td style="text-align:right">${sugPlt}</td>
        <td style="color:${m.moved ? '#431407' : '#94a3b8'};font-weight:${m.moved ? '700' : '400'}">${m.moved ? fmt(m.product) : '—'}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Lote de Realocação — Rua ${ruaSel}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; font-family: Arial, sans-serif; }
    body { font-size: 11px; color: #1e293b; }
    h1 { font-size: 16px; margin: 0 0 2px; }
    .meta { font-size: 10px; color: #64748b; margin-bottom: 10px; }
    .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:600; }
    .badge-amber { background:#f97316; color:#fff; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #1e3a5f; color: #fff; padding: 5px 6px; text-align: left; font-size: 10px; white-space: nowrap; }
    td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; font-size: 10px; vertical-align: middle; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 12px; font-size: 9px; color: #94a3b8; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>Lote de Realocação &mdash; Rua ${ruaSel}</h1>
  <div class="meta">
    Gerado em: ${now} &nbsp;|&nbsp;
    Total de slots: ${slots.length} &nbsp;|&nbsp;
    <span class="badge badge-amber">${totalMoves} movimentaç${totalMoves === 1 ? 'ão' : 'ões'} necessári${totalMoves === 1 ? 'a' : 'as'}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>End. Destino</th>
        <th>Produto</th>
        <th>Código</th>
        <th>Curva</th>
        <th>QTACESSO</th>
        <th>Giro/dia</th>
        <th>Ação</th>
        <th>Cap. Atual</th>
        <th>Plt. Atual</th>
        <th>Sugestão</th>
        <th>Sug. Plt</th>
        <th>End. Origem</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">
    SmartPick &mdash; Painel de Realocação &mdash; Linhas em laranja indicam produtos a mover.
    Endereço Origem = localização atual do produto. Endereço Destino = onde deve ser colocado.
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) { toast.error('Permita popups para gerar o PDF'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpRealocacao() {
  const { token } = useAuth()
  const headers = { Authorization: `Bearer ${token}` }

  const [filialID,  setFilialID]  = useState('')
  const [cdID,      setCdID]      = useState('')
  const [ruaSel,    setRuaSel]    = useState('')
  const [loaded,    setLoaded]    = useState(false)
  const [slots,     setSlots]     = useState<Slot[]>([])   // endereços originais (fixos)
  const [items,     setItems]     = useState<Slot[]>([])   // produtos na ordem atual (arrastável)
  const [dragIdx,   setDragIdx]   = useState<number | null>(null)
  const [overIdx,   setOverIdx]   = useState<number | null>(null)
  const [loading,   setLoading]   = useState(false)
  // Single-select: produto atualmente marcado como "origem da troca pendente".
  // Próximo tap em outro produto efetua o swap. Tap no mesmo produto cancela.
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [predioFilter, setPredioFilter] = useState<PredioFilter>('todos')

  // Índices visíveis após filtro par/ímpar. Mapeiam para os índices reais em items/slots.
  // A reordenação/troca continua usando os índices reais — o filtro é só visual.
  const visibleIdx = items
    .map((_, i) => i)
    .filter(i => {
      const pred = slots[i]?.predio ?? 0
      if (predioFilter === 'par')   return pred % 2 === 0
      if (predioFilter === 'impar') return pred % 2 !== 0
      return true
    })

  // Heat map p/ QTACESSO usa o máximo do dataset visível
  const qtacessoMax = items.reduce((acc, it) => Math.max(acc, it.qt_acesso_90 ?? 0), 0)

  function handleSelect(id: number, idx: number) {
    // Nada selecionado → marca este produto como origem da troca
    if (selectedId === null) {
      setSelectedId(id)
      return
    }
    // Mesmo produto → cancela seleção
    if (selectedId === id) {
      setSelectedId(null)
      return
    }
    // Outro produto → executa a troca pareada
    const fromIdx = items.findIndex(it => it.id === selectedId)
    if (fromIdx === -1) {
      // origem sumiu (não deveria acontecer) → trata como nova seleção
      setSelectedId(id)
      return
    }
    setItems(prev => {
      const next = [...prev]
      ;[next[fromIdx], next[idx]] = [next[idx], next[fromIdx]]
      return next
    })
    // selectedId permanece — produto VERDE acompanhou a troca p/ o novo slot.
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: filiais = [] } = useQuery<SpFilial[]>({
    queryKey: ['filiais'],
    queryFn: async () => (await fetch('/api/filiais', { headers })).json(),
  })

  const { data: cds = [] } = useQuery<SpCD[]>({
    queryKey: ['sp-cds-filial', filialID],
    enabled: !!filialID,
    queryFn: async () => (await fetch(`/api/sp/filiais/${filialID}/cds`, { headers })).json(),
  })

  const { data: ruas = [] } = useQuery<number[]>({
    queryKey: ['sp-ruas', cdID],
    enabled: !!cdID,
    queryFn: async () => {
      const r = await fetch(`/api/sp/propostas/ruas?cd_id=${cdID}`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  // ── Carregar slots da rua ─────────────────────────────────────────────────
  async function carregarRua() {
    if (!cdID || !ruaSel) return
    setLoading(true)
    try {
      const p = new URLSearchParams({ cd_id: cdID, rua: ruaSel, limit: '9999' })
      const r = await fetch(`/api/sp/propostas?${p}`, { headers })
      if (!r.ok) throw new Error('Erro ao carregar propostas')
      const data: Slot[] = await r.json()
      // ordena por predio ASC, apto ASC
      const sorted = [...data].sort((a, b) => {
        if ((a.predio ?? 0) !== (b.predio ?? 0)) return (a.predio ?? 0) - (b.predio ?? 0)
        return (a.apto ?? 0) - (b.apto ?? 0)
      })
      setSlots(sorted)
      setItems([...sorted])
      setLoaded(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  function handleDragStart(i: number) {
    setDragIdx(i)
  }
  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    setOverIdx(i)
  }
  function handleDrop(i: number) {
    if (dragIdx === null || dragIdx === i) return
    // Troca pareada: A vai pro endereço de B, B vai pro endereço de A. Demais slots intactos.
    setItems(prev => {
      const next = [...prev]
      ;[next[dragIdx], next[i]] = [next[i], next[dragIdx]]
      return next
    })
    setDragIdx(null)
    setOverIdx(null)
  }
  function handleDragEnd() {
    setDragIdx(null)
    setOverIdx(null)
  }

  function moveItem(index: number, dir: -1 | 1) {
    const next = index + dir
    if (next < 0 || next >= items.length) return
    setItems(prev => {
      const arr = [...prev]
      ;[arr[index], arr[next]] = [arr[next], arr[index]]
      return arr
    })
  }

  function resetar() {
    setItems([...slots])
    toast.info('Ordem restaurada para o original')
  }

  const totalMoves = items.filter((item, i) => item.id !== slots[i]?.id).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Painel de Realocação</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Toque no quadrado ▢ à esquerda de um produto p/ marcá-lo (verde), depois toque no quadrado de outro produto p/ trocar os endereços. No desktop você também pode arrastar e soltar.
        </p>
      </div>

      {/* Seletores */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium mb-1 block">Filial</label>
          <Select value={filialID} onValueChange={v => { setFilialID(v); setCdID(''); setRuaSel(''); setLoaded(false) }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Selecionar filial" /></SelectTrigger>
            <SelectContent>
              {filiais.map(f => (
                <SelectItem key={f.id} value={String(f.id)}>{f.nome} (cód. {f.cod_filial})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">CD</label>
          <Select value={cdID} onValueChange={v => { setCdID(v); setRuaSel(''); setLoaded(false) }} disabled={!filialID}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Selecionar CD" /></SelectTrigger>
            <SelectContent>
              {cds.map(cd => <SelectItem key={cd.id} value={String(cd.id)}>{cd.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">Rua</label>
          <Select value={ruaSel} onValueChange={v => { setRuaSel(v); setLoaded(false) }} disabled={!cdID || ruas.length === 0}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder={ruas.length === 0 ? 'Sem ruas' : 'Rua'} />
            </SelectTrigger>
            <SelectContent>
              {ruas.map(r => <SelectItem key={r} value={String(r)}>Rua {r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          disabled={!cdID || !ruaSel || loading}
          onClick={carregarRua}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Carregar rua
        </Button>

        {/* Ações de reorganização — visíveis logo após carregar */}
        {loaded && slots.length > 0 && (
          <>
            <div className="w-px h-8 bg-border mx-1" />
            <Button size="sm" variant="outline" onClick={resetar} disabled={totalMoves === 0}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resetar ordem
            </Button>
            <Button
              size="sm"
              disabled={totalMoves === 0}
              onClick={() => gerarPDF(ruaSel, slots, items)}
            >
              <FileDown className="h-3.5 w-3.5 mr-1" />
              Gerar PDF do lote{totalMoves > 0 ? ` (${totalMoves} mov.)` : ''}
            </Button>
          </>
        )}
      </div>

      {/* Tabela de slots */}
      {loaded && slots.length > 0 && (
        <>
          {/* Info bar */}
          <div className="flex flex-wrap items-center gap-3 text-xs border rounded-lg px-3 py-2 bg-slate-50">
            <span className="font-medium">Rua {ruaSel}</span>
            <span className="text-muted-foreground">|</span>
            <span>
              {slots.length} slots
              {predioFilter !== 'todos' && (
                <span className="ml-1 text-muted-foreground">({visibleIdx.length} visíveis)</span>
              )}
            </span>
            <span className="text-muted-foreground">|</span>
            {totalMoves > 0
              ? <span className="px-2 py-0.5 bg-orange-500 text-white rounded font-semibold">{totalMoves} movimentaç{totalMoves === 1 ? 'ão' : 'ões'} identificada{totalMoves === 1 ? '' : 's'}</span>
              : <span className="text-green-700 font-medium">Nenhuma alteração</span>
            }
            <span className="text-muted-foreground">|</span>
            {/* Filtro prédio par/ímpar/todos */}
            <div className="inline-flex rounded-md border bg-white overflow-hidden" role="group" aria-label="Filtro de prédio">
              {(['todos','par','impar'] as PredioFilter[]).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setPredioFilter(opt)}
                  className={`px-2.5 py-1 text-[11px] font-medium border-l first:border-l-0 transition-colors ${
                    predioFilter === opt ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                  aria-pressed={predioFilter === opt}
                >
                  {opt === 'todos' ? 'Todos' : opt === 'par' ? 'Pares' : 'Ímpares'}
                </button>
              ))}
            </div>
            <span className="ml-auto text-muted-foreground text-[10px]">
              📱 Tap no ▢ p/ marcar (verde) → tap em outro ▢ p/ trocar &nbsp;·&nbsp; 🖱 Ou arraste a linha
            </span>
          </div>

          {/* Legenda */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground items-center">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-white border inline-block" />Sem alteração</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 border border-green-700 inline-block" />Selecionado</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-orange-400 border border-orange-500 inline-block" />Realocado</span>
            <span className="text-muted-foreground">|</span>
            <span className="flex items-center gap-1">Curva:
              <span className="inline-flex items-center justify-center h-4 w-4 rounded text-[9px] font-bold bg-green-600 text-white">A</span>
              <span className="inline-flex items-center justify-center h-4 w-4 rounded text-[9px] font-bold bg-yellow-400 text-yellow-900">B</span>
              <span className="inline-flex items-center justify-center h-4 w-4 rounded text-[9px] font-bold bg-red-600 text-white">C</span>
            </span>
            <span className="text-muted-foreground">|</span>
            <span className="flex items-center gap-1">QTACESSO:
              <span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
              <span className="inline-block w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400" />
              <span className="inline-block w-3 h-3 rounded-sm bg-orange-300 border border-orange-400" />
              <span className="inline-block w-3 h-3 rounded-sm bg-red-300 border border-red-400" />
              <span className="text-[10px]">baixo → alto</span>
            </span>
            <span className="text-muted-foreground">|</span>
            <span className="flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600 text-white">FL</span>Fora de Linha</span>
          </div>

          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full min-w-[1180px]">
              <thead>
                <tr className="bg-slate-800 text-white text-[11px]">
                  <th className="py-2 px-1 w-12 text-center" title="Tap p/ selecionar / trocar"></th>
                  <th className="py-2 px-2 w-8 text-center">#</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">End. Destino</th>
                  <th className="py-2 px-2 text-left">Produto</th>
                  <th className="py-2 px-2 w-12 text-center" title="Curva ABC por acesso ao picking">Curva</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Acessos ao picking nos últimos 90 dias">QTACESSO</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Giro médio diário em caixas">Giro/dia</th>
                  <th className="py-2 px-2 text-center whitespace-nowrap">Ação</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Cap. Atual</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Paletes na capacidade atual">Plt. Atual</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Sugestão</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Sugestão em paletes">Sug. Plt</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">End. Origem</th>
                  <th className="py-2 px-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {visibleIdx.map(i => {
                  const item = items[i]
                  return (
                    <SlotRow
                      key={item.id}
                      item={item}
                      slot={slots[i]}
                      index={i}
                      moved={item.id !== slots[i].id}
                      total={items.length}
                      selected={selectedId === item.id}
                      pendingSwap={selectedId !== null && selectedId !== item.id}
                      onSelect={() => handleSelect(item.id, i)}
                      qtacessoMax={qtacessoMax}
                      onMoveUp={() => moveItem(i, -1)}
                      onMoveDown={() => moveItem(i, 1)}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      isDragOver={overIdx === i}
                      isDragging={dragIdx === i}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] text-muted-foreground pt-1">
            O PDF abrirá em nova aba — use Ctrl+P ou "Imprimir" e escolha "Salvar como PDF"
          </div>
        </>
      )}

      {loaded && slots.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12 border rounded-lg">
          Nenhum slot encontrado para a Rua {ruaSel}.
        </div>
      )}
    </div>
  )
}
