import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, Copy, Settings2, Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpFilial {
  id: number
  cod_filial: number
  nome: string
  ativo: boolean
  num_cds: number
  created_at: string
}

interface SpCD {
  id: number
  filial_id: number
  nome: string
  descricao: string
  ativo: boolean
  fonte_cd_id?: number
  created_at: string
}

interface SpMotorParams {
  id: number
  cd_id: number
  dias_analise: number
  curva_a_max_est: number
  curva_b_max_est: number
  curva_c_max_est: number
  fator_seguranca: number
  curva_a_nunca_reduz: boolean
  min_capacidade: number
  retencao_csv_meses: number
  updated_at: string
}

interface SpPlano {
  plano: string
  max_filiais: number
  max_cds: number
  max_usuarios: number
  ativo: boolean
  valido_ate: string | null
  usado_filiais: number
  usado_cds: number
  usado_usuarios: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function UsageBar({ used, max }: { used: number; max: number }) {
  if (max === -1) return <span className="text-xs text-muted-foreground">{used} / ∞</span>
  const pct = Math.min(100, Math.round((used / max) * 100))
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{used}/{max}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpAmbiente() {
  const { token } = useAuth()
  const qc = useQueryClient()
  const location = useLocation()
  const path = location.pathname
  const isFiliais   = path === '/gestao/filiais'
  const isRegras    = path === '/gestao/regras' || path === '/config/parametros-motor'
  const isPlanos    = path === '/config/planos'
  const isManutencao = path === '/config/manutencao'

  // ── State ────────────────────────────────────────────────────────────────────
  const [expandedFilial, setExpandedFilial] = useState<number | null>(null)
  const [paramsCD,       setParamsCD]       = useState<number | null>(null)

  const [filialDialog,   setFilialDialog]   = useState(false)
  const [cdDialog,       setCdDialog]       = useState<{ filialID: number } | null>(null)
  const [dupDialog,      setDupDialog]      = useState<SpCD | null>(null)
  const [paramsDialog,   setParamsDialog]   = useState<SpMotorParams | null>(null)

  const [newFilialCod,   setNewFilialCod]   = useState('')
  const [newFilialNome,  setNewFilialNome]  = useState('')
  const [newCDNome,      setNewCDNome]      = useState('')
  const [newCDDesc,      setNewCDDesc]      = useState('')
  const [dupNome,        setDupNome]        = useState('')
  const [editParams,     setEditParams]     = useState<Partial<SpMotorParams>>({})
  const [limparDialog,   setLimparDialog]   = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────────
  const headers = { Authorization: `Bearer ${token}` }

  const { data: filiais = [], isLoading: loadingFiliais } = useQuery<SpFilial[]>({
    queryKey: ['sp-filiais'],
    queryFn: async () => {
      const r = await fetch('/api/sp/filiais', { headers })
      if (!r.ok) throw new Error('Erro ao carregar filiais')
      return r.json()
    },
  })

  const { data: cds = [] } = useQuery<SpCD[]>({
    queryKey: ['sp-cds', expandedFilial],
    enabled: expandedFilial !== null,
    queryFn: async () => {
      const r = await fetch(`/api/sp/filiais/${expandedFilial}/cds`, { headers })
      if (!r.ok) throw new Error('Erro ao carregar CDs')
      return r.json()
    },
  })

  const { data: plano, isLoading: loadingPlano, isError: erroPlano } = useQuery<SpPlano>({
    queryKey: ['sp-plano'],
    queryFn: async () => {
      const r = await fetch('/api/sp/plano', { headers })
      if (!r.ok) throw new Error('Erro ao carregar plano')
      return r.json()
    },
  })

  // Todos os CDs da empresa (usado na view de Regras de Calibragem)
  const { data: todosOsCds = [] } = useQuery<(SpCD & { filial_nome: string; cod_filial: number })[]>({
    queryKey: ['sp-todos-cds'],
    enabled: isRegras,
    queryFn: async () => {
      const filiaisR = await fetch('/api/sp/filiais', { headers })
      if (!filiaisR.ok) throw new Error()
      const filiaisData: SpFilial[] = await filiaisR.json()
      const results: (SpCD & { filial_nome: string; cod_filial: number })[] = []
      await Promise.all(filiaisData.map(async f => {
        const r = await fetch(`/api/sp/filiais/${f.id}/cds`, { headers })
        if (!r.ok) return
        const cdsData: SpCD[] = await r.json()
        cdsData.forEach(cd => results.push({ ...cd, filial_nome: f.nome, cod_filial: f.cod_filial }))
      }))
      return results.sort((a, b) => a.filial_nome.localeCompare(b.filial_nome) || a.nome.localeCompare(b.nome))
    },
  })

  // ── Mutations ────────────────────────────────────────────────────────────────
  const criarFilial = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sp/filiais', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cod_filial: parseInt(newFilialCod), nome: newFilialNome }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro ao criar filial')
    },
    onSuccess: () => {
      toast.success('Filial criada')
      qc.invalidateQueries({ queryKey: ['sp-filiais'] })
      qc.invalidateQueries({ queryKey: ['sp-plano'] })
      setFilialDialog(false); setNewFilialCod(''); setNewFilialNome('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const criarCD = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/sp/filiais/${cdDialog!.filialID}/cds`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: newCDNome, descricao: newCDDesc }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro ao criar CD')
    },
    onSuccess: () => {
      toast.success('CD criado')
      qc.invalidateQueries({ queryKey: ['sp-cds', cdDialog!.filialID] })
      qc.invalidateQueries({ queryKey: ['sp-plano'] })
      setCdDialog(null); setNewCDNome(''); setNewCDDesc('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const duplicarCD = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/sp/cds/${dupDialog!.id}/duplicar`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: dupNome }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro ao duplicar CD')
    },
    onSuccess: () => {
      toast.success('CD duplicado')
      qc.invalidateQueries({ queryKey: ['sp-cds', dupDialog!.filial_id] })
      qc.invalidateQueries({ queryKey: ['sp-plano'] })
      setDupDialog(null); setDupNome('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const salvarParams = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/sp/cds/${paramsDialog!.cd_id}/params`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(editParams),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Erro ao salvar parâmetros')
    },
    onSuccess: () => {
      toast.success('Parâmetros atualizados')
      qc.invalidateQueries({ queryKey: ['sp-params', paramsCD] })
      setParamsDialog(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const desativarFilial = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sp/filiais/${id}`, {
        method: 'DELETE', headers,
      })
      if (!r.ok) throw new Error('Erro ao desativar filial')
    },
    onSuccess: () => {
      toast.success('Filial desativada')
      qc.invalidateQueries({ queryKey: ['sp-filiais'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const limparCalibragem = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sp/admin/limpar-calibragem', {
        method: 'DELETE', headers,
      })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    onSuccess: (data: Record<string, unknown>) => {
      toast.success(`Limpeza concluída: ${data.sp_propostas ?? 0} propostas, ${data.sp_enderecos ?? 0} endereços, ${data.sp_csv_jobs ?? 0} jobs removidos`)
      qc.invalidateQueries({ queryKey: ['sp-plano'] })
      setLimparDialog(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function openParams(cd: SpCD) {
    setParamsCD(cd.id)
    fetch(`/api/sp/cds/${cd.id}/params`, { headers })
      .then(r => r.json())
      .then((p: SpMotorParams) => { setParamsDialog(p); setEditParams(p) })
      .catch(() => toast.error('Erro ao carregar parâmetros'))
  }

  // ── Render: Regras de Calibragem ─────────────────────────────────────────────
  if (isRegras) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Regras de Calibragem</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Defina por CD como o algoritmo calcula a sugestão de capacidade:
            quantos dias de venda analisar, limite de estoque por curva (A/B/C),
            fator de segurança e regras especiais.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filial</TableHead>
              <TableHead>CD</TableHead>
              <TableHead className="text-right">Dias Análise</TableHead>
              <TableHead className="text-right">A (dias)</TableHead>
              <TableHead className="text-right">B (dias)</TableHead>
              <TableHead className="text-right">C (dias)</TableHead>
              <TableHead className="text-right">Fat. Seg.</TableHead>
              <TableHead className="text-right">Cap. Mín.</TableHead>
              <TableHead className="text-right">Retenção</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {todosOsCds.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                  Nenhum CD cadastrado.
                </TableCell>
              </TableRow>
            )}
            {todosOsCds.map(cd => (
              <TableRow key={cd.id}>
                <TableCell className="text-xs text-muted-foreground">{cd.filial_nome}</TableCell>
                <TableCell className="text-sm font-medium">{cd.nome}</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => openParams(cd)}>
                    <Settings2 className="h-3.5 w-3.5 mr-1" /> Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Reutiliza o dialog de parâmetros existente */}
        <Dialog open={!!paramsDialog} onOpenChange={() => setParamsDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Regras de Calibragem — {todosOsCds.find(c => c.id === paramsDialog?.cd_id)?.nome}</DialogTitle></DialogHeader>
            {paramsDialog && (
              <div className="grid grid-cols-2 gap-3 py-2">
                <div className="grid gap-1.5">
                  <Label>Dias de Análise</Label>
                  <Input type="number" value={editParams.dias_analise ?? 90}
                    onChange={e => setEditParams(p => ({ ...p, dias_analise: +e.target.value }))} />
                  <p className="text-xs text-muted-foreground">Janela de vendas para calcular o giro médio</p>
                </div>
                <div className="grid gap-1.5">
                  <Label>Fator de Segurança</Label>
                  <Input type="number" step="0.01" value={editParams.fator_seguranca ?? 1.10}
                    onChange={e => setEditParams(p => ({ ...p, fator_seguranca: +e.target.value }))} />
                  <p className="text-xs text-muted-foreground">Ex: 1.10 = +10% sobre a média de vendas</p>
                </div>
                <div className="grid gap-1.5">
                  <Label>Curva A — máx. dias estoque</Label>
                  <Input type="number" value={editParams.curva_a_max_est ?? 7}
                    onChange={e => setEditParams(p => ({ ...p, curva_a_max_est: +e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Curva B — máx. dias estoque</Label>
                  <Input type="number" value={editParams.curva_b_max_est ?? 15}
                    onChange={e => setEditParams(p => ({ ...p, curva_b_max_est: +e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Curva C — máx. dias estoque</Label>
                  <Input type="number" value={editParams.curva_c_max_est ?? 30}
                    onChange={e => setEditParams(p => ({ ...p, curva_c_max_est: +e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Capacidade mínima absoluta</Label>
                  <Input type="number" value={editParams.min_capacidade ?? 1}
                    onChange={e => setEditParams(p => ({ ...p, min_capacidade: +e.target.value }))} />
                </div>
                <div className="col-span-2 flex items-center gap-2 pt-1">
                  <input type="checkbox" id="curva-a-nunca-r"
                    checked={editParams.curva_a_nunca_reduz ?? true}
                    onChange={e => setEditParams(p => ({ ...p, curva_a_nunca_reduz: e.target.checked }))} />
                  <Label htmlFor="curva-a-nunca-r" className="cursor-pointer">
                    Curva A: nunca reduzir capacidade
                  </Label>
                </div>
                <div className="col-span-2 border-t pt-3 mt-1">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Retenção de Dados</p>
                </div>
                <div className="grid gap-1.5 col-span-2">
                  <Label>Retenção de importações (meses)</Label>
                  <Input type="number" min={1} max={60}
                    value={editParams.retencao_csv_meses ?? 6}
                    onChange={e => setEditParams(p => ({ ...p, retencao_csv_meses: +e.target.value }))} />
                  <p className="text-xs text-muted-foreground">
                    Dados brutos de CSV são removidos após este período. Propostas e histórico são preservados.
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setParamsDialog(null)}>Cancelar</Button>
              <Button disabled={salvarParams.isPending} onClick={() => salvarParams.mutate()}>
                {salvarParams.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── Shared: dialogs (filiais, CDs, params) ──────────────────────────────────
  const sharedDialogs = (
    <>
      <Dialog open={!!paramsDialog} onOpenChange={() => setParamsDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Regras de Calibragem — {todosOsCds.find(c => c.id === paramsDialog?.cd_id)?.nome ?? 'CD'}</DialogTitle>
          </DialogHeader>
          {paramsDialog && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>Dias de Análise</Label>
                <Input type="number" value={editParams.dias_analise ?? 90}
                  onChange={e => setEditParams(p => ({ ...p, dias_analise: +e.target.value }))} />
                <p className="text-xs text-muted-foreground">Janela de vendas para o giro médio</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Fator de Segurança</Label>
                <Input type="number" step="0.01" value={editParams.fator_seguranca ?? 1.10}
                  onChange={e => setEditParams(p => ({ ...p, fator_seguranca: +e.target.value }))} />
                <p className="text-xs text-muted-foreground">1.10 = +10% sobre a média</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Curva A — máx. dias estoque</Label>
                <Input type="number" value={editParams.curva_a_max_est ?? 7}
                  onChange={e => setEditParams(p => ({ ...p, curva_a_max_est: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Curva B — máx. dias estoque</Label>
                <Input type="number" value={editParams.curva_b_max_est ?? 15}
                  onChange={e => setEditParams(p => ({ ...p, curva_b_max_est: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Curva C — máx. dias estoque</Label>
                <Input type="number" value={editParams.curva_c_max_est ?? 30}
                  onChange={e => setEditParams(p => ({ ...p, curva_c_max_est: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Capacidade mínima absoluta</Label>
                <Input type="number" value={editParams.min_capacidade ?? 1}
                  onChange={e => setEditParams(p => ({ ...p, min_capacidade: +e.target.value }))} />
              </div>
              <div className="col-span-2 flex items-center gap-2 pt-1">
                <input type="checkbox" id="curva-a-nunca"
                  checked={editParams.curva_a_nunca_reduz ?? true}
                  onChange={e => setEditParams(p => ({ ...p, curva_a_nunca_reduz: e.target.checked }))} />
                <Label htmlFor="curva-a-nunca" className="cursor-pointer">
                  Curva A: nunca reduzir capacidade
                </Label>
              </div>
              <div className="col-span-2 border-t pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Retenção de Dados</p>
              </div>
              <div className="grid gap-1.5 col-span-2">
                <Label>Retenção de importações (meses)</Label>
                <Input type="number" min={1} max={60}
                  value={editParams.retencao_csv_meses ?? 6}
                  onChange={e => setEditParams(p => ({ ...p, retencao_csv_meses: +e.target.value }))} />
                <p className="text-xs text-muted-foreground">
                  Dados brutos de CSV removidos após este período. Propostas e histórico preservados.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setParamsDialog(null)}>Cancelar</Button>
            <Button disabled={salvarParams.isPending} onClick={() => salvarParams.mutate()}>
              {salvarParams.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={filialDialog} onOpenChange={setFilialDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Filial</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Código WMS (CODFILIAL)</Label>
              <Input type="number" value={newFilialCod} onChange={e => setNewFilialCod(e.target.value)} placeholder="11" />
            </div>
            <div className="grid gap-1.5">
              <Label>Nome</Label>
              <Input value={newFilialNome} onChange={e => setNewFilialNome(e.target.value)} placeholder="Filial SP" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilialDialog(false)}>Cancelar</Button>
            <Button disabled={criarFilial.isPending || !newFilialCod || !newFilialNome}
              onClick={() => criarFilial.mutate()}>
              {criarFilial.isPending ? 'Criando...' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cdDialog} onOpenChange={() => setCdDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Novo Centro de Distribuição</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Nome do CD</Label>
              <Input value={newCDNome} onChange={e => setNewCDNome(e.target.value)} placeholder="CD Principal" />
            </div>
            <div className="grid gap-1.5">
              <Label>Descrição (opcional)</Label>
              <Textarea value={newCDDesc} onChange={e => setNewCDDesc(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCdDialog(null)}>Cancelar</Button>
            <Button disabled={criarCD.isPending || !newCDNome} onClick={() => criarCD.mutate()}>
              {criarCD.isPending ? 'Criando...' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dupDialog} onOpenChange={() => setDupDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Duplicar CD</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Copia "{dupDialog?.nome}" com todos os parâmetros.</p>
            <div className="grid gap-1.5">
              <Label>Nome do novo CD</Label>
              <Input value={dupNome} onChange={e => setDupNome(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupDialog(null)}>Cancelar</Button>
            <Button disabled={duplicarCD.isPending || !dupNome} onClick={() => duplicarCD.mutate()}>
              {duplicarCD.isPending ? 'Duplicando...' : 'Duplicar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  // ── Render: Filiais e CDs ────────────────────────────────────────────────────
  if (isFiliais) return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Filiais cadastradas</h3>
            <Button size="sm" onClick={() => setFilialDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova Filial
            </Button>
          </div>

          {loadingFiliais ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <div className="border rounded-md divide-y">
              {filiais.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground text-center">Nenhuma filial cadastrada.</p>
              )}
              {filiais.map(f => (
                <div key={f.id}>
                  {/* Linha da filial */}
                  <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50">
                    <button
                      className="p-0.5 text-muted-foreground"
                      onClick={() => setExpandedFilial(expandedFilial === f.id ? null : f.id)}
                    >
                      {expandedFilial === f.id
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <span className="font-medium text-sm flex-1">{f.nome}</span>
                    <Badge variant="outline" className="text-xs">Cód. {f.cod_filial}</Badge>
                    <span className="text-xs text-muted-foreground">{f.num_cds} CD(s)</span>
                    {!f.ativo && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"
                      onClick={() => desativarFilial.mutate(f.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* CDs da filial (expansível) */}
                  {expandedFilial === f.id && (
                    <div className="bg-gray-50 px-8 py-2 space-y-1">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-muted-foreground font-medium">Centros de Distribuição</span>
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => setCdDialog({ filialID: f.id })}>
                          <Plus className="h-3 w-3 mr-1" /> Novo CD
                        </Button>
                      </div>
                      {cds.filter(cd => cd.filial_id === f.id).length === 0 && (
                        <p className="text-xs text-muted-foreground italic">Nenhum CD cadastrado.</p>
                      )}
                      {cds.filter(cd => cd.filial_id === f.id).map(cd => (
                        <div key={cd.id} className="flex items-center gap-2 py-1">
                          <span className="text-sm flex-1">{cd.nome}</span>
                          {cd.fonte_cd_id && (
                            <Badge variant="outline" className="text-[10px]">cópia</Badge>
                          )}
                          {!cd.ativo && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Parâmetros"
                            onClick={() => openParams(cd)}>
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicar"
                            onClick={() => { setDupDialog(cd); setDupNome(cd.nome + ' (cópia)') }}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Aba: Plano ─────────────────────────────────────────────────── */}
        <TabsContent value="plano">
          {loadingPlano && <p className="text-sm text-muted-foreground py-4">Carregando plano...</p>}
          {erroPlano && <p className="text-sm text-destructive py-4">Erro ao carregar informações do plano.</p>}
          {plano && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Plano atual:</span>
                <Badge className="capitalize">{plano.plano}</Badge>
                {!plano.ativo && <Badge variant="destructive">Inativo</Badge>}
                {plano.valido_ate && (
                  <span className="text-xs text-muted-foreground">
                    Válido até: {new Date(plano.valido_ate).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recurso</TableHead>
                    <TableHead>Uso</TableHead>
                    <TableHead>Limite</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Filiais</TableCell>
                    <TableCell><UsageBar used={plano.usado_filiais} max={plano.max_filiais} /></TableCell>
                    <TableCell className="text-sm">{plano.max_filiais === -1 ? 'Ilimitado' : plano.max_filiais}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>CDs</TableCell>
                    <TableCell><UsageBar used={plano.usado_cds} max={plano.max_cds} /></TableCell>
                    <TableCell className="text-sm">{plano.max_cds === -1 ? 'Ilimitado' : plano.max_cds}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Usuários</TableCell>
                    <TableCell><UsageBar used={plano.usado_usuarios} max={plano.max_usuarios} /></TableCell>
                    <TableCell className="text-sm">{plano.max_usuarios === -1 ? 'Ilimitado' : plano.max_usuarios}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Aba: Manutenção ─────────────────────────────────────────────── */}
        <TabsContent value="manutencao">
          <div className="space-y-4 max-w-lg">
            <div className="border rounded-md p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Limpar Dados de Calibragem</p>
                  <p className="text-xs text-muted-foreground">
                    Remove todos os imports de CSV, endereços, propostas e histórico de calibragem.
                    <strong> Preserva</strong> filiais, CDs, parâmetros do motor e usuários.
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setLimparDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Limpar dados de calibragem
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Dialog: Confirmar limpeza ───────────────────────────────────────── */}
      <Dialog open={limparDialog} onOpenChange={setLimparDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirmar limpeza
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Esta ação irá remover <strong>todos</strong> os imports, endereços, propostas e histórico de calibragem da empresa. Os cadastros (filiais, CDs e parâmetros) serão mantidos.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimparDialog(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={limparCalibragem.isPending}
              onClick={() => limparCalibragem.mutate()}
            >
              {limparCalibragem.isPending ? 'Limpando...' : 'Confirmar limpeza'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Nova Filial ─────────────────────────────────────────────── */}
      <Dialog open={filialDialog} onOpenChange={setFilialDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Filial</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Código WMS (CODFILIAL)</Label>
              <Input type="number" value={newFilialCod} onChange={e => setNewFilialCod(e.target.value)} placeholder="11" />
            </div>
            <div className="grid gap-1.5">
              <Label>Nome</Label>
              <Input value={newFilialNome} onChange={e => setNewFilialNome(e.target.value)} placeholder="Filial SP" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilialDialog(false)}>Cancelar</Button>
            <Button disabled={criarFilial.isPending || !newFilialCod || !newFilialNome}
              onClick={() => criarFilial.mutate()}>
              {criarFilial.isPending ? 'Criando...' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Novo CD ─────────────────────────────────────────────────── */}
      <Dialog open={!!cdDialog} onOpenChange={() => setCdDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Novo Centro de Distribuição</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Nome do CD</Label>
              <Input value={newCDNome} onChange={e => setNewCDNome(e.target.value)} placeholder="CD Principal" />
            </div>
            <div className="grid gap-1.5">
              <Label>Descrição (opcional)</Label>
              <Textarea value={newCDDesc} onChange={e => setNewCDDesc(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCdDialog(null)}>Cancelar</Button>
            <Button disabled={criarCD.isPending || !newCDNome} onClick={() => criarCD.mutate()}>
              {criarCD.isPending ? 'Criando...' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Duplicar CD ─────────────────────────────────────────────── */}
      <Dialog open={!!dupDialog} onOpenChange={() => setDupDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Duplicar CD</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Copia "{dupDialog?.nome}" com todos os parâmetros do motor.</p>
            <div className="grid gap-1.5">
              <Label>Nome do novo CD</Label>
              <Input value={dupNome} onChange={e => setDupNome(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupDialog(null)}>Cancelar</Button>
            <Button disabled={duplicarCD.isPending || !dupNome} onClick={() => duplicarCD.mutate()}>
              {duplicarCD.isPending ? 'Duplicando...' : 'Duplicar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Parâmetros do Motor ─────────────────────────────────────── */}
      <Dialog open={!!paramsDialog} onOpenChange={() => setParamsDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Parâmetros do Motor de Calibragem</DialogTitle></DialogHeader>
          {paramsDialog && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>Dias de Análise</Label>
                <Input type="number" value={editParams.dias_analise ?? 90}
                  onChange={e => setEditParams(p => ({ ...p, dias_analise: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Fator Segurança</Label>
                <Input type="number" step="0.01" value={editParams.fator_seguranca ?? 1.10}
                  onChange={e => setEditParams(p => ({ ...p, fator_seguranca: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Curva A — máx. dias estoque</Label>
                <Input type="number" value={editParams.curva_a_max_est ?? 7}
                  onChange={e => setEditParams(p => ({ ...p, curva_a_max_est: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Curva B — máx. dias estoque</Label>
                <Input type="number" value={editParams.curva_b_max_est ?? 15}
                  onChange={e => setEditParams(p => ({ ...p, curva_b_max_est: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Curva C — máx. dias estoque</Label>
                <Input type="number" value={editParams.curva_c_max_est ?? 30}
                  onChange={e => setEditParams(p => ({ ...p, curva_c_max_est: +e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Cap. mínima absoluta</Label>
                <Input type="number" value={editParams.min_capacidade ?? 1}
                  onChange={e => setEditParams(p => ({ ...p, min_capacidade: +e.target.value }))} />
              </div>
              <div className="col-span-2 flex items-center gap-2 pt-1">
                <input type="checkbox" id="curva-a-nunca"
                  checked={editParams.curva_a_nunca_reduz ?? true}
                  onChange={e => setEditParams(p => ({ ...p, curva_a_nunca_reduz: e.target.checked }))} />
                <Label htmlFor="curva-a-nunca" className="cursor-pointer">
                  Curva A: nunca reduzir capacidade
                </Label>
              </div>
              <div className="col-span-2 border-t pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Retenção de Dados</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Retenção de importações (meses)</Label>
                <Input type="number" min={1} max={60}
                  value={editParams.retencao_csv_meses ?? 6}
                  onChange={e => setEditParams(p => ({ ...p, retencao_csv_meses: +e.target.value }))} />
                <p className="text-xs text-muted-foreground">
                  Dados brutos de CSV (endereços) são removidos após este período. Propostas e histórico são preservados permanentemente.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setParamsDialog(null)}>Cancelar</Button>
            <Button disabled={salvarParams.isPending} onClick={() => salvarParams.mutate()}>
              {salvarParams.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
