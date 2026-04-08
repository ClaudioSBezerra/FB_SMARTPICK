import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { ShieldCheck, Building2, UserPlus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpUsuario {
  id: string
  email: string
  full_name: string
  sp_role: string
  is_verified: boolean
  trial_ends_at: string
  created_at: string
  all_filiais: boolean
  filial_ids: number[]
}

interface Filial {
  id: number
  nome: string
  cod_filial: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin_fbtax:     'Admin FbTax',
  gestor_geral:    'Gestor Geral',
  gestor_filial:   'Gestor de Filial',
  somente_leitura: 'Somente Leitura',
}

const ROLE_COLORS: Record<string, string> = {
  admin_fbtax:     'bg-red-100 text-red-800',
  gestor_geral:    'bg-blue-100 text-blue-800',
  gestor_filial:   'bg-green-100 text-green-800',
  somente_leitura: 'bg-gray-100 text-gray-600',
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role] ?? 'bg-gray-100'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpUsuarios() {
  const { token } = useAuth()
  const qc = useQueryClient()

  // ── State ────────────────────────────────────────────────────────────────────
  const [roleDialog,    setRoleDialog]    = useState(false)
  const [filiaisDialog, setFiliaisDialog] = useState(false)
  const [novoDialog,    setNovoDialog]    = useState(false)
  const [selected,      setSelected]      = useState<SpUsuario | null>(null)
  const [newRole,       setNewRole]       = useState('')
  const [allFiliais,    setAllFiliais]    = useState(false)
  const [chosenFiliais, setChosenFiliais] = useState<number[]>([])

  // Campos do novo usuário
  const [novoNome,       setNovoNome]       = useState('')
  const [novoEmail,      setNovoEmail]      = useState('')
  const [novaSenha,      setNovaSenha]      = useState('')
  const [novoSpRole,     setNovoSpRole]     = useState('somente_leitura')
  const [novoTrialDate,  setNovoTrialDate]  = useState('2099-12-31')
  const [novoAllFiliais, setNovoAllFiliais] = useState(false)
  const [novoFiliais,    setNovoFiliais]    = useState<number[]>([])

  // Hierarquia do novo usuário
  const [createEnvId,     setCreateEnvId]     = useState('')
  const [createGroupId,   setCreateGroupId]   = useState('')
  const [createCompanyId, setCreateCompanyId] = useState('')
  const [environments,    setEnvironments]    = useState<{id: string; name: string}[]>([])
  const [groups,          setGroups]          = useState<{id: string; name: string}[]>([])
  const [companies,       setCompanies]       = useState<{id: string; name: string}[]>([])

  // Campo de edição de nome (dialog de perfil)
  const [editNome, setEditNome] = useState('')

  // ── Hierarchy fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    fetch('/api/config/environments', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setEnvironments(d || []))
      .catch(() => setEnvironments([]))
  }, [token])

  useEffect(() => {
    if (!createEnvId) { setGroups([]); setCreateGroupId(''); return }
    fetch(`/api/config/groups?environment_id=${createEnvId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setGroups(d || []))
      .catch(() => setGroups([]))
  }, [createEnvId, token])

  useEffect(() => {
    if (!createGroupId) { setCompanies([]); setCreateCompanyId(''); return }
    fetch(`/api/config/companies?group_id=${createGroupId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCompanies(d || []))
      .catch(() => setCompanies([]))
  }, [createGroupId, token])

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: usuarios = [], isLoading } = useQuery<SpUsuario[]>({
    queryKey: ['sp-usuarios'],
    queryFn: async () => {
      const res = await fetch('/api/sp/usuarios', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Erro ao carregar usuários')
      return res.json()
    },
  })

  const { data: filiais = [] } = useQuery<Filial[]>({
    queryKey: ['filiais'],
    queryFn: async () => {
      const res = await fetch('/api/filiais', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Erro ao carregar filiais')
      return res.json()
    },
  })

  // ── Mutations ────────────────────────────────────────────────────────────────
  const updateRole = useMutation({
    mutationFn: async ({ id, sp_role, full_name }: { id: string; sp_role: string; full_name: string }) => {
      const res = await fetch(`/api/sp/usuarios/${id}/role`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ sp_role, full_name }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao atualizar perfil')
    },
    onSuccess: () => {
      toast.success('Perfil atualizado')
      qc.invalidateQueries({ queryKey: ['sp-usuarios'] })
      setRoleDialog(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const criarUsuario = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sp/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          full_name: novoNome,
          email: novoEmail,
          password: novaSenha,
          sp_role: novoSpRole,
          trial_ends_at: novoTrialDate,
          all_filiais: novoAllFiliais,
          filial_ids: novoAllFiliais ? [] : novoFiliais,
          ...(createEnvId     && { environment_id: createEnvId }),
          ...(createGroupId   && { group_id: createGroupId }),
          ...(createCompanyId && { company_id: createCompanyId }),
        }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Erro ao criar usuário')
      }
    },
    onSuccess: () => {
      toast.success('Usuário criado com sucesso')
      qc.invalidateQueries({ queryKey: ['sp-usuarios'] })
      setNovoDialog(false)
      setNovoNome(''); setNovoEmail(''); setNovaSenha('')
      setNovoSpRole('somente_leitura'); setNovoTrialDate('2099-12-31')
      setNovoAllFiliais(false); setNovoFiliais([])
      setCreateEnvId(''); setCreateGroupId(''); setCreateCompanyId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateFiliais = useMutation({
    mutationFn: async ({ id, all_filiais, filial_ids }: { id: string; all_filiais: boolean; filial_ids: number[] }) => {
      const res = await fetch(`/api/sp/usuarios/${id}/filiais`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ all_filiais, filial_ids }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Erro ao vincular filiais')
    },
    onSuccess: () => {
      toast.success('Filiais atualizadas')
      qc.invalidateQueries({ queryKey: ['sp-usuarios'] })
      setFiliaisDialog(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function openRoleDialog(u: SpUsuario) {
    setSelected(u)
    setNewRole(u.sp_role)
    setEditNome(u.full_name)
    setRoleDialog(true)
  }

  function openFiliaisDialog(u: SpUsuario) {
    setSelected(u)
    setAllFiliais(u.all_filiais)
    setChosenFiliais(u.filial_ids ?? [])
    setFiliaisDialog(true)
  }

  function toggleFilial(id: number) {
    setChosenFiliais(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function toggleNovoFilial(id: number) {
    setNovoFiliais(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Usuários SmartPick</h2>
        <Button size="sm" onClick={() => setNovoDialog(true)}>
          <UserPlus className="h-4 w-4 mr-1" /> Novo Usuário
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Perfil SmartPick</TableHead>
              <TableHead>Filiais</TableHead>
              <TableHead className="w-40">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                <TableCell><RoleBadge role={u.sp_role} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.all_filiais
                    ? <Badge variant="outline">Todas</Badge>
                    : u.filial_ids?.length
                      ? <span>{u.filial_ids.length} filial(is)</span>
                      : <span className="text-gray-400">—</span>
                  }
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => openRoleDialog(u)}>
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                      Perfil
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openFiliaisDialog(u)}>
                      <Building2 className="h-3.5 w-3.5 mr-1" />
                      Filiais
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {usuarios.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* ── Dialog: novo usuário ──────────────────────────────────────────── */}
      <Dialog open={novoDialog} onOpenChange={setNovoDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Usuário SmartPick</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Nome completo</Label>
              <Input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="João Silva" />
            </div>
            <div className="grid gap-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={novoEmail} onChange={e => setNovoEmail(e.target.value)} placeholder="joao@empresa.com" />
            </div>
            <div className="grid gap-1.5">
              <Label>Senha inicial</Label>
              <Input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
            <div className="grid gap-1.5">
              <Label>Perfil SmartPick</Label>
              <Select value={novoSpRole} onValueChange={setNovoSpRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gestor_geral">Gestor Geral</SelectItem>
                  <SelectItem value="gestor_filial">Gestor de Filial</SelectItem>
                  <SelectItem value="somente_leitura">Somente Leitura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Validade (data)</Label>
              <Input type="date" value={novoTrialDate} onChange={e => setNovoTrialDate(e.target.value)} />
            </div>

            {/* Hierarquia */}
            <div className="border-t pt-3 space-y-2">
              <Label className="text-sm font-semibold">Hierarquia</Label>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Ambiente</Label>
                <Select value={createEnvId} onValueChange={v => { setCreateEnvId(v); setCreateGroupId(''); setCreateCompanyId('') }}>
                  <SelectTrigger><SelectValue placeholder="Selecione o ambiente..." /></SelectTrigger>
                  <SelectContent>
                    {environments.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Grupo</Label>
                <Select value={createGroupId} onValueChange={v => { setCreateGroupId(v); setCreateCompanyId('') }} disabled={!createEnvId}>
                  <SelectTrigger><SelectValue placeholder={createEnvId ? 'Selecione o grupo...' : 'Selecione um ambiente primeiro'} /></SelectTrigger>
                  <SelectContent>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Empresa</Label>
                <Select value={createCompanyId} onValueChange={setCreateCompanyId} disabled={!createGroupId}>
                  <SelectTrigger><SelectValue placeholder={createGroupId ? 'Selecione a empresa...' : 'Selecione um grupo primeiro'} /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="novo-all" checked={novoAllFiliais} onCheckedChange={v => setNovoAllFiliais(!!v)} />
                <Label htmlFor="novo-all">Acesso a todas as filiais</Label>
              </div>
              {!novoAllFiliais && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto border rounded p-2">
                  {filiais.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma filial cadastrada.</p>}
                  {filiais.map(f => (
                    <div key={f.id} className="flex items-center gap-2">
                      <Checkbox id={`nf-${f.id}`} checked={novoFiliais.includes(f.id)} onCheckedChange={() => toggleNovoFilial(f.id)} />
                      <Label htmlFor={`nf-${f.id}`} className="text-sm cursor-pointer">
                        {f.nome} <span className="text-muted-foreground">({f.cod_filial})</span>
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoDialog(false)}>Cancelar</Button>
            <Button
              disabled={criarUsuario.isPending || !novoNome || !novoEmail || !novaSenha}
              onClick={() => criarUsuario.mutate()}
            >
              {criarUsuario.isPending ? 'Criando...' : 'Criar Usuário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: alterar perfil ─────────────────────────────────────────── */}
      <Dialog open={roleDialog} onOpenChange={setRoleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar Perfil SmartPick</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Nome completo</Label>
              <Input value={editNome} onChange={e => setEditNome(e.target.value)} placeholder="Nome do usuário" />
            </div>
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o perfil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin_fbtax">Admin FbTax</SelectItem>
                <SelectItem value="gestor_geral">Gestor Geral</SelectItem>
                <SelectItem value="gestor_filial">Gestor de Filial</SelectItem>
                <SelectItem value="somente_leitura">Somente Leitura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(false)}>Cancelar</Button>
            <Button
              disabled={updateRole.isPending || !newRole || !editNome}
              onClick={() => selected && updateRole.mutate({ id: selected.id, sp_role: newRole, full_name: editNome })}
            >
              {updateRole.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: vincular filiais ───────────────────────────────────────── */}
      <Dialog open={filiaisDialog} onOpenChange={setFiliaisDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Acesso às Filiais</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{selected?.full_name}</p>

            <div className="flex items-center gap-2">
              <Checkbox
                id="all-filiais"
                checked={allFiliais}
                onCheckedChange={(v) => setAllFiliais(!!v)}
              />
              <Label htmlFor="all-filiais">Acesso a todas as filiais</Label>
            </div>

            {!allFiliais && (
              <div className="space-y-2 max-h-52 overflow-y-auto border rounded p-2">
                {filiais.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma filial cadastrada ainda.</p>
                )}
                {filiais.map(f => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`f-${f.id}`}
                      checked={chosenFiliais.includes(f.id)}
                      onCheckedChange={() => toggleFilial(f.id)}
                    />
                    <Label htmlFor={`f-${f.id}`} className="text-sm cursor-pointer">
                      {f.nome} <span className="text-muted-foreground">({f.cod_filial})</span>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiliaisDialog(false)}>Cancelar</Button>
            <Button
              disabled={updateFiliais.isPending}
              onClick={() => selected && updateFiliais.mutate({
                id: selected.id,
                all_filiais: allFiliais,
                filial_ids: allFiliais ? [] : chosenFiliais,
              })}
            >
              {updateFiliais.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
