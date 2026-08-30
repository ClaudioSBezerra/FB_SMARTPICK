import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WifiOff, PackageSearch, CheckCircle2, RefreshCw, Radar, TrendingUp, TrendingDown, FileDown, Send, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD     { id: number; filial_id: number; nome: string }

interface PendenciaItem {
  codprod: number
  produto?: string
  classe_venda: string
  qtd_faturada: number
  ultimo_status: 'nunca' | 'pendente' | 'rejeitada' | 'aprovada' | 'indisponivel'
  gap?: number
  ultima_atualizacao?: string
  acessos_picking?: number
  acessos_inicial?: number
}

interface FaturamentoSemCalibragemResp {
  cd_id: number
  cd_nome: string
  filial_nome: string
  periodo_inicio: string
  periodo_fim: string
  pendencias: PendenciaItem[]
  total_nao_correspondencias: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function ClasseBadge({ classe }: { classe: string }) {
  const colors: Record<string, string> = {
    A: 'bg-red-100 text-red-800',
    B: 'bg-yellow-100 text-yellow-800',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[classe] ?? 'bg-gray-100 text-gray-700'}`}>
      {classe}
    </span>
  )
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  // iso vem como YYYY-MM-DD
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const STATUS_LABEL: Record<PendenciaItem['ultimo_status'], string> = {
  nunca: 'Nunca calibrado',
  pendente: 'Pendente',
  rejeitada: 'Rejeitada',
  aprovada: 'Aprovada (>30d)',
  indisponivel: 'Indisponível',
}

const STATUS_COLORS: Record<PendenciaItem['ultimo_status'], string> = {
  nunca: 'bg-gray-100 text-gray-700',
  pendente: 'bg-amber-100 text-amber-800',
  rejeitada: 'bg-red-100 text-red-800',
  aprovada: 'bg-green-100 text-green-800',
  indisponivel: 'bg-gray-100 text-gray-400 italic',
}

function StatusBadge({ status }: { status: PendenciaItem['ultimo_status'] }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${STATUS_COLORS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function fmtGap(gap?: number) {
  if (gap === undefined || gap === null) return '—'
  const sign = gap > 0 ? '+' : ''
  return `${sign}${gap.toLocaleString('pt-BR')}`
}

// Custo operacional: nº de idas do separador ao endereço nos últimos 90 dias,
// com a evolução desde a 1ª importação do CD — mais acessos sem correção
// (▲, vermelho) evidencia o custo de não ter calibrado ainda; menos (▼,
// verde) mostra melhora mesmo sem calibragem formal registrada.
function AcessosCell({ atual, inicial }: { atual?: number; inicial?: number }) {
  if (atual === undefined || atual === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  if (inicial === undefined || inicial === null || inicial === atual) {
    return <span className="text-xs font-mono">{atual.toLocaleString('pt-BR')}</span>
  }
  const diff = atual - inicial
  const up = diff > 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-mono font-semibold">{atual.toLocaleString('pt-BR')}</span>
      <span className={`inline-flex items-center gap-0.5 ${up ? 'text-red-600' : 'text-green-600'}`} title={`Desde a 1ª importação: ${inicial.toLocaleString('pt-BR')} → ${atual.toLocaleString('pt-BR')}`}>
        <Icon className="h-3 w-3" />
        {up ? '+' : ''}{diff.toLocaleString('pt-BR')}
      </span>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SpFaturamentoSemCalibragem() {
  const { token } = useAuth()
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [filialID, setFilialID] = useState('')
  const [cdID, setCdID] = useState('')

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
      const r = await fetch(`/api/sp/filiais/${filialID}/cds?ativo=true`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const {
    data, isLoading, isError, error, refetch, isFetching,
  } = useQuery<FaturamentoSemCalibragemResp>({
    queryKey: ['sp-faturamento-sem-calibragem', cdID],
    enabled: !!cdID,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/sp/faturamento-sem-calibragem?cd_id=${cdID}`, { headers })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}) as { error?: string })
        throw new ApiError(r.status, body.error ?? 'Erro ao carregar o painel')
      }
      return r.json()
    },
  })

  const farolIndisponivel = isError && error instanceof ApiError && error.status === 502
  const pendencias = data?.pendencias ?? []

  // ── Gerar snapshot (POST .../gerar?cd_id=X) — reaproveitado por "Gerar PDF"
  //    e "Enviar por e-mail", cada botão gera seu próprio snapshot antes de
  //    agir sobre ele (o painel não mantém um histórico selecionável). ──────
  async function gerarSnapshot(): Promise<number> {
    const r = await fetch(`/api/sp/relatorios-faturamento/gerar?cd_id=${cdID}`, { method: 'POST', headers })
    const body = await r.json()
    if (!r.ok) throw new Error(body.error ?? 'Erro ao gerar relatório')
    return (body as { id: number }).id
  }

  // ── Baixar PDF (com a logo da empresa) ────────────────────────────────────
  const [baixandoPDF, setBaixandoPDF] = useState(false)
  async function baixarPDF() {
    setBaixandoPDF(true)
    try {
      const id = await gerarSnapshot()
      const res = await fetch(`/api/sp/relatorios-faturamento/${id}/pdf`, { headers })
      if (!res.ok) throw new Error((await res.text()) || 'Erro ao gerar PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
        ?? `faturamento_sem_calibragem_${id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('PDF gerado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao baixar PDF')
    } finally {
      setBaixandoPDF(false)
    }
  }

  // ── Enviar por e-mail (gera o snapshot e envia aos destinatários ativos) ──
  const enviarMutation = useMutation({
    mutationFn: async () => {
      const id = await gerarSnapshot()
      const r = await fetch(`/api/sp/relatorios-faturamento/${id}/enviar`, { method: 'POST', headers })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? 'Erro ao enviar')
      return body as { enviados: string[]; total: number }
    },
    onSuccess: body => {
      toast.success(`Enviado para ${body.total} destinatário(s)`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2">
        <Radar className="h-5 w-5 text-amber-600" />
        <div>
          <h1 className="text-base font-semibold">Faturamento sem Calibragem</h1>
          <p className="text-xs text-muted-foreground">
            Produtos Curva A/B faturados no CD nos últimos 30 dias (Farol) sem calibragem aprovada correspondente no mesmo período.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium mb-1 block">Filial</label>
          <Select value={filialID} onValueChange={v => { setFilialID(v); setCdID('') }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {filiais.map(f => (
                <SelectItem key={f.id} value={String(f.id)}>{f.nome} (cód. {f.cod_filial})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">CD</label>
          <Select value={cdID} onValueChange={setCdID} disabled={!filialID}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {cds.map(cd => <SelectItem key={cd.id} value={String(cd.id)}>{cd.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {cdID && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 px-3 rounded-md border text-xs text-muted-foreground hover:bg-gray-50 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        )}

        {cdID && (
          <Button
            size="sm"
            variant="outline"
            disabled={baixandoPDF}
            onClick={() => baixarPDF()}
            title="Gerar um snapshot do painel e baixar em PDF (com o logotipo da empresa)"
          >
            {baixandoPDF
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Gerando…</>
              : <><FileDown className="h-3.5 w-3.5 mr-1" />Gerar PDF</>}
          </Button>
        )}

        {cdID && (
          <Button
            size="sm"
            variant="outline"
            disabled={enviarMutation.isPending}
            onClick={() => enviarMutation.mutate()}
            title="Gerar um snapshot do painel e enviar por e-mail aos destinatários ativos do CD"
          >
            {enviarMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Enviando…</>
              : <><Send className="h-3.5 w-3.5 mr-1" />Enviar por e-mail</>}
          </Button>
        )}

        {data && pendencias.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {pendencias.length} produto(s) pendente(s) · período {fmtDate(data.periodo_inicio)} a {fmtDate(data.periodo_fim)} · ordenado por maior gap de calibragem
          </span>
        )}
      </div>

      {!cdID && (
        <p className="text-xs text-muted-foreground">Selecione filial e CD para visualizar as pendências.</p>
      )}

      {cdID && isLoading && (
        <div className="text-center py-8 text-sm text-muted-foreground">Carregando...</div>
      )}

      {/* Farol indisponível — estado de erro claro, sem crash do restante do app */}
      {cdID && farolIndisponivel && (
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-6 text-center">
          <WifiOff className="h-8 w-8 mx-auto text-amber-600 mb-2" />
          <div className="text-amber-800 font-medium text-sm">Integração com Farol indisponível</div>
          <div className="text-xs text-amber-700 mt-1">
            Não foi possível consultar os produtos faturados no Farol agora. Tente novamente em instantes.
          </div>
        </div>
      )}

      {/* Outros erros (banco, permissão, etc.) */}
      {cdID && isError && !farolIndisponivel && (
        <div className="rounded-lg border bg-red-50 border-red-200 p-6 text-center">
          <div className="text-red-700 font-medium text-sm">Erro ao carregar o painel</div>
          <div className="text-xs text-red-600 mt-1">
            {error instanceof Error ? error.message : 'Tente novamente em instantes.'}
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {cdID && data && !isError && pendencias.length === 0 && (
        <div className="rounded-lg border bg-green-50 border-green-200 p-6 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-green-600 mb-2" />
          <div className="text-green-700 font-medium text-sm">Nenhuma pendência</div>
          <div className="text-xs text-green-600 mt-1">
            Todos os produtos Curva A/B faturados neste CD nos últimos 30 dias já têm calibragem aprovada correspondente.
          </div>
        </div>
      )}

      {/* Tabela de pendências */}
      {cdID && data && !isError && pendencias.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2 flex items-center justify-between">
            <div>
              <span className="font-semibold text-sm">{data.filial_nome}</span>
              <span className="text-muted-foreground text-sm"> — {data.cd_nome}</span>
            </div>
            <div className="flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-muted-foreground" />
              <Badge variant="secondary" className="text-xs">
                {pendencias.length} pendente(s)
              </Badge>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-16">Curva</TableHead>
                <TableHead className="w-24">Cód.</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="w-32 text-right">Qtd. faturada</TableHead>
                <TableHead className="w-36">Último status</TableHead>
                <TableHead className="w-20 text-right">Gap</TableHead>
                <TableHead className="w-24">Atualizado</TableHead>
                <TableHead className="w-40">Acessos ao picking (90d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendencias.map(p => (
                <TableRow key={p.codprod}>
                  <TableCell><ClasseBadge classe={p.classe_venda} /></TableCell>
                  <TableCell className="text-xs font-mono">{p.codprod}</TableCell>
                  <TableCell className="text-xs max-w-[320px] truncate" title={p.produto}>{p.produto || '—'}</TableCell>
                  <TableCell className="text-xs text-right">{p.qtd_faturada.toLocaleString('pt-BR')}</TableCell>
                  <TableCell><StatusBadge status={p.ultimo_status} /></TableCell>
                  <TableCell className="text-xs text-right font-mono">{fmtGap(p.gap)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.ultima_atualizacao ? fmtDate(p.ultima_atualizacao) : '—'}</TableCell>
                  <TableCell><AcessosCell atual={p.acessos_picking} inicial={p.acessos_inicial} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
