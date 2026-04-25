import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Trash2, Pencil, Mail } from 'lucide-react'
import { toast } from 'sonner'

interface SpFilial { id: number; cod_filial: number; nome: string }
interface SpCD     { id: number; filial_id: number; nome: string }

interface Destinatario {
  id: number
  cd_id: number
  nome_completo: string
  cargo: string
  email: string
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export default function SpDestinatarios() {
  const { token } = useAuth()
  const qc = useQueryClient()
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [filialID, setFilialID] = useState('')
  const [cdID, setCdID]         = useState('')
  const [editingID, setEditingID] = useState<number | null>(null)
  const [creating, setCreating]  = useState(false)
  const [form, setForm] = useState({ nome_completo: '', cargo: '', email: '', ativo: true })

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

  const { data: destinatarios = [] } = useQuery<Destinatario[]>({
    queryKey: ['sp-destinatarios', cdID],
    enabled: !!cdID,
    queryFn: async () => {
      const r = await fetch(`/api/sp/admin/destinatarios?cd_id=${cdID}`, { headers })
      if (!r.ok) throw new Error()
      return r.json()
    },
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: ['sp-destinatarios', cdID] })
  const resetForm = () => { setForm({ nome_completo: '', cargo: '', email: '', ativo: true }); setCreating(false); setEditingID(null) }

  const criarMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sp/admin/destinatarios', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cd_id: Number(cdID), ...form }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Erro')
      return data
    },
    onSuccess: () => { toast.success('Destinatário cadastrado'); resetForm(); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })

  const atualizarMut = useMutation({
    mutationFn: async () => {
      if (!editingID) throw new Error('id ausente')
      const r = await fetch(`/api/sp/admin/destinatarios/${editingID}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Erro')
    },
    onSuccess: () => { toast.success('Destinatário atualizado'); resetForm(); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })

  const removerMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sp/admin/destinatarios/${id}`, { method: 'DELETE', headers })
      if (!r.ok) throw new Error()
    },
    onSuccess: () => { toast.success('Removido'); invalidar() },
    onError: () => toast.error('Erro ao remover'),
  })

  function abrirEdicao(d: Destinatario) {
    setEditingID(d.id)
    setForm({ nome_completo: d.nome_completo, cargo: d.cargo, email: d.email, ativo: d.ativo })
    setCreating(true)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" /> Destinatários do Resumo Executivo
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Cadastre os gestores que receberão o resumo semanal por email. O envio é automático
          toda segunda-feira pela manhã.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium mb-1 block">Filial</label>
          <Select value={filialID} onValueChange={v => { setFilialID(v); setCdID('') }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {filiais.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome} (cód. {f.cod_filial})</SelectItem>)}
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
          <Button size="sm" onClick={() => { resetForm(); setCreating(true) }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Novo destinatário
          </Button>
        )}
      </div>

      {!cdID && (
        <p className="text-xs text-muted-foreground">Selecione filial e CD para gerenciar destinatários.</p>
      )}

      {/* Tabela */}
      {cdID && destinatarios.length === 0 && (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <Mail className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhum destinatário cadastrado para este CD.</p>
        </div>
      )}

      {cdID && destinatarios.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="py-2">Nome completo</TableHead>
              <TableHead className="py-2">Cargo</TableHead>
              <TableHead className="py-2">Email</TableHead>
              <TableHead className="py-2 w-24">Ativo</TableHead>
              <TableHead className="py-2 w-32">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {destinatarios.map(d => (
              <TableRow key={d.id} className={`text-xs ${!d.ativo ? 'opacity-50' : ''}`}>
                <TableCell className="py-1.5 font-medium">{d.nome_completo}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground">{d.cargo || '—'}</TableCell>
                <TableCell className="py-1.5 font-mono text-[11px]">{d.email}</TableCell>
                <TableCell className="py-1.5">
                  {d.ativo
                    ? <span className="inline-flex px-2 py-0.5 rounded bg-green-100 text-green-800 text-[10px] font-medium">Ativo</span>
                    : <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium">Inativo</span>}
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => abrirEdicao(d)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-6 text-[10px] px-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { if (confirm('Remover destinatário?')) removerMut.mutate(d.id) }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Dialog de cadastro/edição */}
      <Dialog open={creating} onOpenChange={open => { if (!open) resetForm() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingID ? 'Editar destinatário' : 'Novo destinatário'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1">Nome completo *</label>
              <Input value={form.nome_completo} onChange={e => setForm({ ...form, nome_completo: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Cargo</label>
              <Input value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })} placeholder="ex: Gerente de Logística" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Email *</label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} type="email" />
            </div>
            {editingID && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
                Ativo (recebe emails)
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancelar</Button>
            <Button
              onClick={() => editingID ? atualizarMut.mutate() : criarMut.mutate()}
              disabled={!form.nome_completo || !form.email || criarMut.isPending || atualizarMut.isPending}
            >
              {editingID ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
