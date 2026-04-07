import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }

interface Historico {
  id: number
  job_id: string | null
  cd_id: number
  cd_nome: string
  filial_nome: string
  total_propostas: number
  aprovadas: number
  rejeitadas: number
  pendentes: number
  curva_a: number
  curva_b: number
  curva_c: number
  executado_em: string
  concluido_em: string | null
  status: string
  observacao: string | null
}

interface ComplianceCD {
  cd_id: number
  cd_nome: string
  filial_nome: string
  ultima_calibragem: string | null
  dias_desde_ultima: number | null
  ultimo_status: string | null
  total_ciclos: number
  alerta: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR')
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; Icon: React.ElementType }> = {
    em_andamento: { cls: 'bg-blue-100 text-blue-800',   label: 'Em andamento', Icon: Clock },
    concluido:    { cls: 'bg-green-100 text-green-800', label: 'Concluído',    Icon: CheckCircle2 },
    nao_executado:{ cls: 'bg-gray-100 text-gray-600',   label: 'Não executado',Icon: XCircle },
  }
  const { cls, label, Icon } = map[status] ?? map.nao_executado
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  )
}

function TaxaBarra({ aprovadas, rejeitadas, pendentes }: {
  aprovadas: number; rejeitadas: number; pendentes: number
}) {
  const total = aprovadas + rejeitadas + pendentes
  if (total === 0) return <span className="text-xs text-muted-foreground">—</span>
  const pct = (n: number) => Math.round((n / total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-24 rounded overflow-hidden bg-gray-100">
        <div className="bg-green-500"  style={{ width: `${pct(aprovadas)}%` }} />
        <div className="bg-red-400"    style={{ width: `${pct(rejeitadas)}%` }} />
        <div className="bg-yellow-300" style={{ width: `${pct(pendentes)}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground">{pct(aprovadas)}%</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpHistorico() {
  const { token } = useAuth()
  const qc = useQueryClient()
  const headers = { Authorization: `Bearer ${token}` }

  const [filialID, setFilialID] = useState<string>('')

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: filiais = [] } = useQuery<SpFilial[]>({
    queryKey: ['filiais'],
    queryFn: async () => {
      const r = await fetch('/api/filiais', { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const histParams = new URLSearchParams()
  if (filialID) histParams.set('filial_id', filialID)

  const {
    data: historico = [],
    refetch: refetchHistorico,
  } = useQuery<Historico[]>({
    queryKey: ['sp-historico', filialID],
    queryFn: async () => {
      const r = await fetch(`/api/sp/historico?${histParams}&limit=100`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const compParams = new URLSearchParams()
  if (filialID) compParams.set('filial_id', filialID)

  const {
    data: compliance = [],
    refetch: refetchCompliance,
  } = useQuery<ComplianceCD[]>({
    queryKey: ['sp-compliance', filialID],
    queryFn: async () => {
      const r = await fetch(`/api/sp/historico/compliance?${compParams}`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  // ── Fechar ciclo ───────────────────────────────────────────────────────────
  const fecharMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sp/historico/${id}/fechar`, {
        method: 'POST', headers,
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro')
    },
    onSuccess: () => {
      toast.success('Ciclo fechado com sucesso')
      qc.invalidateQueries({ queryKey: ['sp-historico'] })
      qc.invalidateQueries({ queryKey: ['sp-compliance'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const alertas = compliance.filter(c => c.alerta).length

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Filtro filial */}
      <div className="flex items-end gap-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Filial</label>
          <Select value={filialID} onValueChange={setFilialID}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Todas as filiais" />
            </SelectTrigger>
            <SelectContent>
              {filiais.map(f => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.nome} (cód. {f.cod_filial})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={() => { refetchHistorico(); refetchCompliance() }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
        </Button>
      </div>

      <Tabs defaultValue="historico">
        <TabsList>
          <TabsTrigger value="historico">Histórico de Calibragem</TabsTrigger>
          <TabsTrigger value="compliance">
            Compliance
            {alertas > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                {alertas}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Aba: Histórico ────────────────────────────────────────────── */}
        <TabsContent value="historico" className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CD / Filial</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Taxa aprovação</TableHead>
                <TableHead>Curvas A·B·C</TableHead>
                <TableHead>Executado em</TableHead>
                <TableHead>Concluído em</TableHead>
                <TableHead className="w-24">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historico.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    Nenhum ciclo de calibragem registrado.
                  </TableCell>
                </TableRow>
              )}
              {historico.map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">
                    <span className="font-medium">{h.cd_nome}</span>
                    <span className="text-muted-foreground ml-1">· {h.filial_nome}</span>
                  </TableCell>
                  <TableCell><StatusBadge status={h.status} /></TableCell>
                  <TableCell className="text-xs text-right">{h.total_propostas}</TableCell>
                  <TableCell>
                    <TaxaBarra
                      aprovadas={h.aprovadas}
                      rejeitadas={h.rejeitadas}
                      pendentes={h.pendentes}
                    />
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {h.curva_a}·{h.curva_b}·{h.curva_c}
                  </TableCell>
                  <TableCell className="text-xs">{fmtDate(h.executado_em)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(h.concluido_em)}</TableCell>
                  <TableCell>
                    {h.status === 'em_andamento' && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        disabled={fecharMutation.isPending}
                        onClick={() => fecharMutation.mutate(h.id)}
                      >
                        Fechar ciclo
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ── Aba: Compliance ───────────────────────────────────────────── */}
        <TabsContent value="compliance" className="space-y-3">
          {alertas > 0 && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span><strong>{alertas} CD(s)</strong> sem calibragem há mais de 30 dias ou nunca calibrado.</span>
            </div>
          )}

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {compliance.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3 py-6 text-center">
                Nenhum CD ativo encontrado.
              </p>
            )}
            {compliance.map(c => (
              <div
                key={c.cd_id}
                className={`border rounded-lg p-3 space-y-1.5 ${c.alerta ? 'border-red-200 bg-red-50' : 'bg-white'}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold">{c.cd_nome}</p>
                    <p className="text-xs text-muted-foreground">{c.filial_nome}</p>
                  </div>
                  {c.alerta
                    ? <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    : <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  }
                </div>

                <div className="text-xs space-y-0.5">
                  <p>
                    <span className="text-muted-foreground">Última calibragem: </span>
                    {c.ultima_calibragem
                      ? new Date(c.ultima_calibragem).toLocaleDateString('pt-BR')
                      : <span className="text-red-600 font-medium">Nunca</span>
                    }
                  </p>
                  {c.dias_desde_ultima != null && (
                    <p>
                      <span className="text-muted-foreground">Há: </span>
                      <span className={c.dias_desde_ultima > 30 ? 'text-red-600 font-semibold' : ''}>
                        {c.dias_desde_ultima} dias
                      </span>
                    </p>
                  )}
                  <p>
                    <span className="text-muted-foreground">Ciclos: </span>
                    {c.total_ciclos}
                  </p>
                  {c.ultimo_status && (
                    <div className="pt-0.5">
                      <StatusBadge status={c.ultimo_status} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
