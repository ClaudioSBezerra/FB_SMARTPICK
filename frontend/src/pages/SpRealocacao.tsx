import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { ArrowUp, ArrowDown, Check, ArrowLeftRight, RotateCcw, FileDown, Loader2, Filter, StickyNote, Download } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
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
  participacao: number | null      // % participação na curva ABC (filtrado por tipo_rel=REALOCACAO)
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

// Colunas ordenáveis na Realocação ('' = ordem física padrão)
type SortKey = '' | 'destino' | 'produto' | 'curva' | 'qtacesso' | 'giro'
  | 'acao' | 'cap' | 'pltAtual' | 'sugestao' | 'sugPlt' | 'normaPalete' | 'origem' | 'obs'

// Persistência local — sobrevive a recarga/timeout de sessão dentro do MESMO import.
// Chave por (cd, rua). Restauração só acontece se os ids do dataset atual cobrem o salvo
// (caso contrário descarta — ids mudaram após reimport).
const realocStorageKey = (cd: string, rua: string) => `sp:realoc:${cd}:${rua}`
interface SavedRealoc { itemIds: number[]; observacoes: Record<number, string> }

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

const OBS_MAX = 70

function SlotRow({
  item, slot, index, moved, total, selected, pendingSwap, onSelect,
  qtacessoMax, sortActive,
  observacao, onObservacaoChange,
  onMoveUp, onMoveDown,
  onDragStart, onDragOver, onDrop, onDragEnd,
  isDragOver, isDragging,
}: {
  item: Slot; slot: Slot; index: number; moved: boolean; total: number
  selected: boolean; pendingSwap: boolean; onSelect: () => void
  qtacessoMax: number
  sortActive: boolean   // ordenado por coluna → drag/setas desabilitados
  observacao: string
  onObservacaoChange: (value: string) => void
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
      draggable={!sortActive}
      onDragStart={() => { if (!sortActive) onDragStart(index) }}
      onDragOver={e => { if (!sortActive) onDragOver(e, index) }}
      onDrop={() => { if (!sortActive) onDrop(index) }}
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
      {/* Curva — A=verde, B=amarelo, C=vermelho (por acesso ao picking) + % participação à direita */}
      <td className="py-2 px-2">
        <div className="flex items-center justify-center gap-1.5">
          <span className={`inline-flex items-center justify-center h-6 w-6 rounded text-[11px] font-bold shrink-0 ${curvaCls}`}>
            {item.classe_venda ?? '—'}
          </span>
          {item.participacao != null && (
            <span className="text-sm font-bold text-slate-700 whitespace-nowrap">{item.participacao.toFixed(2)}%</span>
          )}
        </div>
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
      {/* Norma Palete (caixas por palete) */}
      <td className="py-2 px-2 text-right whitespace-nowrap text-slate-600" title="Norma de palete — caixas por palete">
        {item.norma_palete != null ? item.norma_palete : '—'}
      </td>
      {/* Origem (endereço atual do produto) — destaca se moveu */}
      <td className={`py-2 px-2 font-mono whitespace-nowrap ${moved ? 'text-orange-950 font-bold' : 'text-slate-300'}`}>
        {moved ? fmt(item) : '—'}
      </td>
      {/* Observação — clique p/ editar (até 70 chars), vai p/ PDF */}
      <td className="py-1 px-1.5 max-w-[140px]" onClick={e => e.stopPropagation()}>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`flex items-center gap-1 w-full text-left rounded px-1.5 py-1 transition-colors ${
                observacao
                  ? 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200'
                  : 'text-slate-300 hover:text-slate-700 hover:bg-slate-100'
              }`}
              title={observacao || 'Clique para adicionar observação (até 70 caracteres)'}
            >
              <StickyNote className={`h-3.5 w-3.5 shrink-0 ${observacao ? 'text-amber-600' : ''}`} />
              <span className="truncate text-[10px]">
                {observacao || 'add. obs.'}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="end" onClick={e => e.stopPropagation()}>
            <div className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Observação · {item.produto}
            </div>
            <Textarea
              value={observacao}
              onChange={e => onObservacaoChange(e.target.value.slice(0, OBS_MAX))}
              placeholder="Anote algo sobre este item (sairá no PDF)…"
              className="text-xs min-h-[60px] resize-none"
              maxLength={OBS_MAX}
              autoFocus
            />
            <div className="flex items-center justify-between mt-1">
              <span className={`text-[10px] ${observacao.length >= OBS_MAX ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                {observacao.length}/{OBS_MAX}
              </span>
              {observacao && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                  onClick={() => onObservacaoChange('')}
                >
                  limpar
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </td>
      {/* Botões ↑↓ (alternativa touch) — desabilitados quando ordenado por coluna */}
      <td className="py-1 px-1">
        <div className="flex flex-col gap-0.5">
          <button
            className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25"
            disabled={sortActive || index === 0}
            onClick={onMoveUp}
            title={sortActive ? 'Volte à ordem física para mover' : 'Trocar endereço com o produto acima'}
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25"
            disabled={sortActive || index === total - 1}
            onClick={onMoveDown}
            title={sortActive ? 'Volte à ordem física para mover' : 'Trocar endereço com o produto abaixo'}
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Geração do PDF via window.print() ───────────────────────────────────────

// Escapa HTML para evitar injeção via observação digitada pelo usuário
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function gerarPDF(ruaSel: string, slots: Slot[], items: Slot[], observacoes: Record<number, string>, onlyMoves: boolean) {
  const allMoves = slots
    .map((s, i) => ({ slot: s, product: items[i], moved: items[i].id !== s.id }))
  const moves = onlyMoves ? allMoves.filter(m => m.moved) : allMoves

  const totalMoves = allMoves.filter(m => m.moved).length
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
    const obs = observacoes[m.product.id] ?? ''
    const obsCell = obs
      ? `<td style="background:#fef3c7;color:#78350f;font-style:italic;white-space:normal;max-width:160px">${escapeHtml(obs)}</td>`
      : `<td style="color:#cbd5e1">—</td>`
    return `
      <tr style="${rowBg}">
        <td>${i + 1}</td>
        <td><strong>${fmt(m.slot)}</strong></td>
        <td>${escapeHtml(m.product.produto)}${flBadge}</td>
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
        ${obsCell}
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
  <h1>Lote de Realocação &mdash; Rua ${ruaSel}${onlyMoves ? ' (apenas movimentações)' : ''}</h1>
  <div class="meta">
    Gerado em: ${now} &nbsp;|&nbsp;
    Total de slots: ${slots.length}${onlyMoves ? ` &nbsp;|&nbsp; Exibindo: ${moves.length} movimentaç${moves.length === 1 ? 'ão' : 'ões'}` : ''} &nbsp;|&nbsp;
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
        <th>Observação</th>
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

// ─── Funil de filtro no cabeçalho (estilo Excel) ─────────────────────────────

function HeaderFilter({
  active, children, label, dark,
}: {
  active: boolean
  children: React.ReactNode
  label?: string
  dark?: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Filtrar ${label}` : 'Filtrar coluna'}
          className={`inline-flex items-center justify-center h-5 w-5 rounded transition-colors ${
            active
              ? 'bg-blue-200 text-blue-900 hover:bg-blue-300'
              : dark
                ? 'text-white/60 hover:text-white hover:bg-white/10'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted'
          }`}
          onClick={e => e.stopPropagation()}
        >
          <Filter className="h-3 w-3" fill={active ? 'currentColor' : 'none'} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[200px] p-2" align="start">
        {label && <div className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">{label}</div>}
        {children}
      </PopoverContent>
    </Popover>
  )
}

// ─── Cabeçalho clicável p/ ordenar (só visualização) ─────────────────────────

function SortLabel({
  label, col, sortKey, sortDir, onSort,
}: {
  label: React.ReactNode
  col: Exclude<SortKey, ''>
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (c: Exclude<SortKey, ''>) => void
}) {
  const active = sortKey === col
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      title="Clique para ordenar (só visualização — não move nada)"
      className={`inline-flex items-center gap-0.5 hover:text-white transition-colors ${active ? 'font-bold underline' : ''}`}
    >
      {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  )
}

// ─── Filtro de faixa numérica (min/max) ──────────────────────────────────────

function NumRange({
  label, min, max, onMin, onMax,
}: {
  label: string
  min: string
  max: string
  onMin: (v: string) => void
  onMax: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">{label}</label>
      <Input
        type="number"
        placeholder="min"
        value={min}
        onChange={e => onMin(e.target.value)}
        className="h-7 text-xs w-14"
      />
      <Input
        type="number"
        placeholder="máx"
        value={max}
        onChange={e => onMax(e.target.value)}
        className="h-7 text-xs w-14"
      />
    </div>
  )
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
  const [pdfOnlyMoves, setPdfOnlyMoves] = useState(false)   // PDF apenas com movimentações
  const [isExporting, setIsExporting] = useState(false)     // estado do botão Excel
  // Observações por produto (item.id) — escopo de sessão. Acompanham o produto
  // mesmo após swap (chave é o id do produto, não do slot/destino).
  const [observacoes, setObservacoes] = useState<Record<number, string>>({})
  function setObservacao(id: number, value: string) {
    setObservacoes(prev => {
      const next = { ...prev }
      if (value) next[id] = value
      else delete next[id]
      return next
    })
  }

  // Persiste items+observações no localStorage chaveado por (cd, rua) — só após
  // o load, e só quando o usuário escolheu uma rua. Não roda em SSR.
  useEffect(() => {
    if (!loaded || !cdID || !ruaSel || items.length === 0) return
    try {
      const data: SavedRealoc = { itemIds: items.map(it => it.id), observacoes }
      localStorage.setItem(realocStorageKey(cdID, ruaSel), JSON.stringify(data))
    } catch {
      // localStorage indisponível (modo privativo, quota cheia) — ignora silenciosamente
    }
  }, [items, observacoes, loaded, cdID, ruaSel])

  // ── Filtros por coluna (estilo Excel — visibilidade apenas, não altera ordem) ──
  const [fProduto,    setFProduto]    = useState('')   // descrição OU código (combinado)
  const [fCodigo,     setFCodigo]     = useState('')   // somente código do produto
  const [fCurva,      setFCurva]      = useState('')   // '' | 'A' | 'B' | 'C'
  const [fPartMin,    setFPartMin]    = useState('')   // % participação min
  const [fPartMax,    setFPartMax]    = useState('')   // % participação máx
  const [fAcao,       setFAcao]       = useState('')   // '' | 'Aumentar' | 'Reduzir' | 'OK' | 'Calibrado'
  const [fFL,         setFFL]         = useState('')   // '' | 'sim' | 'nao'
  const [fEndDestino, setFEndDestino] = useState('')
  const [fEndOrigem,  setFEndOrigem]  = useState('')   // '' | 'movidos' | 'parados'
  const [fQtacMin,    setFQtacMin]    = useState('')
  const [fQtacMax,    setFQtacMax]    = useState('')
  const [fGiroMin,    setFGiroMin]    = useState('')
  const [fGiroMax,    setFGiroMax]    = useState('')
  const [fCapMin,     setFCapMin]     = useState('')
  const [fCapMax,     setFCapMax]     = useState('')
  const [fPltAtMin,   setFPltAtMin]   = useState('')
  const [fPltAtMax,   setFPltAtMax]   = useState('')
  const [fSugMin,     setFSugMin]     = useState('')
  const [fSugMax,     setFSugMax]     = useState('')
  const [fSugPltMin,  setFSugPltMin]  = useState('')
  const [fSugPltMax,  setFSugPltMax]  = useState('')
  const [fNormaMin,   setFNormaMin]   = useState('')   // norma palete min
  const [fNormaMax,   setFNormaMax]   = useState('')   // norma palete máx
  const [fObs,        setFObs]        = useState('')   // texto da observação
  const [fObsTipo,    setFObsTipo]    = useState('')   // '' | 'com' | 'sem'

  const hasFilters = !!(fProduto || fCodigo || fCurva || fAcao || fFL || fEndDestino || fEndOrigem
    || fPartMin || fPartMax
    || fQtacMin || fQtacMax || fGiroMin || fGiroMax || fCapMin || fCapMax
    || fPltAtMin || fPltAtMax || fSugMin || fSugMax || fSugPltMin || fSugPltMax
    || fNormaMin || fNormaMax || fObs || fObsTipo)

  // Ordenação por coluna — SÓ visualização (não move nada). Quando ativa,
  // arrastar e setas ↑↓ ficam desabilitados (dependem da posição física).
  const [sortKey, setSortKey] = useState<SortKey>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const sortActive = sortKey !== ''
  function toggleSort(key: Exclude<SortKey, ''>) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSortKey(''); setSortDir('asc')   // 3º clique volta à ordem física
  }

  function limparFiltros() {
    setFProduto(''); setFCodigo(''); setFCurva(''); setFAcao(''); setFFL('')
    setFEndDestino(''); setFEndOrigem(''); setFPartMin(''); setFPartMax('')
    setFQtacMin(''); setFQtacMax(''); setFGiroMin(''); setFGiroMax('')
    setFCapMin(''); setFCapMax(''); setFPltAtMin(''); setFPltAtMax('')
    setFSugMin(''); setFSugMax(''); setFSugPltMin(''); setFSugPltMax('')
    setFNormaMin(''); setFNormaMax(''); setFObs(''); setFObsTipo('')
  }

  // Índices visíveis após filtros. Mapeiam para os índices reais em items/slots.
  // A reordenação/troca continua usando os índices reais — o filtro é só visual.
  const visibleIdx = items
    .map((_, i) => i)
    .filter(i => {
      const slot = slots[i]
      const it = items[i]
      if (!slot || !it) return false

      const pred = slot.predio ?? 0
      if (predioFilter === 'par'   && pred % 2 !== 0) return false
      if (predioFilter === 'impar' && pred % 2 === 0) return false

      if (fProduto) {
        const q = fProduto.toLowerCase()
        const matchDesc = it.produto?.toLowerCase().includes(q) ?? false
        const matchCode = String(it.codprod).includes(q)
        if (!matchDesc && !matchCode) return false
      }
      if (fCodigo && !String(it.codprod).includes(fCodigo.trim())) return false
      if (fCurva && it.classe_venda !== fCurva) return false
      if (fPartMin !== '' && (it.participacao ?? -Infinity) < Number(fPartMin)) return false
      if (fPartMax !== '' && (it.participacao ??  Infinity) > Number(fPartMax)) return false
      if (fFL === 'sim' && it.fora_linha !== true) return false
      if (fFL === 'nao' && it.fora_linha === true) return false

      if (fAcao) {
        const a = acaoFromDelta(it.delta, it.status).label
        if (a !== fAcao) return false
      }

      if (fEndDestino && !fmt(slot).includes(fEndDestino)) return false
      const moved = it.id !== slot.id
      if (fEndOrigem === 'movidos' && !moved) return false
      if (fEndOrigem === 'parados' && moved)  return false

      const range = (v: number | null, mn: string, mx: string) => {
        if (mn !== '' && (v ?? -Infinity) < Number(mn)) return false
        if (mx !== '' && (v ??  Infinity) > Number(mx)) return false
        return true
      }
      if (!range(it.qt_acesso_90,    fQtacMin,   fQtacMax))   return false
      if (!range(it.giro_dia_cx,     fGiroMin,   fGiroMax))   return false
      if (!range(it.capacidade_atual, fCapMin,    fCapMax))   return false

      const np = it.norma_palete
      const pltAtual = it.capacidade_atual != null && np && np > 0 ? it.capacidade_atual / np : null
      if (!range(pltAtual, fPltAtMin, fPltAtMax)) return false

      const sug = it.sugestao_editada ?? it.sugestao_calibragem
      if (!range(sug, fSugMin, fSugMax)) return false

      const sugPlt = np && np > 0 ? sug / np : null
      if (!range(sugPlt, fSugPltMin, fSugPltMax)) return false

      if (!range(it.norma_palete, fNormaMin, fNormaMax)) return false

      const obs = observacoes[it.id] ?? ''
      if (fObsTipo === 'com' && !obs) return false
      if (fObsTipo === 'sem' && obs)  return false
      if (fObs && !obs.toLowerCase().includes(fObs.toLowerCase())) return false

      return true
    })

  // Aplica ordenação por coluna (só visualização). Sem sort → ordem física.
  const orderedIdx = (() => {
    if (!sortActive) return visibleIdx
    const dir = sortDir === 'asc' ? 1 : -1
    const num = (v: number | null | undefined) => v ?? -Infinity
    const val = (i: number): number | string => {
      const it = items[i], slot = slots[i]
      const np = it.norma_palete
      switch (sortKey) {
        case 'destino':  return (slot.rua ?? 0) * 1e6 + (slot.predio ?? 0) * 1e3 + (slot.apto ?? 0)
        case 'produto':  return it.produto?.toLowerCase() ?? ''
        case 'curva':    return num(it.participacao)  // ordena pela % de participação
        case 'qtacesso': return num(it.qt_acesso_90)
        case 'giro':     return num(it.giro_dia_cx)
        case 'acao':     return it.delta ?? 0
        case 'cap':      return num(it.capacidade_atual)
        case 'pltAtual': return it.capacidade_atual != null && np && np > 0 ? it.capacidade_atual / np : -Infinity
        case 'sugestao': return it.sugestao_editada ?? it.sugestao_calibragem ?? 0
        case 'sugPlt':   return np && np > 0 ? (it.sugestao_editada ?? it.sugestao_calibragem) / np : -Infinity
        case 'normaPalete': return num(it.norma_palete)
        case 'origem':   return it.id !== slot.id ? 1 : 0  // movidos primeiro/depois
        case 'obs':      return (observacoes[it.id] ?? '').toLowerCase()
        default:         return 0
      }
    }
    return [...visibleIdx].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * dir
      }
      return (va - vb) * dir
    })
  })()

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
    queryFn: async () => (await fetch(`/api/sp/filiais/${filialID}/cds?ativo=true`, { headers })).json(),
  })

  const { data: ruas = [] } = useQuery<number[]>({
    queryKey: ['sp-ruas', cdID],
    enabled: !!cdID,
    queryFn: async () => {
      const r = await fetch(`/api/sp/propostas/ruas?cd_id=${cdID}&tipo_rel=REALOCACAO`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  // ── Carregar slots da rua ─────────────────────────────────────────────────
  async function carregarRua() {
    if (!cdID || !ruaSel) return
    setLoading(true)
    try {
      // Painel de Realocação mostra apenas propostas do processo REALOCACAO.
      const p = new URLSearchParams({ cd_id: cdID, rua: ruaSel, tipo_rel: 'REALOCACAO', limit: '9999' })
      const r = await fetch(`/api/sp/propostas?${p}`, { headers })
      if (!r.ok) throw new Error('Erro ao carregar propostas')
      const data: Slot[] = await r.json()
      // ordena por predio ASC, apto ASC
      const sorted = [...data].sort((a, b) => {
        if ((a.predio ?? 0) !== (b.predio ?? 0)) return (a.predio ?? 0) - (b.predio ?? 0)
        return (a.apto ?? 0) - (b.apto ?? 0)
      })
      setSlots(sorted)

      // Tenta restaurar trabalho anterior (swaps + observações) salvo no localStorage
      let restoredItems: Slot[] | null = null
      let restoredObs:   Record<number, string> = {}
      try {
        const raw = localStorage.getItem(realocStorageKey(cdID, ruaSel))
        if (raw) {
          const saved = JSON.parse(raw) as Partial<SavedRealoc>
          if (Array.isArray(saved.itemIds) && saved.itemIds.length === sorted.length) {
            const ids = new Set(sorted.map(s => s.id))
            const allMatch = saved.itemIds.every(id => ids.has(id))
            if (allMatch) {
              const byId = new Map(sorted.map(s => [s.id, s]))
              restoredItems = saved.itemIds.map(id => byId.get(id)!).filter(Boolean) as Slot[]
              restoredObs   = (saved.observacoes ?? {}) as Record<number, string>
            } else {
              // ids mudaram (reimport) → descarta saved obsoleto
              localStorage.removeItem(realocStorageKey(cdID, ruaSel))
            }
          }
        }
      } catch { /* localStorage indisponível */ }

      if (restoredItems) {
        setItems(restoredItems)
        setObservacoes(restoredObs)
        const movs = restoredItems.filter((it, i) => it.id !== sorted[i].id).length
        toast.success(`Trabalho anterior restaurado: ${movs} movimentaç${movs === 1 ? 'ão' : 'ões'} e ${Object.keys(restoredObs).length} observaç${Object.keys(restoredObs).length === 1 ? 'ão' : 'ões'}`)
      } else {
        setItems([...sorted])
        setObservacoes({})
      }

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

  // Exporta para Excel respeitando os filtros visíveis (visibleIdx)
  async function exportarExcel() {
    if (visibleIdx.length === 0) return
    setIsExporting(true)
    try {
      const XLSX = await import('xlsx')
      const today = new Date().toLocaleDateString('sv-SE')
      const data = visibleIdx.map(i => {
        const it = items[i], slot = slots[i]
        const moved = it.id !== slot.id
        const np = it.norma_palete
        const sug = it.sugestao_editada ?? it.sugestao_calibragem
        return {
          '#':              i + 1,
          'End. Destino':   fmt(slot),
          'Produto':        it.produto ?? '',
          'Código':         it.codprod,
          'FL':             it.fora_linha ? 'S' : 'N',
          'Curva':          it.classe_venda ?? '',
          '% Participação': it.participacao != null ? +it.participacao.toFixed(2) : '',
          'QTACESSO':       it.qt_acesso_90 ?? '',
          'Giro/dia':       it.giro_dia_cx != null ? +it.giro_dia_cx.toFixed(2) : '',
          'Ação':           acaoFromDelta(it.delta, it.status).label,
          'Cap. Atual (cx)': it.capacidade_atual ?? '',
          'Plt. Atual':     it.capacidade_atual != null && np && np > 0 ? +(it.capacidade_atual / np).toFixed(2) : '',
          'Sugestão (cx)':  sug,
          'Sug. Plt':       np && np > 0 ? +(sug / np).toFixed(2) : '',
          'Norma Plt':      np ?? '',
          'End. Origem':    moved ? fmt(it) : '',
          'Observação':     observacoes[it.id] ?? '',
          'Movido':         moved ? 'Sim' : 'Não',
        }
      })
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Realocação')
      XLSX.writeFile(wb, `realocacao_rua${ruaSel}_${today}.xlsx`)
      toast.success(`${visibleIdx.length} linhas exportadas`)
    } catch (err) {
      toast.error('Falha ao exportar: ' + (err as Error).message)
    } finally {
      setIsExporting(false)
    }
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
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={pdfOnlyMoves}
                onChange={e => setPdfOnlyMoves(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span title="Quando marcado, o PDF lista somente os slots com movimentação">Apenas movim.</span>
            </label>
            <Button
              size="sm"
              disabled={totalMoves === 0}
              onClick={() => gerarPDF(ruaSel, slots, items, observacoes, pdfOnlyMoves)}
            >
              <FileDown className="h-3.5 w-3.5 mr-1" />
              Gerar PDF{totalMoves > 0 ? ` (${pdfOnlyMoves ? totalMoves : slots.length} ${pdfOnlyMoves ? 'mov.' : 'slots'})` : ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={visibleIdx.length === 0 || isExporting}
              onClick={exportarExcel}
            >
              {isExporting
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Download className="h-3.5 w-3.5 mr-1" />}
              {isExporting ? 'Exportando…' : `Exportar Excel${hasFilters ? ` (${visibleIdx.length})` : ''}`}
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
              {(predioFilter !== 'todos' || hasFilters) && (
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

          {/* Barra slim — filtros agora ficam nos cabeçalhos da grid */}
          {hasFilters && (
            <div className="flex items-center">
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
                onClick={limparFiltros}
              >
                limpar filtros
              </button>
            </div>
          )}

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

          {sortActive && (
            <div className="flex items-center gap-2 text-[11px] rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
              <span className="font-semibold">Modo visualização (ordenado)</span>
              <span>— arrastar e setas ↑↓ desabilitados. O tap-trocar continua funcionando.</span>
              <button
                className="ml-auto underline font-medium hover:text-amber-950"
                onClick={() => { setSortKey(''); setSortDir('asc') }}
              >
                voltar à ordem física
              </button>
            </div>
          )}

          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full min-w-[1460px]">
              <thead>
                <tr className="bg-slate-800 text-white text-[11px]">
                  <th className="py-2 px-1 w-12 text-center" title="Tap p/ selecionar / trocar"></th>
                  <th className="py-2 px-2 w-8 text-center">#</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <SortLabel label="End. Destino" col="destino" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!fEndDestino} label="End. Destino" dark>
                        <Input
                          placeholder="ex: 12-3"
                          value={fEndDestino}
                          onChange={e => setFEndDestino(e.target.value)}
                          className="h-7 text-xs w-40"
                        />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-left">
                    <span className="inline-flex items-center gap-1">
                      <SortLabel label="Produto" col="produto" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fProduto || fCodigo || fFL)} label="Produto" dark>
                        <div className="space-y-2 w-56">
                          <div>
                            <div className="text-[10px] font-medium text-muted-foreground mb-1">Código ou descrição</div>
                            <Input
                              placeholder="busca combinada…"
                              value={fProduto}
                              onChange={e => setFProduto(e.target.value)}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <div className="text-[10px] font-medium text-muted-foreground mb-1">Somente código</div>
                            <Input
                              placeholder="ex: 12345"
                              value={fCodigo}
                              onChange={e => setFCodigo(e.target.value)}
                              className="h-7 text-xs"
                              inputMode="numeric"
                            />
                          </div>
                          <div>
                            <div className="text-[10px] font-medium text-muted-foreground mb-1">Fora de linha (FL)</div>
                            <Select value={fFL || 'all'} onValueChange={v => setFFL(v === 'all' ? '' : v)}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="sim">Apenas FL</SelectItem>
                                <SelectItem value="nao">Excluir FL</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 w-24 text-center" title="Curva ABC por acesso ao picking — letra + % participação">
                    <span className="inline-flex items-center gap-1 justify-center">
                      <SortLabel label="Curva" col="curva" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fCurva || fPartMin || fPartMax)} label="Curva / % participação" dark>
                        <div className="space-y-2 w-48">
                          <Select value={fCurva || 'all'} onValueChange={v => setFCurva(v === 'all' ? '' : v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todas as curvas</SelectItem>
                              <SelectItem value="A">A</SelectItem>
                              <SelectItem value="B">B</SelectItem>
                              <SelectItem value="C">C</SelectItem>
                            </SelectContent>
                          </Select>
                          <div>
                            <div className="text-[10px] font-medium text-muted-foreground mb-1">% participação</div>
                            <NumRange label="%" min={fPartMin} max={fPartMax} onMin={setFPartMin} onMax={setFPartMax} />
                          </div>
                        </div>
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Acessos ao picking nos últimos 90 dias">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="QTACESSO" col="qtacesso" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fQtacMin || fQtacMax)} label="QTACESSO" dark>
                        <NumRange label="QTAC" min={fQtacMin} max={fQtacMax} onMin={setFQtacMin} onMax={setFQtacMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Giro médio diário em caixas">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="Giro/dia" col="giro" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fGiroMin || fGiroMax)} label="Giro/dia" dark>
                        <NumRange label="Giro" min={fGiroMin} max={fGiroMax} onMin={setFGiroMin} onMax={setFGiroMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 justify-center">
                      <SortLabel label="Ação" col="acao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!fAcao} label="Ação" dark>
                        <Select value={fAcao || 'all'} onValueChange={v => setFAcao(v === 'all' ? '' : v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todas</SelectItem>
                            <SelectItem value="Aumentar">Aumentar</SelectItem>
                            <SelectItem value="Reduzir">Reduzir</SelectItem>
                            <SelectItem value="OK">OK</SelectItem>
                            <SelectItem value="Calibrado">Calibrado</SelectItem>
                          </SelectContent>
                        </Select>
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="Cap. Atual" col="cap" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fCapMin || fCapMax)} label="Cap. Atual" dark>
                        <NumRange label="Cap." min={fCapMin} max={fCapMax} onMin={setFCapMin} onMax={setFCapMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Paletes na capacidade atual">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="Plt. Atual" col="pltAtual" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fPltAtMin || fPltAtMax)} label="Plt. Atual" dark>
                        <NumRange label="Plt." min={fPltAtMin} max={fPltAtMax} onMin={setFPltAtMin} onMax={setFPltAtMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="Sugestão" col="sugestao" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fSugMin || fSugMax)} label="Sugestão" dark>
                        <NumRange label="Sug." min={fSugMin} max={fSugMax} onMin={setFSugMin} onMax={setFSugMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Sugestão em paletes">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="Sug. Plt" col="sugPlt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fSugPltMin || fSugPltMax)} label="Sug. Plt" dark>
                        <NumRange label="Plt" min={fSugPltMin} max={fSugPltMax} onMin={setFSugPltMin} onMax={setFSugPltMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-right whitespace-nowrap" title="Norma de palete — caixas por palete">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <SortLabel label="Norma Plt" col="normaPalete" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fNormaMin || fNormaMax)} label="Norma Palete" dark>
                        <NumRange label="Norma" min={fNormaMin} max={fNormaMax} onMin={setFNormaMin} onMax={setFNormaMax} />
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <SortLabel label="End. Origem" col="origem" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!fEndOrigem} label="End. Origem" dark>
                        <Select value={fEndOrigem || 'all'} onValueChange={v => setFEndOrigem(v === 'all' ? '' : v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="movidos">Apenas movidos</SelectItem>
                            <SelectItem value="parados">Sem movimento</SelectItem>
                          </SelectContent>
                        </Select>
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-2 text-left whitespace-nowrap" title="Observações por produto — vão para o PDF">
                    <span className="inline-flex items-center gap-1">
                      <StickyNote className="h-3 w-3" />
                      <SortLabel label="Obs." col="obs" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <HeaderFilter active={!!(fObs || fObsTipo)} label="Observações" dark>
                        <div className="space-y-2 w-52">
                          <Input
                            placeholder="Buscar no texto…"
                            value={fObs}
                            onChange={e => setFObs(e.target.value)}
                            className="h-7 text-xs"
                          />
                          <Select value={fObsTipo || 'all'} onValueChange={v => setFObsTipo(v === 'all' ? '' : v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todos</SelectItem>
                              <SelectItem value="com">Com observação</SelectItem>
                              <SelectItem value="sem">Sem observação</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </HeaderFilter>
                    </span>
                  </th>
                  <th className="py-2 px-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {orderedIdx.map(i => {
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
                      sortActive={sortActive}
                      observacao={observacoes[item.id] ?? ''}
                      onObservacaoChange={v => setObservacao(item.id, v)}
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
