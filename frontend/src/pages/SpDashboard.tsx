import { useState, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { CheckCheck, ThumbsDown, RefreshCw, Pencil, Check, X, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Loader2, EyeOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { BatchStatusBar } from '@/components/BatchStatusBar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD     { id: number; filial_id: number; nome: string }
interface SpCSVJob {
  id: string; filename: string; status: string; created_at: string
  cd_id: number; filial_id: number
}

interface Proposta {
  id: number
  job_id: string
  endereco_id: number
  cd_id: number
  cod_filial: number
  codprod: number
  produto: string
  departamento?: string | null
  secao?: string | null
  rua: number | null
  predio: number | null
  apto: number | null
  classe_venda: string | null
  capacidade_atual: number | null
  sugestao_calibragem: number
  delta: number
  justificativa: string | null
  status: string
  sugestao_editada: number | null
  giro_dia_cx: number | null
  med_venda_cx: number | null
  ponto_reposicao: number | null
}

interface Resumo {
  total_pendente: number
  total_aprovada: number
  total_rejeitada: number
  falta_pendente: number
  espaco_pendente: number
  calibrado_total: number
  ignorado_total: number
  curva_a_mantida: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ClasseBadge({ classe }: { classe: string | null }) {
  if (!classe) return <span className="text-muted-foreground text-xs">—</span>
  const colors: Record<string, string> = {
    A: 'bg-red-100 text-red-800',
    B: 'bg-yellow-100 text-yellow-800',
    C: 'bg-green-100 text-green-800',
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-bold ${colors[classe] ?? 'bg-gray-100'}`}>
      {classe}
    </span>
  )
}

function AcaoBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs text-green-600 font-medium">OK</span>
  if (delta > 0) return (
    <span className="text-xs text-red-600 font-semibold">+{delta} cx</span>
  )
  return (
    <span className="text-xs text-yellow-700 font-semibold">{delta} cx</span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pendente:   'bg-yellow-100 text-yellow-800',
    aprovada:   'bg-green-100 text-green-800',
    rejeitada:  'bg-red-100 text-red-800',
    calibrado:  'bg-blue-100 text-blue-800',
    ignorado:   'bg-gray-100 text-gray-500',
  }
  const label: Record<string, string> = {
    pendente: 'Pendente', aprovada: 'Aprovada', rejeitada: 'Rejeitada',
    calibrado: 'Calibrado', ignorado: 'Ignorado',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100'}`}>
      {label[status] ?? status}
    </span>
  )
}

function calcIndicadores(p: Proposta) {
  const mv = p.med_venda_cx
  const cap = p.capacidade_atual
  const pr = p.ponto_reposicao
  const giroCap = mv != null && cap != null ? (mv >= cap ? 'Urgencia' : 'OK') : null
  const giroPR  = mv != null && pr  != null ? (pr <= mv  ? 'Ajustar'  : 'OK') : null
  const capDias2 = giroCap === 'OK' && mv != null && cap != null && cap > 0
    ? (mv / cap > 0.5 ? 'CAP Menor' : 'OK')
    : (mv != null && cap != null ? 'OK' : null)
  return { giroCap, giroPR, capDias2 }
}

const indicadorColors: Record<string, string> = {
  OK:          'bg-green-100 text-green-800',
  Urgencia:    'bg-red-100 text-red-800',
  Ajustar:     'bg-orange-100 text-orange-800',
  'CAP Menor': 'bg-yellow-100 text-yellow-800',
}

function IndicadorBadge({ valor }: { valor: string | null }) {
  if (!valor) return <span className="text-muted-foreground text-[10px]">—</span>
  const dotColor: Record<string, string> = {
    OK:          'bg-green-500',
    Urgencia:    'bg-red-500',
    Ajustar:     'bg-orange-500',
    'CAP Menor': 'bg-yellow-500',
  }
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-block w-2.5 h-2.5 rounded-full cursor-default ${dotColor[valor] ?? 'bg-gray-400'}`} />
        </TooltipTrigger>
        <TooltipContent className="text-xs">{valor}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function EnderecoCell({ rua, predio, apto }: { rua: number | null; predio: number | null; apto: number | null }) {
  const parts = [rua, predio, apto].filter(v => v != null)
  return <span className="text-xs font-mono">{parts.length ? parts.join('-') : '—'}</span>
}

// ─── Inline edit cell ─────────────────────────────────────────────────────────

function SugestaoCell({
  proposta, onSave,
}: {
  proposta: Proposta
  onSave: (id: number, valor: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(proposta.sugestao_editada ?? proposta.sugestao_calibragem))

  const efetivo = proposta.sugestao_editada ?? proposta.sugestao_calibragem
  const editada = proposta.sugestao_editada != null

  if (proposta.status !== 'pendente') {
    return <span className="text-xs">{efetivo}{editada ? ' ✎' : ''}</span>
  }

  if (!editing) {
    return (
      <button
        className="flex items-center gap-1 text-xs hover:text-primary group"
        onClick={() => { setVal(String(efetivo)); setEditing(true) }}
      >
        {efetivo}
        {editada && <span className="text-[10px] text-muted-foreground ml-0.5">editado</span>}
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={val}
        onChange={e => setVal(e.target.value)}
        className="h-6 w-16 text-xs px-1"
        type="number"
        min={1}
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') { onSave(proposta.id, Number(val)); setEditing(false) }
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button onClick={() => { onSave(proposta.id, Number(val)); setEditing(false) }}
        className="text-green-600 hover:text-green-700">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ─── Tabela de propostas ──────────────────────────────────────────────────────

function PropostasTable({
  propostas, onAprovar, onRejeitar, onEditar, onIgnorar, onAprovarLote, loadingId, loteLoading,
}: {
  propostas: Proposta[]
  onAprovar: (id: number) => void
  onRejeitar: (id: number) => void
  onEditar: (id: number, valor: number) => void
  onIgnorar?: (id: number) => void
  onAprovarLote?: (ids: number[]) => void
  loadingId: number | null
  loteLoading?: boolean
}) {
  const [filterDepto,    setFilterDepto]    = useState('')
  const [filterSecao,    setFilterSecao]    = useState('')
  const [filterEnder,    setFilterEnder]    = useState('')
  const [filterGiroCap,  setFilterGiroCap]  = useState('')
  const [filterGiroPR,   setFilterGiroPR]   = useState('')
  const [filterCapDias,  setFilterCapDias]  = useState('')
  const [page, setPage] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const PAGE_SIZE = 100

  // Pré-computa indicadores + endereço uma única vez por lista
  const rows = useMemo(() =>
    propostas.map(p => ({
      ...p,
      _ind: calcIndicadores(p),
      _end: [p.rua, p.predio, p.apto].filter(v => v != null).join('-'),
    })),
    [propostas],
  )

  const deptos = useMemo(() =>
    [...new Set(rows.map(r => r.departamento).filter(Boolean))] as string[],
    [rows],
  )
  const secoes = useMemo(() =>
    [...new Set(
      rows
        .filter(r => !filterDepto || r.departamento === filterDepto)
        .map(r => r.secao)
        .filter(Boolean),
    )] as string[],
    [rows, filterDepto],
  )

  const filtered = useMemo(() =>
    rows.filter(r => {
      if (filterDepto && r.departamento !== filterDepto) return false
      if (filterSecao && r.secao !== filterSecao) return false
      if (filterEnder && !r._end.startsWith(filterEnder)) return false
      if (filterGiroCap && r._ind.giroCap !== filterGiroCap) return false
      if (filterGiroPR  && r._ind.giroPR  !== filterGiroPR)  return false
      if (filterCapDias && r._ind.capDias2 !== filterCapDias) return false
      return true
    }),
    [rows, filterDepto, filterSecao, filterEnder, filterGiroCap, filterGiroPR, filterCapDias],
  )

  const hasFilters = filterDepto || filterSecao || filterEnder || filterGiroCap || filterGiroPR || filterCapDias

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(() =>
    filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // M5 fix: reset usa hash estável (length + primeiro id) em vez da referência
  // do array, evitando volta à página 1 em refetches cuja data é idêntica.
  const propostasKey = `${propostas.length}:${propostas[0]?.id ?? ''}`
  useEffect(() => { setPage(1) }, [filterDepto, filterSecao, filterEnder, filterGiroCap, filterGiroPR, filterCapDias, propostasKey])

  return (
    <div className="space-y-2">
      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filterDepto || 'all'} onValueChange={v => { setFilterDepto(v === 'all' ? '' : v); setFilterSecao('') }}>
          <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="Departamento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os depto.</SelectItem>
            {deptos.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSecao || 'all'} onValueChange={v => setFilterSecao(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="Seção" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as seções</SelectItem>
            {secoes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="Endereço (ex: 12-3-5)"
          value={filterEnder}
          onChange={e => setFilterEnder(e.target.value)}
          className="h-7 text-xs w-36"
        />
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap cursor-help underline decoration-dotted">GiroCap.</label>
              </TooltipTrigger>
              <TooltipContent className="max-w-56 text-xs">
                <p className="font-semibold">Giro e Capacidade</p>
                <p>Analisa se o Giro/Dia é ≥ à capacidade atual do endereço. Indica risco de ruptura de estoque.</p>
              </TooltipContent>
            </Tooltip>
            <Select value={filterGiroCap || 'all'} onValueChange={v => setFilterGiroCap(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="OK">OK</SelectItem>
                <SelectItem value="Urgencia">Urgencia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap cursor-help underline decoration-dotted">GPRepos.</label>
              </TooltipTrigger>
              <TooltipContent className="max-w-56 text-xs">
                <p className="font-semibold">Giro e Ponto de Reposição</p>
                <p>Analisa se o Giro/Dia é ≥ ao ponto de reposição. Indica que o produto é reposto antes de zerar o estoque.</p>
              </TooltipContent>
            </Tooltip>
            <Select value={filterGiroPR || 'all'} onValueChange={v => setFilterGiroPR(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="OK">OK</SelectItem>
                <SelectItem value="Ajustar">Ajustar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap cursor-help underline decoration-dotted">CMEN2DDV</label>
              </TooltipTrigger>
              <TooltipContent className="max-w-56 text-xs">
                <p className="font-semibold">Capacidade Menor que 2 DDVs</p>
                <p>Analisa se a capacidade atual do endereço suporta pelo menos 2 dias de venda. Abaixo disso o risco de ruptura é alto.</p>
              </TooltipContent>
            </Tooltip>
            <Select value={filterCapDias || 'all'} onValueChange={v => setFilterCapDias(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="OK">OK</SelectItem>
                <SelectItem value="CAP Menor">CAP Menor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TooltipProvider>
        {hasFilters && (
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
            onClick={() => { setFilterDepto(''); setFilterSecao(''); setFilterEnder(''); setFilterGiroCap(''); setFilterGiroPR(''); setFilterCapDias('') }}
          >
            limpar filtros
          </button>
        )}
        {onAprovarLote && (() => {
          const pendingIds = filtered.filter(r => r.status === 'pendente').map(r => r.id)
          return (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] text-green-700 border-green-200 hover:bg-green-50"
              disabled={pendingIds.length === 0 || loteLoading}
              onClick={() => onAprovarLote(pendingIds)}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              {hasFilters
                ? `Aprovar filtrados (${pendingIds.length})`
                : `Aprovar todos (${pendingIds.length})`}
            </Button>
          )
        })()}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] ml-auto"
          disabled={filtered.length === 0 || isExporting}
          onClick={async () => {
            // M4 fix: feedback durante export. M3 fix: lazy-load xlsx (~900KB)
            // apenas quando o usuário realmente clica, não no bundle inicial.
            setIsExporting(true)
            try {
              const XLSX = await import('xlsx')
              // L3 fix: data local (pt-BR em formato ISO) no nome do arquivo
              const today = new Date().toLocaleDateString('sv-SE')
              const data = filtered.map(r => ({
                'Departamento': r.departamento ?? '',
                'Seção': r.secao ?? '',
                'Curva': r.classe_venda ?? '',
                'Produto': r.produto ?? '',
                'Código': r.codprod,
                'Endereço': r._end,
                'Capacidade': r.capacidade_atual ?? '',
                'Giro/dia (cx)': r.giro_dia_cx != null ? r.giro_dia_cx : '',
                'Méd.Venda (cx)': r.med_venda_cx != null ? r.med_venda_cx : '',
                'Pt.Reposição': r.ponto_reposicao ?? '',
                'Sugestão': r.sugestao_editada ?? r.sugestao_calibragem,
                'Delta': r.delta,
                'Status': r.status,
                'GiroCap.': r._ind.giroCap ?? '',
                'GPRepos.': r._ind.giroPR ?? '',
                'CMEN2DDV': r._ind.capDias2 ?? '',
              }))
              const ws = XLSX.utils.json_to_sheet(data)
              const wb = XLSX.utils.book_new()
              XLSX.utils.book_append_sheet(wb, ws, 'Propostas')
              XLSX.writeFile(wb, `calibragem_${today}.xlsx`)
              toast.success(`${filtered.length} linhas exportadas`)
            } catch (err) {
              toast.error('Falha ao exportar: ' + (err as Error).message)
            } finally {
              setIsExporting(false)
            }
          }}
        >
          {isExporting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1" />
          )}
          {isExporting ? 'Exportando…' : 'Exportar Excel'}
        </Button>
      </div>

      {/* ── Tabela ── */}
      {filtered.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Nenhuma proposta encontrada{hasFilters ? ' para os filtros selecionados' : ''}.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="text-[11px]">
              <TableHead className="w-[72px] py-1.5">Depto/Seção</TableHead>
              <TableHead className="w-7 py-1.5">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-help underline decoration-dotted">Curva</TooltipTrigger>
                    <TooltipContent className="text-xs">
                      CURVA ABC de Acesso ao PICKING
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="py-1.5 max-w-[120px]">Produto</TableHead>
              <TableHead className="py-1.5">Cód.</TableHead>
              <TableHead className="py-1.5">Ender.</TableHead>
              <TableHead className="text-right py-1.5">Cap.</TableHead>
              <TableHead className="text-right py-1.5">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-help underline decoration-dotted">Giro/dia</TooltipTrigger>
                    <TooltipContent className="max-w-64 text-xs">
                      <p className="font-semibold">Quantidade de Acesso / Dia</p>
                      <p>Número de acessos ao slot de picking por dia no período analisado.</p>
                      <p className="mt-1 text-muted-foreground">Fórmula: QTACESSO_PICKING_PERIODO_90 ÷ QT_DIAS</p>
                      <p className="text-muted-foreground">Fallback: MED_VENDA_DIAS → MED_VENDA_DIAS_CX</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="text-right py-1.5">Méd.Vda</TableHead>
              <TableHead className="text-right py-1.5">Sug.</TableHead>
              <TableHead className="text-right py-1.5">Δ</TableHead>
              <TableHead className="py-1.5">Status</TableHead>
              <TableHead className="w-6 py-1.5 text-center">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-help underline decoration-dotted text-[10px]">GC</TooltipTrigger>
                    <TooltipContent className="max-w-56 text-xs">
                      <p className="font-semibold">GiroCap. — Giro e Capacidade</p>
                      <p>Analisa se o Giro/Dia é ≥ à capacidade atual. Indica risco de ruptura de estoque.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="w-6 py-1.5 text-center">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-help underline decoration-dotted text-[10px]">GP</TooltipTrigger>
                    <TooltipContent className="max-w-56 text-xs">
                      <p className="font-semibold">GPRepos. — Giro e Ponto de Reposição</p>
                      <p>Analisa se o Giro/Dia é ≥ ao ponto de reposição. Indica que o produto é reposto antes de zerar.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="w-6 py-1.5 text-center">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="cursor-help underline decoration-dotted text-[10px]">C2D</TooltipTrigger>
                    <TooltipContent className="max-w-56 text-xs">
                      <p className="font-semibold">CMEN2DDV — Capacidade Menor que 2 DDVs</p>
                      <p>Analisa se a capacidade suporta pelo menos 2 dias de venda. Abaixo disso o risco de ruptura é alto.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="w-36 py-1.5">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map(p => (
              <TableRow key={p.id} className={`text-[11px] ${p.status !== 'pendente' ? 'opacity-60' : ''}`}>
                <TableCell className="py-1 leading-tight">
                  <div className="text-[10px] font-medium truncate max-w-[76px]" title={p.departamento ?? ''}>{p.departamento || '—'}</div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[76px]" title={p.secao ?? ''}>{p.secao || '—'}</div>
                </TableCell>
                <TableCell className="py-1"><ClasseBadge classe={p.classe_venda} /></TableCell>
                <TableCell className="py-1 max-w-[120px] truncate" title={p.produto}>{p.produto || '—'}</TableCell>
                <TableCell className="py-1 font-mono">{p.codprod}</TableCell>
                <TableCell className="py-1"><EnderecoCell rua={p.rua} predio={p.predio} apto={p.apto} /></TableCell>
                <TableCell className="py-1 text-right">{p.capacidade_atual ?? '—'}</TableCell>
                <TableCell className="py-1 text-right text-muted-foreground">
                  {p.giro_dia_cx != null ? p.giro_dia_cx.toFixed(1) : '—'}
                </TableCell>
                <TableCell className="py-1 text-right text-muted-foreground">
                  {p.med_venda_cx != null ? p.med_venda_cx.toFixed(1) : '—'}
                </TableCell>
                <TableCell className="py-1 text-right">
                  <SugestaoCell proposta={p} onSave={onEditar} />
                </TableCell>
                <TableCell className="py-1 text-right"><AcaoBadge delta={p.delta} /></TableCell>
                <TableCell className="py-1"><StatusBadge status={p.status} /></TableCell>
                <TableCell className="py-1 text-center"><IndicadorBadge valor={p._ind.giroCap} /></TableCell>
                <TableCell className="py-1 text-center"><IndicadorBadge valor={p._ind.giroPR} /></TableCell>
                <TableCell className="py-1 text-center"><IndicadorBadge valor={p._ind.capDias2} /></TableCell>
                <TableCell className="py-1">
                  {(p.status === 'pendente' || p.status === 'calibrado') && (
                    <div className="flex gap-1 items-center">
                      {p.status === 'pendente' && (
                        <>
                          <Button
                            size="sm" variant="outline"
                            className="h-6 text-[10px] text-green-700 border-green-200 hover:bg-green-50 px-1.5"
                            disabled={loadingId === p.id}
                            onClick={() => onAprovar(p.id)}
                          >
                            <Check className="h-3 w-3 mr-0.5" />Aprovar
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-6 text-[10px] text-red-600 border-red-200 hover:bg-red-50 px-1.5"
                            disabled={loadingId === p.id}
                            onClick={() => onRejeitar(p.id)}
                          >
                            <ThumbsDown className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      {onIgnorar && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm" variant="outline"
                                className="h-6 text-[10px] text-gray-500 border-gray-200 hover:bg-gray-50 px-1.5"
                                disabled={loadingId === p.id}
                                onClick={() => onIgnorar(p.id)}
                              >
                                <EyeOff className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              Ignorar — não gera proposta na próxima carga
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── Paginação ── */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-[11px] text-muted-foreground">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
            {filtered.length !== propostas.length && ` (filtrados de ${propostas.length})`}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={safePage <= 1} onClick={() => setPage(1)}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {(() => {
              const pages: number[] = []
              const start = Math.max(1, safePage - 2)
              const end = Math.min(totalPages, safePage + 2)
              for (let i = start; i <= end; i++) pages.push(i)
              return pages.map(pg => (
                <Button key={pg} size="sm" variant={pg === safePage ? 'default' : 'outline'}
                  className="h-7 min-w-[28px] px-1.5 text-xs"
                  onClick={() => setPage(pg)}
                >
                  {pg}
                </Button>
              ))
            })()}
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[11px] text-muted-foreground ml-2">Pág. {safePage}/{totalPages}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpDashboard() {
  const { token } = useAuth()
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const headers = { Authorization: `Bearer ${token}` }

  // Aba ativa derivada da URL
  const urlTab = (() => {
    const p = location.pathname
    if (p.endsWith('/reduzir')    || p.endsWith('/espaco'))  return 'espaco'
    if (p.endsWith('/calibrados'))                           return 'calibrado'
    if (p.endsWith('/curva-a'))                              return 'curva_a_mantida'
    return 'falta'
  })()
  const [activeTab, setActiveTab] = useState<string>(urlTab)

  // Sincroniza quando o usuário navega via sidebar
  useEffect(() => { setActiveTab(urlTab) }, [urlTab])

  const [filialID,   setFilialID]   = useState<string>('')
  const [cdID,       setCdID]       = useState<string>('')
  const [jobID,      setJobID]      = useState<string>('')
  const [loadingId,  setLoadingId]  = useState<number | null>(null)
  const [autoSel,    setAutoSel]    = useState(false)

  // ── Dialog de motivo de rejeição ──────────────────────────────────────────
  const [rejeitarId,    setRejeitarId]    = useState<number | null>(null)
  const [motivoSel,     setMotivoSel]     = useState<string>('')

  // ── Dialog de ignorar produto ──────────────────────────────────────────────
  const [ignorarId,    setIgnorarId]    = useState<number | null>(null)
  const [ignorarTipo,  setIgnorarTipo]  = useState<string>('')

  // ── Queries base ──────────────────────────────────────────────────────────
  const { data: motivosRejeicao = [] } = useQuery<{ id: number; codigo: number; descricao: string }[]>({
    queryKey: ['sp-motivos-rejeicao'],
    queryFn: async () => {
      const r = await fetch('/api/sp/propostas/motivos-rejeicao', { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: tiposIgnorado = [] } = useQuery<{ id: number; codigo: number; descricao: string }[]>({
    queryKey: ['sp-tipos-ignorado'],
    queryFn: async () => {
      const r = await fetch('/api/sp/ignorados/tipos', { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: filiais = [] } = useQuery<SpFilial[]>({
    queryKey: ['filiais'],
    queryFn: async () => {
      const r = await fetch('/api/filiais', { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: cds = [] } = useQuery<SpCD[]>({
    queryKey: ['sp-cds-filial', filialID],
    enabled: !!filialID,
    queryFn: async () => {
      const r = await fetch(`/api/sp/filiais/${filialID}/cds`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: jobs = [] } = useQuery<SpCSVJob[]>({
    queryKey: ['sp-csv-jobs', cdID],
    queryFn: async () => {
      const url = cdID ? `/api/sp/csv/jobs?cd_id=${cdID}` : '/api/sp/csv/jobs'
      const r = await fetch(url, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })
  const doneJobs = jobs.filter(j => j.status === 'done')

  // Auto-seleciona filial + CD do job mais recente ao abrir o painel (uma só vez)
  useEffect(() => {
    if (autoSel || filialID || !doneJobs.length) return
    const latest = doneJobs[0]   // já vem ordenado DESC por created_at
    if (latest.filial_id) setFilialID(String(latest.filial_id))
    if (latest.cd_id)     setCdID(String(latest.cd_id))
    setAutoSel(true)
  }, [doneJobs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resumo ────────────────────────────────────────────────────────────────
  const resumoParams = new URLSearchParams()
  if (cdID)  resumoParams.set('cd_id', cdID)
  if (jobID) resumoParams.set('job_id', jobID)

  const { data: resumo } = useQuery<Resumo>({
    queryKey: ['sp-propostas-resumo', cdID, jobID],
    queryFn: async () => {
      const r = await fetch(`/api/sp/propostas/resumo?${resumoParams}`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
    refetchInterval: 10000,
  })

  // ── Propostas ─────────────────────────────────────────────────────────────
  function buildPropostasUrl(tipo: 'falta' | 'espaco' | 'calibrado' | 'curva_a_mantida', status?: string) {
    const p = new URLSearchParams({ tipo, limit: '99999' })
    if (status) p.set('status', status)
    if (cdID)   p.set('cd_id', cdID)
    if (jobID)  p.set('job_id', jobID)
    return `/api/sp/propostas?${p}`
  }

  const { data: propostasFalta = [], refetch: refetchFalta } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'falta', cdID, jobID],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('falta', 'pendente'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: propostasEspaco = [], refetch: refetchEspaco } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'espaco', cdID, jobID],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('espaco', 'pendente'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: propostasCalibrado = [], refetch: refetchCalibrado } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'calibrado', cdID, jobID],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('calibrado'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: propostasCurvaA = [], refetch: refetchCurvaA } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'curva_a_mantida', cdID, jobID],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('curva_a_mantida'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['sp-propostas'] })
    qc.invalidateQueries({ queryKey: ['sp-propostas-resumo'] })
  }

  // ── Aprovar individual ────────────────────────────────────────────────────
  const aprovarMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sp/propostas/${id}/aprovar`, {
        method: 'POST', headers,
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro')
    },
    onMutate: (id) => setLoadingId(id),
    onSuccess: () => { toast.success('Proposta aprovada'); invalidateAll() },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setLoadingId(null),
  })

  // ── Rejeitar individual (requer motivo) ──────────────────────────────────
  const rejeitarMutation = useMutation({
    mutationFn: async ({ id, motivoId }: { id: number; motivoId: number }) => {
      const r = await fetch(`/api/sp/propostas/${id}/rejeitar`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo_rejeicao_id: motivoId }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro')
    },
    onMutate: ({ id }) => setLoadingId(id),
    onSuccess: () => {
      toast.success('Proposta rejeitada')
      invalidateAll()
      setRejeitarId(null)
      setMotivoSel('')
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setLoadingId(null),
  })

  function confirmarRejeicao() {
    if (!rejeitarId || !motivoSel) return
    rejeitarMutation.mutate({ id: rejeitarId, motivoId: Number(motivoSel) })
  }

  // ── Editar inline ─────────────────────────────────────────────────────────
  const editarMutation = useMutation({
    mutationFn: async ({ id, valor }: { id: number; valor: number }) => {
      const r = await fetch(`/api/sp/propostas/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sugestao_editada: valor }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro')
    },
    onSuccess: () => { toast.success('Sugestão editada'); invalidateAll() },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Ignorar produto (adiciona à lista de ignorados) ──────────────────────
  const ignorarMutation = useMutation({
    mutationFn: async ({ id, tipoId }: { id: number; tipoId: number }) => {
      const r = await fetch(`/api/sp/propostas/${id}/ignorar`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo_ignorado_id: tipoId }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro ao ignorar')
    },
    onMutate: ({ id }) => setLoadingId(id),
    onSuccess: () => {
      toast.success('Produto ignorado — não gerará proposta na próxima calibragem')
      setIgnorarId(null)
      setIgnorarTipo('')
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setLoadingId(null),
  })

  function confirmarIgnorar() {
    if (!ignorarId || !ignorarTipo) return
    ignorarMutation.mutate({ id: ignorarId, tipoId: Number(ignorarTipo) })
  }

  // ── Aprovar selecionados (filtrados) ──────────────────────────────────────
  const aprovarSelecionadosMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await fetch('/api/sp/propostas/aprovar-selecionados', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Erro')
      return data
    },
    onSuccess: (data) => {
      toast.success(data.message)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Render ────────────────────────────────────────────────────────────────
  const hasFilters = !!(cdID || jobID)

  return (
    <div className="space-y-4">
      {/* Filtros + alertas de urgência no topo */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium mb-1 block">Filial</label>
          <Select value={filialID} onValueChange={v => { setFilialID(v); setCdID(''); setJobID('') }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todas as filiais" /></SelectTrigger>
            <SelectContent>
              {filiais.map(f => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.nome} (cód. {f.cod_filial})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">CD</label>
          <Select value={cdID} onValueChange={v => { setCdID(v); setJobID('') }} disabled={!filialID}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Todos os CDs" /></SelectTrigger>
            <SelectContent>
              {cds.map(cd => (
                <SelectItem key={cd.id} value={String(cd.id)}>{cd.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {doneJobs.length > 0 && (
          <div>
            <label className="text-xs font-medium mb-1 block">Importação</label>
            <Select value={jobID} onValueChange={setJobID}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Todas as importações" /></SelectTrigger>
              <SelectContent>
                {doneJobs.map(j => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.filename.length > 28 ? j.filename.slice(0, 28) + '…' : j.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Badges clicáveis — navegam e filtram a aba correspondente */}
        {resumo && (
          <>
            <button
              onClick={() => { setActiveTab('falta'); navigate('/dashboard/ampliar') }}
              className={`border rounded-lg px-4 py-2 min-w-[100px] text-center cursor-pointer transition-all ${activeTab === 'falta' ? 'bg-red-100 border-red-400 ring-2 ring-red-300' : 'bg-red-50 hover:bg-red-100'}`}
            >
              <span className="text-sm font-semibold text-red-600 block leading-tight">Ampliar Slot</span>
              <span className="font-bold text-red-700 text-2xl leading-tight">{resumo.falta_pendente}</span>
            </button>
            <button
              onClick={() => { setActiveTab('espaco'); navigate('/dashboard/reduzir') }}
              className={`border rounded-lg px-4 py-2 min-w-[100px] text-center cursor-pointer transition-all ${activeTab === 'espaco' ? 'bg-yellow-100 border-yellow-400 ring-2 ring-yellow-300' : 'bg-yellow-50 hover:bg-yellow-100'}`}
            >
              <span className="text-sm font-semibold text-yellow-700 block leading-tight">Reduzir Slot</span>
              <span className="font-bold text-yellow-700 text-2xl leading-tight">{resumo.espaco_pendente}</span>
            </button>
            {resumo.calibrado_total > 0 && (
              <button
                onClick={() => { setActiveTab('calibrado'); navigate('/dashboard/calibrados') }}
                className={`border rounded-lg px-4 py-2 min-w-[100px] text-center cursor-pointer transition-all ${activeTab === 'calibrado' ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300' : 'bg-blue-50 hover:bg-blue-100'}`}
              >
                <span className="text-sm font-semibold text-blue-600 block leading-tight">Já Calibrados</span>
                <span className="font-bold text-blue-700 text-2xl leading-tight">{resumo.calibrado_total}</span>
              </button>
            )}
            {resumo.curva_a_mantida > 0 && (
              <button
                onClick={() => { setActiveTab('curva_a_mantida'); navigate('/dashboard/curva-a') }}
                className={`border rounded-lg px-4 py-2 min-w-[100px] text-center cursor-pointer transition-all ${activeTab === 'curva_a_mantida' ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300' : 'bg-amber-50 hover:bg-amber-100'}`}
              >
                <span className="text-sm font-semibold text-amber-700 block leading-tight">Curva A — Revisar</span>
                <span className="font-bold text-amber-700 text-2xl leading-tight">{resumo.curva_a_mantida}</span>
              </button>
            )}
            <button
              onClick={() => navigate('/dashboard/ignorados')}
              className="border rounded-lg px-4 py-2 min-w-[100px] text-center cursor-pointer transition-all bg-gray-50 hover:bg-gray-100"
            >
              <span className="text-sm font-semibold text-gray-500 block leading-tight">Prod. Ignorados</span>
              <span className="font-bold text-gray-600 text-2xl leading-tight">{resumo.ignorado_total}</span>
            </button>
          </>
        )}

        <Button size="sm" variant="outline" onClick={() => { refetchFalta(); refetchEspaco(); refetchCalibrado(); refetchCurvaA() }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
        </Button>
      </div>

      {/* Barra de lote */}
      {resumo && (
        <BatchStatusBar resumo={resumo} />
      )}

      {!hasFilters && (
        <p className="text-xs text-muted-foreground">
          Selecione uma filial e/ou CD para visualizar as propostas de calibragem.
        </p>
      )}

      {hasFilters && (
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v)}>
          {/* ── Aba: Ampliar Slot ───────────────────────────────────────── */}
          <TabsContent value="falta" className="space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
              Slot <strong>subestimado</strong> — sugestão maior que a capacidade atual. Separador perde viagem: adicionar CX no endereço.
            </p>
            <PropostasTable
              propostas={propostasFalta}
              onAprovar={id => aprovarMutation.mutate(id)}
              onRejeitar={id => { setRejeitarId(id); setMotivoSel('') }}
              onEditar={(id, valor) => editarMutation.mutate({ id, valor })}
              onIgnorar={id => { setIgnorarId(id); setIgnorarTipo('') }}
              onAprovarLote={ids => aprovarSelecionadosMutation.mutate(ids)}
              loteLoading={aprovarSelecionadosMutation.isPending}
              loadingId={loadingId}
            />
          </TabsContent>

          {/* ── Aba: Reduzir Slot ───────────────────────────────────────── */}
          <TabsContent value="espaco" className="space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 shrink-0" />
              Slot <strong>superestimado</strong> — sugestão menor que a capacidade atual. Espaço desperdiçado: remover CX do endereço.
            </p>
            <PropostasTable
              propostas={propostasEspaco}
              onAprovar={id => aprovarMutation.mutate(id)}
              onRejeitar={id => { setRejeitarId(id); setMotivoSel('') }}
              onEditar={(id, valor) => editarMutation.mutate({ id, valor })}
              onIgnorar={id => { setIgnorarId(id); setIgnorarTipo('') }}
              onAprovarLote={ids => aprovarSelecionadosMutation.mutate(ids)}
              loteLoading={aprovarSelecionadosMutation.isPending}
              loadingId={loadingId}
            />
          </TabsContent>

          {/* ── Aba: Já Calibrados (delta = 0) ──────────────────────────── */}
          <TabsContent value="calibrado" className="space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
              Estes produtos já estão com a capacidade ideal — sugestão igual à capacidade atual (delta = 0). Nenhuma ação necessária.
            </p>
            {propostasCalibrado.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">
                Nenhum produto calibrado encontrado.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">Curva</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Cód.</TableHead>
                    <TableHead>Endereço</TableHead>
                    <TableHead className="text-right">Cap.Atual</TableHead>
                    <TableHead className="text-right">Sugestão</TableHead>
                    <TableHead>Justificativa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {propostasCalibrado.map(p => (
                    <TableRow key={p.id} className="opacity-75">
                      <TableCell><ClasseBadge classe={p.classe_venda} /></TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate" title={p.produto}>
                        {p.produto || '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{p.codprod}</TableCell>
                      <TableCell><EnderecoCell rua={p.rua} predio={p.predio} apto={p.apto} /></TableCell>
                      <TableCell className="text-xs text-right">{p.capacidade_atual ?? '—'}</TableCell>
                      <TableCell className="text-xs text-right text-blue-700 font-semibold">{p.sugestao_calibragem}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[240px] truncate" title={p.justificativa ?? ''}>
                        {p.justificativa ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
          {/* ── Aba: Curva A — Revisar ──────────────────────────────────── */}
          <TabsContent value="curva_a_mantida" className="space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              Produtos <strong>Curva A</strong> onde a fórmula sugeria redução, mas a regra <em>"Curva A nunca reduz"</em> manteve a capacidade atual.
              Revisar com o gestor se a redução deve ser aplicada.
            </p>
            {propostasCurvaA.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-12">
                Nenhum produto Curva A retido pela regra.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">Curva</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Cód.</TableHead>
                    <TableHead>Endereço</TableHead>
                    <TableHead className="text-right">Cap.Atual (cx)</TableHead>
                    <TableHead className="text-right">Fórmula (cx)</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Justificativa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {propostasCurvaA.map(p => {
                    // Extrai o resultado da fórmula da justificativa: "= X cx →"
                    const match = p.justificativa?.match(/= (\d+) cx →/)
                    const formulaCx = match ? parseInt(match[1]) : p.sugestao_calibragem
                    const capAtual = p.capacidade_atual ?? 0
                    const diff = formulaCx - capAtual
                    return (
                      <TableRow key={p.id} className="bg-amber-50/40">
                        <TableCell><ClasseBadge classe={p.classe_venda} /></TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate" title={p.produto}>
                          {p.produto || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{p.codprod}</TableCell>
                        <TableCell><EnderecoCell rua={p.rua} predio={p.predio} apto={p.apto} /></TableCell>
                        <TableCell className="text-xs text-right font-medium">{capAtual} cx</TableCell>
                        <TableCell className="text-xs text-right text-amber-700 font-semibold">{formulaCx} cx</TableCell>
                        <TableCell className="text-xs text-right text-amber-700 font-semibold">{diff} cx</TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-[240px] truncate" title={p.justificativa ?? ''}>
                          {p.justificativa ?? '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* ── Dialog: motivo de rejeição ──────────────────────────────────── */}
      <Dialog open={!!rejeitarId} onOpenChange={open => { if (!open) { setRejeitarId(null); setMotivoSel('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Motivo da rejeição</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Selecione o motivo para rejeitar esta sugestão de calibragem.
          </p>
          <Select value={motivoSel} onValueChange={setMotivoSel}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Selecione um motivo..." />
            </SelectTrigger>
            <SelectContent>
              {motivosRejeicao.map(m => (
                <SelectItem key={m.id} value={String(m.id)} className="text-xs">
                  {m.codigo} – {m.descricao}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setRejeitarId(null); setMotivoSel('') }}>
              Cancelar
            </Button>
            <Button
              variant="destructive" size="sm"
              disabled={!motivoSel || rejeitarMutation.isPending}
              onClick={confirmarRejeicao}
            >
              {rejeitarMutation.isPending ? 'Rejeitando...' : 'Confirmar rejeição'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Ignorar produto ───────────────────────────────────────── */}
      <Dialog open={!!ignorarId} onOpenChange={open => { if (!open) { setIgnorarId(null); setIgnorarTipo('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ignorar produto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              Este produto não gerará proposta de ajuste nem de redução nas próximas calibragens.
              Você pode reativá-lo a qualquer momento em <strong>Produtos Ignorados</strong>.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tipo de ignorado</label>
              <Select value={ignorarTipo} onValueChange={setIgnorarTipo}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {tiposIgnorado.map(t => (
                    <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                      {t.descricao}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIgnorarId(null); setIgnorarTipo('') }}>Cancelar</Button>
            <Button
              variant="secondary"
              disabled={ignorarMutation.isPending || !ignorarTipo}
              onClick={confirmarIgnorar}
            >
              <EyeOff className="h-3.5 w-3.5 mr-1.5" />
              {ignorarMutation.isPending ? 'Ignorando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
