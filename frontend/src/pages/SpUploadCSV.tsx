import { useRef, useState, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { Upload, RefreshCw, Zap, Trash2, Loader2, CheckCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { BatchStatusMini } from '@/components/BatchStatusBar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD { id: number; filial_id: number; nome: string }
interface SpCSVJob {
  id: string
  filename: string
  status: string
  total_linhas: number | null
  linhas_ok: number | null
  linhas_erro: number | null
  erro_msg?: string
  started_at?: string
  finished_at?: string
  created_at: string
  cd_id: number
  filial_id: number
  ciclo_status?: string  // '' = não ativado | 'em_andamento' | 'concluido'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  done:       'bg-green-100 text-green-800',
  failed:     'bg-red-100 text-red-800',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Na fila', processing: 'Processando', done: 'Concluído', failed: 'Falhou',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-gray-100'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpUploadCSV() {
  const { token } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const fileRef = useRef<HTMLInputElement>(null)

  const isLog = location.pathname === '/upload/log'

  const [filialID,   setFilialID]   = useState<string>('')
  const [cdID,       setCdID]       = useState<string>('')
  const [uploading,  setUploading]  = useState(false)
  const [motorJobID, setMotorJobID] = useState<string>('')

  const headers = { Authorization: `Bearer ${token}` }

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: filiais = [], isError: filiaisError } = useQuery<SpFilial[]>({
    queryKey: ['filiais'],
    queryFn: async () => {
      const r = await fetch('/api/filiais', { headers })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
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

  const { data: jobs = [], refetch: refetchJobs } = useQuery<SpCSVJob[]>({
    queryKey: ['sp-csv-jobs', cdID],
    queryFn: async () => {
      const url = cdID ? `/api/sp/csv/jobs?cd_id=${cdID}` : '/api/sp/csv/jobs'
      const r = await fetch(url, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
    refetchInterval: 5000,
  })

  // ── Status de calibragem por CD (para desabilitar botão proativamente) ───────
  const uniqueCdIds = useMemo(
    () => [...new Set(jobs.filter(j => j.status === 'done').map(j => j.cd_id))],
    [jobs],
  )

  const cdStatusQueries = useQueries({
    queries: uniqueCdIds.map(id => ({
      queryKey: ['sp-resumo-cd', id],
      staleTime: 10_000,
      queryFn: async (): Promise<{ total_pendente: number }> => {
        // Só pendentes de CALIBRACAO travam nova ativação (realocação não conta)
        const r = await fetch(`/api/sp/propostas/resumo?cd_id=${id}&tipo_rel=CALIBRACAO`, { headers })
        if (!r.ok) return { total_pendente: 0 }
        return r.json()
      },
    })),
  })

  const cdHasPending = useMemo(() => {
    const map: Record<number, boolean> = {}
    uniqueCdIds.forEach((id, i) => {
      map[id] = (cdStatusQueries[i]?.data?.total_pendente ?? 0) > 0
    })
    return map
  }, [cdStatusQueries, uniqueCdIds])

  // ── Upload ───────────────────────────────────────────────────────────────────
  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) { toast.error('Selecione um arquivo CSV'); return }
    if (!filialID || !cdID) { toast.error('Selecione filial e CD'); return }

    setUploading(true)
    const form = new FormData()
    form.append('arquivo', file)
    form.append('filial_id', filialID)
    form.append('cd_id', cdID)

    try {
      const res = await fetch('/api/sp/csv/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      // O backend pode responder JSON ou texto puro (validações de formato).
      const raw = await res.text()
      let data: { error?: string; message?: string } = {}
      try { data = raw ? JSON.parse(raw) : {} } catch { data = { message: raw } }
      if (!res.ok) throw new Error(data.error ?? data.message ?? 'Erro no upload')
      toast.success('Arquivo enviado! Acompanhe o processamento no log.')
      qc.invalidateQueries({ queryKey: ['sp-csv-jobs'] })
      if (fileRef.current) fileRef.current.value = ''
      // Navega automaticamente para o log após importação
      navigate('/upload/log')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro no upload', { duration: 10000 })
    } finally {
      setUploading(false)
    }
  }

  // ── Motor ────────────────────────────────────────────────────────────────────
  const executarMotor = useMutation({
    mutationFn: async (jobId: string) => {
      const r = await fetch('/api/sp/motor/calibrar', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      })
      if (!r.ok) throw new Error((await r.text()) || 'Erro ao executar motor')
    },
    onSuccess: () => {
      toast.success('Calibração iniciada! As propostas serão geradas em instantes.')
      qc.invalidateQueries({ queryKey: ['sp-csv-jobs'] })
      qc.invalidateQueries({ queryKey: ['sp-resumo-cd'] })
      navigate('/dashboard/urgencia/falta')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Excluir lote (remoção completa: dados, propostas e histórico) ────────────
  const [deletingJobID, setDeletingJobID] = useState<string | null>(null)
  const excluirLote = useMutation({
    mutationFn: async (jobId: string) => {
      const r = await fetch(`/api/sp/csv/jobs/${jobId}`, { method: 'DELETE', headers })
      if (!r.ok) throw new Error((await r.text()) || 'Erro ao excluir lote')
    },
    onMutate: (jobId) => setDeletingJobID(jobId),
    onSuccess: () => {
      toast.success('Lote excluído')
      qc.invalidateQueries({ queryKey: ['sp-csv-jobs'] })
      qc.invalidateQueries({ queryKey: ['sp-resumo-cd'] })
      qc.invalidateQueries({ queryKey: ['sp-propostas'] })
      qc.invalidateQueries({ queryKey: ['sp-propostas-resumo'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setDeletingJobID(null),
  })

  // ── Concluir lote (dá baixa manual no ciclo → marca 'concluido') ─────────────
  const [concluindoJobID, setConcluindoJobID] = useState<string | null>(null)
  const concluirLote = useMutation({
    mutationFn: async (jobId: string) => {
      const r = await fetch(`/api/sp/csv/jobs/${jobId}/concluir`, { method: 'POST', headers })
      if (!r.ok) throw new Error((await r.text()) || 'Erro ao concluir o lote')
    },
    onMutate: (jobId) => setConcluindoJobID(jobId),
    onSuccess: () => {
      toast.success('Lote concluído — saiu dos painéis e liberou nova calibração')
      qc.invalidateQueries({ queryKey: ['sp-csv-jobs'] })
      qc.invalidateQueries({ queryKey: ['sp-resumo-cd'] })
      qc.invalidateQueries({ queryKey: ['sp-propostas'] })
      qc.invalidateQueries({ queryKey: ['sp-propostas-resumo'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setConcluindoJobID(null),
  })

  // ── Render ───────────────────────────────────────────────────────────────────

  // Aba Upload CSV
  if (!isLog) {
    return (
      <div className="space-y-4">
        <div className="border rounded-lg p-4 space-y-4 max-w-lg">
          <div>
            <h3 className="text-sm font-semibold">Importar arquivo WMS</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Formato: CSV separado por ponto e vírgula (;), exportação Winthor/WMS. Máx. 50 MB.
            </p>
          </div>

          {(filiaisError || filiais.length === 0) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {filiaisError
                ? 'Não foi possível carregar as filiais. Verifique se sua empresa está configurada corretamente ou contate o administrador.'
                : 'Nenhuma filial cadastrada para sua empresa. O administrador precisa criar as filiais em Administração → Gestão de Filiais usando a empresa correta.'}
            </div>
          )}

          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Filial</label>
              <Select value={filialID} onValueChange={v => { setFilialID(v); setCdID('') }} disabled={filiais.length === 0}>
                <SelectTrigger><SelectValue placeholder={filiais.length === 0 ? 'Sem filiais disponíveis' : 'Selecione a filial'} /></SelectTrigger>
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
              <label className="text-xs font-medium mb-1 block">Centro de Distribuição</label>
              <Select value={cdID} onValueChange={setCdID} disabled={!filialID}>
                <SelectTrigger><SelectValue placeholder="Selecione o CD" /></SelectTrigger>
                <SelectContent>
                  {cds.map(cd => (
                    <SelectItem key={cd.id} value={String(cd.id)}>{cd.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block">Arquivo CSV / TXT</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
              />
            </div>

            <Button disabled={uploading || !filialID || !cdID} onClick={handleUpload}>
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? 'Enviando...' : 'Enviar arquivo'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Aba Log de Importação
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Log de Importação</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Após o status <strong>Concluído</strong>, clique em <strong>Ativar Calibração</strong> para o motor gerar as propostas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={cdID || 'all'} onValueChange={v => setCdID(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs w-48">
              <SelectValue placeholder="Filtrar por CD" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os CDs</SelectItem>
              {jobs.filter((j, i, a) => a.findIndex(x => x.cd_id === j.cd_id) === i)
                .map(j => (
                  <SelectItem key={j.cd_id} value={String(j.cd_id)}>CD {j.cd_id}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetchJobs()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Arquivo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Linhas</TableHead>
            <TableHead>Importado em</TableHead>
            <TableHead>Concluído em</TableHead>
            <TableHead className="w-36">Calibragem</TableHead>
            <TableHead className="w-44">Ação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                Nenhuma importação encontrada.
              </TableCell>
            </TableRow>
          )}
          {jobs.map(j => (
            <TableRow key={j.id}>
              <TableCell className="text-sm max-w-xs truncate" title={j.filename}>
                <div>{j.filename}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{j.id.slice(0, 8)}…</div>
              </TableCell>
              <TableCell>
                <StatusBadge status={j.status} />
                {j.erro_msg && (
                  <p className="text-[10px] text-red-600 mt-0.5 max-w-xs truncate" title={j.erro_msg}>
                    {j.erro_msg}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {j.status === 'done'
                  ? <><span className="text-green-600">{j.linhas_ok} ok</span>
                      {j.linhas_erro ? <span className="text-red-500 ml-1">{j.linhas_erro} err</span> : null}</>
                  : '—'}
              </TableCell>
              <TableCell className="text-xs">{fmtDate(j.created_at)}</TableCell>
              <TableCell className="text-xs">{fmtDate(j.finished_at)}</TableCell>
              <TableCell className="py-2">
                {j.status === 'done' ? <BatchStatusMini jobId={j.id} /> : null}
              </TableCell>
              <TableCell>
                {(() => {
                  const isPending = executarMotor.isPending && motorJobID === j.id
                  const isDeleting = excluirLote.isPending && deletingJobID === j.id
                  const isConcluindo = concluirLote.isPending && concluindoJobID === j.id
                  const ciclo = j.ciclo_status ?? ''
                  // Estado do lote: não ativado | em andamento | concluído.
                  const naoAtivado = j.status === 'done' && ciclo === ''
                  const emAndamento = ciclo === 'em_andamento'
                  const concluido = ciclo === 'concluido'
                  // Só bloqueia ativar quando OUTRO lote do CD está em andamento.
                  const cdBlocked = cdHasPending[j.cd_id] ?? false
                  const podeExcluir = j.status !== 'pending' && j.status !== 'processing'
                  const temCalibragem = emAndamento || concluido
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        {/* Não ativado → Ativar Calibração (trava se outro lote do CD está aberto) */}
                        {naoAtivado && (
                          <Button
                            size="sm"
                            className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                            disabled={isPending || cdBlocked || isDeleting}
                            title={cdBlocked ? 'Há um lote em andamento neste CD. Conclua-o antes de iniciar uma nova calibração.' : undefined}
                            onClick={() => { setMotorJobID(j.id); executarMotor.mutate(j.id) }}
                          >
                            <Zap className="h-3.5 w-3.5 mr-1" />
                            {isPending ? 'Iniciando…' : 'Ativar Calibração'}
                          </Button>
                        )}
                        {/* Em andamento → Concluir (dar baixa manual) */}
                        {emAndamento && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50"
                            disabled={isConcluindo}
                            title="Concluir: marca o lote como Concluído, tira dos painéis e libera nova calibração (mantém o histórico)"
                            onClick={() => {
                              if (window.confirm(`Concluir o lote "${j.filename}"?\n\nEle será marcado como Concluído, sairá dos painéis de Calibragem/Realocação e liberará uma nova calibração. As propostas pendentes restantes não serão mais exibidas. O histórico é mantido.`)) {
                                concluirLote.mutate(j.id)
                              }
                            }}
                          >
                            {isConcluindo
                              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              : <CheckCheck className="h-3.5 w-3.5 mr-1" />}
                            {isConcluindo ? 'Concluindo…' : 'Concluir'}
                          </Button>
                        )}
                        {/* Concluído → selo read-only */}
                        {concluido && (
                          <span className="inline-flex items-center gap-1 h-8 px-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md">
                            <CheckCheck className="h-3.5 w-3.5" /> Concluído
                          </span>
                        )}
                        {podeExcluir && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50"
                            disabled={isDeleting || isPending}
                            title="Excluir este lote e tudo que veio dele (dados, propostas e histórico)"
                            onClick={() => {
                              const aviso = temCalibragem
                                ? `\n\n⚠ ATENÇÃO: este lote já foi calibrado. Excluir vai apagar TAMBÉM as propostas e o histórico dele. Esta ação não pode ser desfeita.`
                                : `\n\nIsso remove o arquivo importado e seus dados.`
                              if (window.confirm(`Excluir o lote "${j.filename}"?${aviso}`)) {
                                excluirLote.mutate(j.id)
                              }
                            }}
                          >
                            {isDeleting
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                      {emAndamento && (
                        <p className="text-[10px] text-amber-600 leading-tight max-w-[160px]">
                          Calibragem em andamento
                        </p>
                      )}
                    </div>
                  )
                })()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {jobs.some(j => j.status === 'pending' || j.status === 'processing') && (
        <p className="text-xs text-muted-foreground animate-pulse">
          Processamento em andamento — atualizando a cada 5s…
        </p>
      )}
    </div>
  )
}
