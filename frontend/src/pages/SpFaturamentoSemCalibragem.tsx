import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { WifiOff, PackageSearch, CheckCircle2, RefreshCw, Radar } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD     { id: number; filial_id: number; nome: string }

interface PendenciaItem {
  codprod: number
  produto?: string
  classe_venda: string
  qtd_faturada: number
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

        {data && pendencias.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {pendencias.length} produto(s) pendente(s) · período {fmtDate(data.periodo_inicio)} a {fmtDate(data.periodo_fim)}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendencias.map(p => (
                <TableRow key={p.codprod}>
                  <TableCell><ClasseBadge classe={p.classe_venda} /></TableCell>
                  <TableCell className="text-xs font-mono">{p.codprod}</TableCell>
                  <TableCell className="text-xs max-w-[320px] truncate" title={p.produto}>{p.produto || '—'}</TableCell>
                  <TableCell className="text-xs text-right">{p.qtd_faturada.toLocaleString('pt-BR')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
