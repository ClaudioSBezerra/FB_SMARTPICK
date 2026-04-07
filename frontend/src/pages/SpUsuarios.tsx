import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { ShieldCheck, Building2 } from 'lucide-react'
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
  const [selected,      setSelected]      = useState<SpUsuario | null>(null)
  const [newRole,       setNewRole]       = useState('')
  const [allFiliais,    setAllFiliais]    = useState(false)
  const [chosenFiliais, setChosenFiliais] = useState<number[]>([])

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
    mutationFn: async ({ id, sp_role }: { id: string; sp_role: string }) => {
      const res = await fetch(`/api/sp/usuarios/${id}/role`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ sp_role }),
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Usuários SmartPick</h2>
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

      {/* ── Dialog: alterar perfil ─────────────────────────────────────────── */}
      <Dialog open={roleDialog} onOpenChange={setRoleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar Perfil SmartPick</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{selected?.full_name}</p>
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
              disabled={updateRole.isPending || !newRole}
              onClick={() => selected && updateRole.mutate({ id: selected.id, sp_role: newRole })}
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
