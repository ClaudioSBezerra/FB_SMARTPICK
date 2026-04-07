import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Upload, RefreshCw, Play } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

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
  const fileRef = useRef<HTMLInputElement>(null)

  const [filialID,  setFilialID]  = useState<string>('')
  const [cdID,      setCdID]      = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [motorJobID, setMotorJobID] = useState<string>('')

  const headers = { Authorization: `Bearer ${token}` }

  // ── Queries ──────────────────────────────────────────────────────────────────
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

  const { data: jobs = [], refetch: refetchJobs } = useQuery<SpCSVJob[]>({
    queryKey: ['sp-csv-jobs', cdID],
    queryFn: async () => {
      const url = cdID ? `/api/sp/csv/jobs?cd_id=${cdID}` : '/api/sp/csv/jobs'
      const r = await fetch(url, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
    refetchInterval: 5000, // polling a cada 5s para atualizar status
  })

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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro no upload')
      toast.success(`Arquivo enviado. Job: ${data.job_id.slice(0, 8)}...`)
      qc.invalidateQueries({ queryKey: ['sp-csv-jobs'] })
      if (fileRef.current) fileRef.current.value = ''
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro no upload')
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
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro ao executar motor')
    },
    onSuccess: () => {
      toast.success('Motor iniciado. As propostas serão geradas em instantes.')
      qc.invalidateQueries({ queryKey: ['sp-csv-jobs'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload CSV</TabsTrigger>
          <TabsTrigger value="log">Log de Processamento</TabsTrigger>
        </TabsList>

        {/* ── Aba: Upload ──────────────────────────────────────────────────── */}
        <TabsContent value="upload" className="space-y-4">
          <div className="border rounded-lg p-4 space-y-4 max-w-lg">
            <h3 className="text-sm font-semibold">Importar arquivo WMS</h3>
            <p className="text-xs text-muted-foreground">
              Formato esperado: CSV separado por ponto e vírgula (;), colunas conforme
              exportação Winthor/WMS. Máx. 50 MB.
            </p>

            <div className="grid gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Filial</label>
                <Select value={filialID} onValueChange={v => { setFilialID(v); setCdID('') }}>
                  <SelectTrigger><SelectValue placeholder="Selecione a filial" /></SelectTrigger>
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
                <label className="text-xs font-medium mb-1 block">Arquivo CSV</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
              </div>

              <Button disabled={uploading || !filialID || !cdID} onClick={handleUpload}>
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? 'Enviando...' : 'Enviar arquivo'}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Aba: Log ─────────────────────────────────────────────────────── */}
        <TabsContent value="log" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Histórico de importações</h3>
            <Button size="sm" variant="outline" onClick={() => refetchJobs()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linhas</TableHead>
                <TableHead>Enviado em</TableHead>
                <TableHead>Concluído em</TableHead>
                <TableHead className="w-28">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Nenhum job encontrado.
                  </TableCell>
                </TableRow>
              )}
              {jobs.map(j => (
                <TableRow key={j.id}>
                  <TableCell className="text-sm max-w-xs truncate" title={j.filename}>
                    {j.filename}
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
                  <TableCell>
                    {j.status === 'done' && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        disabled={executarMotor.isPending && motorJobID === j.id}
                        onClick={() => { setMotorJobID(j.id); executarMotor.mutate(j.id) }}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Calibrar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {jobs.some(j => j.status === 'pending' || j.status === 'processing') && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Jobs em processamento — atualizando a cada 5s...
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
