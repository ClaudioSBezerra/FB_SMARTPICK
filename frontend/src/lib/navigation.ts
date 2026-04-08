export interface ModuleTab {
  label: string
  path: string
  disabled?: boolean
  danger?: boolean
  adminOnly?: boolean
}

export interface ModuleConfig {
  label: string
  adminOnly?: boolean
  tabs: ModuleTab[]
}

// ─── SmartPick — Módulos e abas ───────────────────────────────────────────────
export const modules: Record<string, ModuleConfig> = {
  dashboard: {
    label: 'Painel de Calibragem',
    tabs: [
      { label: 'Urgência — Falta',  path: '/dashboard/urgencia/falta' },
      { label: 'Urgência — Espaço', path: '/dashboard/urgencia/espaco' },
    ],
  },
  upload: {
    label: 'Importação CSV',
    tabs: [
      { label: 'Upload CSV',        path: '/upload/csv' },
      { label: 'Log de Importação', path: '/upload/log' },
    ],
  },
  historico: {
    label: 'Histórico',
    tabs: [
      { label: 'Histórico de Calibragem', path: '/historico' },
      { label: 'Compliance',              path: '/historico/compliance' },
    ],
  },
  pdf: {
    label: 'PDF',
    tabs: [
      { label: 'Gerar PDF', path: '/pdf/gerar' },
    ],
  },
  reincidencia: {
    label: 'Reincidência',
    tabs: [
      { label: 'Reincidência de Calibragem', path: '/reincidencia' },
    ],
  },
  // ── Administração (gestor_filial+ — oculto para admin) ───────────────────
  gestao: {
    label: 'Administração',
    tabs: [
      { label: 'Filiais e CDs',        path: '/gestao/filiais' },
      { label: 'Regras de Calibragem', path: '/gestao/regras' },
    ],
  },
  // ── Configurações (admin only) ────────────────────────────────────────────
  config: {
    label: 'Configurações',
    adminOnly: true,
    tabs: [
      { label: 'Plano e Limites', path: '/config/planos' },
      { label: 'Ambiente',        path: '/config/ambiente' },
      { label: 'Usuários',        path: '/config/usuarios' },
      { label: 'Manutenção',      path: '/config/manutencao' },
    ],
  },
}

export function getActiveModule(pathname: string): string {
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/dashboard')) return 'dashboard'
  if (pathname.startsWith('/upload')) return 'upload'
  if (pathname.startsWith('/historico')) return 'historico'
  if (pathname.startsWith('/pdf')) return 'pdf'
  if (pathname.startsWith('/reincidencia')) return 'reincidencia'
  if (pathname.startsWith('/gestao')) return 'gestao'
  if (pathname.startsWith('/config')) return 'config'
  return 'dashboard'
}
