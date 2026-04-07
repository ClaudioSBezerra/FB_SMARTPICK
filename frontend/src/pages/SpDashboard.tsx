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
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { CheckCheck, ThumbsDown, RefreshCw, Pencil, Check, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD     { id: number; filial_id: number; nome: string }
interface SpCSVJob { id: string; filename: string; status: string; created_at: string }

interface Proposta {
  id: number
  job_id: string
  endereco_id: number
  cd_id: number
  cod_filial: number
  codprod: number
  produto: string
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
}

interface Resumo {
  total_pendente: number
  total_aprovada: number
  total_rejeitada: number
  falta_pendente: number
  espaco_pendente: number
  calibrado_total: number
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
    pendente:  'bg-yellow-100 text-yellow-800',
    aprovada:  'bg-green-100 text-green-800',
    rejeitada: 'bg-red-100 text-red-800',
  }
  const label: Record<string, string> = {
    pendente: 'Pendente', aprovada: 'Aprovada', rejeitada: 'Rejeitada',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100'}`}>
      {label[status] ?? status}
    </span>
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
  propostas, onAprovar, onRejeitar, onEditar, loadingId,
}: {
  propostas: Proposta[]
  onAprovar: (id: number) => void
  onRejeitar: (id: number) => void
  onEditar: (id: number, valor: number) => void
  loadingId: number | null
}) {
  if (propostas.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-12">
        Nenhuma proposta encontrada.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">Curva</TableHead>
          <TableHead>Produto</TableHead>
          <TableHead>Cód.</TableHead>
          <TableHead>Endereço</TableHead>
          <TableHead className="text-right">Cap.Atual</TableHead>
          <TableHead className="text-right">Sugestão</TableHead>
          <TableHead className="text-right">Ação</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-32">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {propostas.map(p => (
          <TableRow key={p.id} className={p.status !== 'pendente' ? 'opacity-60' : ''}>
            <TableCell><ClasseBadge classe={p.classe_venda} /></TableCell>
            <TableCell className="text-xs max-w-[180px] truncate" title={p.produto}>
              {p.produto || '—'}
            </TableCell>
            <TableCell className="text-xs font-mono">{p.codprod}</TableCell>
            <TableCell><EnderecoCell rua={p.rua} predio={p.predio} apto={p.apto} /></TableCell>
            <TableCell className="text-xs text-right">{p.capacidade_atual ?? '—'}</TableCell>
            <TableCell className="text-right">
              <SugestaoCell proposta={p} onSave={onEditar} />
            </TableCell>
            <TableCell className="text-right"><AcaoBadge delta={p.delta} /></TableCell>
            <TableCell><StatusBadge status={p.status} /></TableCell>
            <TableCell>
              {p.status === 'pendente' && (
                <div className="flex gap-1">
                  <Button
                    size="sm" variant="outline"
                    className="h-6 text-[11px] text-green-700 border-green-200 hover:bg-green-50 px-2"
                    disabled={loadingId === p.id}
                    onClick={() => onAprovar(p.id)}
                  >
                    <Check className="h-3 w-3 mr-0.5" />Aprovar
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-6 text-[11px] text-red-600 border-red-200 hover:bg-red-50 px-2"
                    disabled={loadingId === p.id}
                    onClick={() => onRejeitar(p.id)}
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpDashboard() {
  const { token } = useAuth()
  const qc = useQueryClient()
  const headers = { Authorization: `Bearer ${token}` }

  const [filialID, setFilialID] = useState<string>('')
  const [cdID,     setCdID]     = useState<string>('')
  const [jobID,    setJobID]    = useState<string>('')
  const [loadingId, setLoadingId] = useState<number | null>(null)

  // ── Queries base ──────────────────────────────────────────────────────────
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
  function buildPropostasUrl(tipo: 'falta' | 'espaco' | 'calibrado', status?: string) {
    const p = new URLSearchParams({ tipo, limit: '500' })
    if (status) p.set('status', status)
    if (cdID)   p.set('cd_id', cdID)
    if (jobID)  p.set('job_id', jobID)
    return `/api/sp/propostas?${p}`
  }

  const { data: propostasFalta = [], refetch: refetchFalta } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'falta', cdID, jobID],
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('falta', 'pendente'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: propostasEspaco = [], refetch: refetchEspaco } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'espaco', cdID, jobID],
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('espaco', 'pendente'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: propostasCalibrado = [], refetch: refetchCalibrado } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'calibrado', cdID, jobID],
    queryFn: async () => {
      const r = await fetch(buildPropostasUrl('calibrado'), { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const { data: propostasCurvaA = [], refetch: refetchCurvaA } = useQuery<Proposta[]>({
    queryKey: ['sp-propostas', 'curva_a_mantida', cdID, jobID],
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

  // ── Rejeitar individual ───────────────────────────────────────────────────
  const rejeitarMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sp/propostas/${id}/rejeitar`, {
        method: 'POST', headers,
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro')
    },
    onMutate: (id) => setLoadingId(id),
    onSuccess: () => { toast.success('Proposta rejeitada'); invalidateAll() },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setLoadingId(null),
  })

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

  // ── Aprovar em lote ───────────────────────────────────────────────────────
  const aprovarLoteMutation = useMutation({
    mutationFn: async (tipo: 'falta' | 'espaco') => {
      const body: Record<string, unknown> = { tipo }
      if (jobID) body.job_id = jobID
      else if (cdID) body.cd_id = Number(cdID)
      const r = await fetch('/api/sp/propostas/aprovar-lote', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      {/* Filtros */}
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

        <Button size="sm" variant="outline" onClick={() => { refetchFalta(); refetchEspaco(); refetchCalibrado(); refetchCurvaA() }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
        </Button>
      </div>

      {/* Contadores */}
      {resumo && (
        <div className="flex gap-4 flex-wrap text-sm">
          <div className="border rounded px-3 py-2 bg-yellow-50">
            <span className="text-xs text-muted-foreground block">Pendentes</span>
            <span className="font-bold text-yellow-800">{resumo.total_pendente}</span>
          </div>
          <div className="border rounded px-3 py-2 bg-red-50">
            <span className="text-xs text-muted-foreground block">Ampliar Slot</span>
            <span className="font-bold text-red-700">{resumo.falta_pendente}</span>
          </div>
          <div className="border rounded px-3 py-2 bg-yellow-50">
            <span className="text-xs text-muted-foreground block">Reduzir Slot</span>
            <span className="font-bold text-yellow-700">{resumo.espaco_pendente}</span>
          </div>
          <div className="border rounded px-3 py-2 bg-green-50">
            <span className="text-xs text-muted-foreground block">Aprovadas</span>
            <span className="font-bold text-green-700">{resumo.total_aprovada}</span>
          </div>
          <div className="border rounded px-3 py-2 bg-gray-50">
            <span className="text-xs text-muted-foreground block">Rejeitadas</span>
            <span className="font-bold text-gray-600">{resumo.total_rejeitada}</span>
          </div>
          {resumo.calibrado_total > 0 && (
            <div className="border rounded px-3 py-2 bg-blue-50">
              <span className="text-xs text-muted-foreground block">Já Calibrados</span>
              <span className="font-bold text-blue-700">{resumo.calibrado_total}</span>
            </div>
          )}
          {resumo.curva_a_mantida > 0 && (
            <div className="border rounded px-3 py-2 bg-amber-50">
              <span className="text-xs text-muted-foreground block">Curva A — Revisar</span>
              <span className="font-bold text-amber-700">{resumo.curva_a_mantida}</span>
            </div>
          )}
        </div>
      )}

      {!hasFilters && (
        <p className="text-xs text-muted-foreground">
          Selecione uma filial e/ou CD para visualizar as propostas de calibragem.
        </p>
      )}

      {hasFilters && (
        <Tabs defaultValue="falta">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="falta">
                Ampliar Slot
                {resumo && resumo.falta_pendente > 0 && (
                  <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                    {resumo.falta_pendente}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="espaco">
                Reduzir Slot
                {resumo && resumo.espaco_pendente > 0 && (
                  <span className="ml-1.5 bg-yellow-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                    {resumo.espaco_pendente}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="calibrado">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-blue-500" />
                Já Calibrados
                {resumo && resumo.calibrado_total > 0 && (
                  <span className="ml-1.5 bg-blue-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                    {resumo.calibrado_total}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="curva_a_mantida">
                <AlertTriangle className="h-3.5 w-3.5 mr-1 text-amber-500" />
                Curva A — Revisar
                {resumo && resumo.curva_a_mantida > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                    {resumo.curva_a_mantida}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Aba: Ampliar Slot ───────────────────────────────────────── */}
          <TabsContent value="falta" className="space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
              Slot <strong>subestimado</strong> — sugestão maior que a capacidade atual. Separador perde viagem: adicionar CX no endereço.
            </p>
            <div className="flex justify-end">
              <Button
                size="sm" variant="outline"
                className="text-green-700 border-green-200 hover:bg-green-50"
                disabled={aprovarLoteMutation.isPending || propostasFalta.length === 0}
                onClick={() => aprovarLoteMutation.mutate('falta')}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                Aprovar todas ({propostasFalta.length})
              </Button>
            </div>
            <PropostasTable
              propostas={propostasFalta}
              onAprovar={id => aprovarMutation.mutate(id)}
              onRejeitar={id => rejeitarMutation.mutate(id)}
              onEditar={(id, valor) => editarMutation.mutate({ id, valor })}
              loadingId={loadingId}
            />
          </TabsContent>

          {/* ── Aba: Reduzir Slot ───────────────────────────────────────── */}
          <TabsContent value="espaco" className="space-y-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 shrink-0" />
              Slot <strong>superestimado</strong> — sugestão menor que a capacidade atual. Espaço desperdiçado: remover CX do endereço.
            </p>
            <div className="flex justify-end">
              <Button
                size="sm" variant="outline"
                className="text-green-700 border-green-200 hover:bg-green-50"
                disabled={aprovarLoteMutation.isPending || propostasEspaco.length === 0}
                onClick={() => aprovarLoteMutation.mutate('espaco')}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                Aprovar todas ({propostasEspaco.length})
              </Button>
            </div>
            <PropostasTable
              propostas={propostasEspaco}
              onAprovar={id => aprovarMutation.mutate(id)}
              onRejeitar={id => rejeitarMutation.mutate(id)}
              onEditar={(id, valor) => editarMutation.mutate({ id, valor })}
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
    </div>
  )
}
