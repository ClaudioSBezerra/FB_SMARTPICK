export interface ModuleTab {
  label: string
  path: string
  disabled?: boolean
  danger?: boolean
  adminOnly?: boolean
}

export interface ModuleConfig {
  label: string
  tabs: ModuleTab[]
}

// ─── SmartPick — Módulos e abas ───────────────────────────────────────────────
export const modules: Record<string, ModuleConfig> = {
  dashboard: {
    label: 'Painel de Calibragem',
    tabs: [
      { label: 'Urgência — Falta',   path: '/dashboard/urgencia/falta' },
      { label: 'Urgência — Espaço',  path: '/dashboard/urgencia/espaco' },
    ],
  },
  upload: {
    label: 'Importação CSV',
    tabs: [
      { label: 'Upload CSV',       path: '/upload/csv' },
      { label: 'Log de Importação', path: '/upload/log' },
    ],
  },
  config: {
    label: 'Configurações',
    tabs: [
      { label: 'Filiais e CDs',        path: '/config/ambiente' },
      { label: 'Parâmetros Motor',     path: '/config/parametros-motor' },
      { label: 'Planos e Limites',     path: '/config/planos' },
      { label: 'Ambiente',             path: '/config/gestao-ambiente' },
      { label: 'Usuários',             path: '/config/usuarios', adminOnly: true },
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
      { label: 'Gerar PDF',   path: '/pdf/gerar' },
    ],
  },
  reincidencia: {
    label: 'Reincidência',
    tabs: [
      { label: 'Reincidência de Calibragem', path: '/reincidencia' },
    ],
  },
}

export function getActiveModule(pathname: string): string {
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/dashboard')) return 'dashboard'
  if (pathname.startsWith('/upload')) return 'upload'
  if (pathname.startsWith('/historico')) return 'historico'
  if (pathname.startsWith('/pdf')) return 'pdf'
  if (pathname.startsWith('/config')) return 'config'
  if (pathname.startsWith('/reincidencia')) return 'reincidencia'
  return 'dashboard'
}
