import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { ArrowUp, ArrowDown, GripVertical, RotateCcw, FileDown, Loader2 } from 'lucide-react'
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
  classe_venda: string | null
  capacidade_atual: number | null
  sugestao_calibragem: number
  sugestao_editada: number | null
  norma_palete: number | null
  status: string
  delta: number
}

// Endereço formatado
function fmt(s: Slot) {
  return [s.rua, s.predio, s.apto].filter(v => v != null).join('-') || '—'
}

// ─── Componente de linha arrastável ──────────────────────────────────────────

function SlotRow({
  item, slot, index, moved, total, selected, onToggleSelect,
  onMoveUp, onMoveDown,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onTouchDragStart,
  isDragOver, isDragging,
}: {
  item: Slot; slot: Slot; index: number; moved: boolean; total: number
  selected: boolean; onToggleSelect: () => void
  onMoveUp: () => void; onMoveDown: () => void
  onDragStart: (i: number) => void
  onDragOver: (e: React.DragEvent, i: number) => void
  onDrop: (i: number) => void
  onDragEnd: () => void
  onTouchDragStart: (i: number) => void
  isDragOver: boolean; isDragging: boolean
}) {
  const sug = item.sugestao_editada ?? item.sugestao_calibragem
  const plt = item.norma_palete && item.norma_palete > 0
    ? Math.ceil(sug / item.norma_palete)
    : null

  const curvaColor: Record<string, string> = {
    A: 'text-red-700 font-bold', B: 'text-yellow-700 font-semibold', C: 'text-green-700',
  }

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
        isDragging    ? 'opacity-40' : '',
        isDragOver && !isDragging ? 'bg-blue-100 ring-2 ring-inset ring-blue-400' : '',
        selected      ? 'bg-green-400 hover:bg-green-500'
                      : moved ? 'bg-orange-400 hover:bg-orange-500' : 'bg-white hover:bg-slate-50',
      ].join(' ')}
    >
      {/* Drag handle */}
      <td
        className="py-2 px-1 text-slate-400 cursor-grab active:cursor-grabbing touch-none"
        onTouchStart={() => onTouchDragStart(index)}
      >
        <GripVertical className="h-4 w-4" />
      </td>
      {/* Seq */}
      <td className="py-2 px-2 text-center text-slate-400 font-mono w-8">{index + 1}</td>
      {/* Endereço slot (destino fixo) */}
      <td className="py-2 px-2 font-mono font-medium whitespace-nowrap">{fmt(slot)}</td>
      {/* Produto */}
      <td
        className="py-2 px-2 max-w-[200px] cursor-pointer"
        onClick={onToggleSelect}
        title={selected ? 'Clique para desmarcar' : 'Clique para marcar como conferido'}
      >
        <div className="truncate font-medium">{item.produto}</div>
        <div className="text-[10px] text-muted-foreground">{item.codprod}</div>
      </td>
      {/* Curva */}
      <td className={`py-2 px-2 ${curvaColor[item.classe_venda ?? ''] ?? 'text-gray-600'}`}>
        {item.classe_venda ?? '—'}
      </td>
      {/* Cap */}
      <td className="py-2 px-2 text-right whitespace-nowrap">
        {item.capacidade_atual != null ? `${item.capacidade_atual} cx` : '—'}
      </td>
      {/* Sugestão */}
      <td className="py-2 px-2 text-right whitespace-nowrap font-semibold">
        {sug} cx
      </td>
      {/* Sug. Pallet */}
      <td className="py-2 px-2 text-right whitespace-nowrap text-slate-500">
        {plt != null ? `${plt} plt` : '—'}
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

  const tableRows = moves.map((m, i) => {
    const sug = m.product.sugestao_editada ?? m.product.sugestao_calibragem
    const plt = m.product.norma_palete && m.product.norma_palete > 0
      ? Math.ceil(sug / m.product.norma_palete)
      : '—'
    const rowBg = m.moved ? 'background:#fb923c;' : ''
    return `
      <tr style="${rowBg}">
        <td>${i + 1}</td>
        <td><strong>${fmt(m.slot)}</strong></td>
        <td>${m.product.produto}</td>
        <td>${m.product.codprod}</td>
        <td style="text-align:center">${m.product.classe_venda ?? '—'}</td>
        <td style="text-align:right">${m.product.capacidade_atual ?? '—'} cx</td>
        <td style="text-align:right;font-weight:600">${sug} cx</td>
        <td style="text-align:right">${plt}${typeof plt === 'number' ? ' plt' : ''}</td>
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
        <th>Endereço Destino</th>
        <th>Produto</th>
        <th>Código</th>
        <th>Curva</th>
        <th>Cap. Atual</th>
        <th>Sugestão</th>
        <th>Sug. Pallet</th>
        <th>Endereço Origem</th>
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [touchDragging, setTouchDragging] = useState(false)

  // Refs para os índices, lidos pelos listeners globais de touch (evita closure stale)
  const dragIdxRef = useRef<number | null>(null)
  const overIdxRef = useRef<number | null>(null)

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Touch-drag para mobile/tablet: HTML5 drag não suporta touch, então atachamos
  // listeners globais enquanto o usuário mantém o dedo no punho ⋮⋮ da linha.
  function handleTouchDragStart(i: number) {
    dragIdxRef.current = i
    overIdxRef.current = i
    setDragIdx(i)
    setOverIdx(i)
    setTouchDragging(true)
  }

  useEffect(() => {
    if (!touchDragging) return

    function onMove(e: TouchEvent) {
      e.preventDefault()
      const t = e.touches[0]
      if (!t) return
      const el = document.elementFromPoint(t.clientX, t.clientY)
      const tr = (el as Element | null)?.closest('tr[data-row-index]') as HTMLElement | null
      if (!tr) return
      const idx = parseInt(tr.dataset.rowIndex ?? '-1', 10)
      if (idx >= 0 && idx !== overIdxRef.current) {
        overIdxRef.current = idx
        setOverIdx(idx)
      }
    }

    function onEnd() {
      const from = dragIdxRef.current
      const to   = overIdxRef.current
      if (from !== null && to !== null && from !== to) {
        // Troca pareada (mobile): mesmo comportamento do drop com mouse.
        setItems(prev => {
          const next = [...prev]
          ;[next[from], next[to]] = [next[to], next[from]]
          return next
        })
      }
      dragIdxRef.current = null
      overIdxRef.current = null
      setDragIdx(null)
      setOverIdx(null)
      setTouchDragging(false)
    }

    document.addEventListener('touchmove',   onMove, { passive: false })
    document.addEventListener('touchend',    onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchmove',   onMove)
      document.removeEventListener('touchend',    onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [touchDragging])

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
          Selecione a rua, arraste um produto sobre outro para trocá-los de endereço e gere o lote de movimentação em PDF.
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
            <span>{slots.length} slots</span>
            <span className="text-muted-foreground">|</span>
            {totalMoves > 0
              ? <span className="px-2 py-0.5 bg-orange-500 text-white rounded font-semibold">{totalMoves} movimentaç{totalMoves === 1 ? 'ão' : 'ões'} identificada{totalMoves === 1 ? '' : 's'}</span>
              : <span className="text-green-700 font-medium">Nenhuma alteração</span>
            }
            <span className="ml-auto text-muted-foreground text-[10px]">
              🖱 Arraste um produto sobre outro para trocar endereços &nbsp;·&nbsp; 📱 No mobile use o punho ⋮⋮ ou ↑↓
            </span>
          </div>

          {/* Legenda */}
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-white border inline-block" />Sem alteração</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-orange-400 border border-orange-500 inline-block" />Produto realocado</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-400 border border-green-500 inline-block" />Conferido (clique no produto)</span>
            <span className="flex items-center gap-1 ml-auto text-[10px]">
              Endereço Destino = coluna fixa (slot físico) · Endereço Origem = de onde o produto virá
            </span>
          </div>

          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="bg-slate-800 text-white text-[11px]">
                  <th className="py-2 px-1 w-6"></th>
                  <th className="py-2 px-2 w-8 text-center">#</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">End. Destino</th>
                  <th className="py-2 px-2 text-left">Produto</th>
                  <th className="py-2 px-2 text-left w-12">Curva</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Cap. Atual</th>
                  <th className="py-2 px-2 text-right">Sugestão</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Sug. Pallet</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">End. Origem</th>
                  <th className="py-2 px-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <SlotRow
                    key={item.id}
                    item={item}
                    slot={slots[i]}
                    index={i}
                    moved={item.id !== slots[i].id}
                    total={items.length}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onMoveUp={() => moveItem(i, -1)}
                    onMoveDown={() => moveItem(i, 1)}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onTouchDragStart={handleTouchDragStart}
                    isDragOver={overIdx === i}
                    isDragging={dragIdx === i}
                  />
                ))}
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
