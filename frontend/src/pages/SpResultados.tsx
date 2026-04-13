import React, { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  AreaChart, Area, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Progress } from '@/components/ui/progress'

// ─── Metas contratuais ────────────────────────────────────────────────────────
const METAS = {
  pct_calibrados:            70,   // >70% SKUs calibrados no 1º ciclo
  reducao_ofensores_ab:      60,   // 60–80% redução ofensores A/B
  pct_realocado:             70,   // 70%+ realocação de caixas ociosas
  reducao_acessos_emergencia: 50,  // 50–70% redução reposições emergenciais
  reducao_acessos_total:     15,   // 15–30% redução acessos picking total
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface CicloKPI {
  job_id: string
  ciclo_num: number
  criado_em: string
  total_enderecos: number
  calibrados_ok: number
  pct_calibrados: number
  ofensores_falta_ab: number
  caixas_ociosas: number
  caixas_aprovadas: number
  pct_realocado: number
  acessos_emergencia: number
  acessos_total: number
}

interface SpResultadosCD {
  cd_id: number
  cd_nome: string
  filial_nome: string
  ciclos: CicloKPI[]
}

interface SpResultadosResponse {
  empresa: CicloKPI | null
  cds: SpResultadosCD[]
}

interface HistoricoKPI {
  job_id: string
  criado_em: string
  total_enderecos: number
  calibrados_ok: number
  pct_calibrados: number
  ofensores_falta: number
  ofensores_espaco: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// calcReducao: positivo = melhora (reduziu), negativo = piora (aumentou)
// ciclos[0] = mais recente, ciclos[last] = mais antigo (base)
function calcReducao(ciclos: CicloKPI[], campo: keyof CicloKPI): number | null {
  if (ciclos.length < 2) return null
  const base  = ciclos[ciclos.length - 1][campo] as number
  const atual = ciclos[0][campo] as number
  if (base === 0) return null
  return ((base - atual) / base) * 100
}

function renderReducao(pct: number | null) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>
  const abs = Math.abs(pct).toFixed(1)
  return pct >= 0
    ? <span className="text-green-600 text-xs font-medium">▼ {abs}%</span>
    : <span className="text-red-500 text-xs font-medium">▲ {abs}%</span>
}

function fmt(n: number | undefined | null, decimals = 1): string {
  if (n == null) return '—'
  return Number(n).toFixed(decimals)
}

// ─── KpiCard ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  titulo: string
  valor: string
  unidade: string
  meta: number
  metaLabel: React.ReactNode
  progresso: number          // 0-100, relativo à meta
  trend?: number[]           // valores para sparkline (ordem cronológica: mais antigo → mais recente)
  reducao?: number | null    // % de redução entre ciclo mais antigo e mais recente
  detalhe?: string           // linha contextual abaixo do valor principal
}

function KpiCard({ titulo, valor, unidade, meta, metaLabel, progresso, trend, reducao, detalhe }: KpiCardProps) {
  const sparkData = trend?.map((v, i) => ({ i, v })) ?? []
  const clampedPct = Math.min(100, Math.max(0, progresso))

  return (
    <div className="rounded-lg border bg-white p-3 flex flex-col gap-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] text-muted-foreground leading-tight">{titulo}</p>
        {reducao !== undefined && <div className="shrink-0">{renderReducao(reducao)}</div>}
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-end gap-1">
          <span className="text-2xl font-bold leading-none">{valor}</span>
          <span className="text-xs text-muted-foreground mb-0.5">{unidade}</span>
        </div>
        {detalhe && (
          <span className="text-[10px] text-muted-foreground">{detalhe}</span>
        )}
      </div>

      <Progress value={clampedPct} className="h-1.5" />

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{metaLabel}</span>
        {sparkData.length >= 2 && (
          <ResponsiveContainer width={80} height={28}>
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#6366f1"
                fill="#e0e7ff"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ─── CdCard ──────────────────────────────────────────────────────────────────
function CdCard({ cd }: { cd: SpResultadosCD }) {
  const ciclos = cd.ciclos
  const atual  = ciclos[0] ?? null

  // Sparkline: reverter para ordem cronológica (mais antigo → mais recente)
  const sparkBase = [...ciclos].reverse()

  return (
    <div className="rounded-lg border bg-white p-4 flex flex-col gap-3 shadow-sm">
      <div>
        <p className="text-sm font-semibold leading-tight">{cd.cd_nome}</p>
        <p className="text-[11px] text-muted-foreground">{cd.filial_nome}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {ciclos.length} ciclo{ciclos.length !== 1 ? 's' : ''} disponível{ciclos.length !== 1 ? 'is' : ''}
        </p>
      </div>

      {!atual ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {/* KPI 1 — SKUs calibrados */}
          <KpiCard
            titulo="SKUs calibrados (%)"
            valor={fmt(atual.pct_calibrados)}
            unidade="%"
            meta={METAS.pct_calibrados}
            metaLabel={`Meta: >${METAS.pct_calibrados}%`}
            progresso={(atual.pct_calibrados / METAS.pct_calibrados) * 100}
            trend={sparkBase.map(c => c.pct_calibrados)}
          />

          {/* KPI 2 — Ofensores A/B */}
          <KpiCard
            titulo="Ofensores falta (Curva A/B)"
            valor={String(atual.ofensores_falta_ab)}
            unidade="produtos"
            meta={METAS.reducao_ofensores_ab}
            metaLabel={`Meta: redução ≥${METAS.reducao_ofensores_ab}%`}
            progresso={(() => {
              const r = calcReducao(ciclos, 'ofensores_falta_ab')
              return r !== null ? Math.min(100, (r / METAS.reducao_ofensores_ab) * 100) : 0
            })()}
            trend={sparkBase.map(c => c.ofensores_falta_ab)}
            reducao={calcReducao(ciclos, 'ofensores_falta_ab')}
            detalhe={`de ${atual.total_enderecos} endereços no ciclo`}
          />

          {/* KPI 3 — Caixas ociosas */}
          <KpiCard
            titulo="Caixas ociosas realocadas (%)"
            valor={fmt(atual.pct_realocado)}
            unidade="%"
            meta={METAS.pct_realocado}
            metaLabel={`Meta: ≥${METAS.pct_realocado}%`}
            progresso={(atual.pct_realocado / METAS.pct_realocado) * 100}
            trend={sparkBase.map(c => c.pct_realocado)}
            detalhe={atual.caixas_ociosas > 0 ? `${atual.caixas_aprovadas} de ${atual.caixas_ociosas} cx ociosas aprovadas` : undefined}
          />

          {/* KPI 4 — Reposições emergenciais */}
          <KpiCard
            titulo="Acessos emergenciais (90d)"
            valor={String(atual.acessos_emergencia)}
            unidade="acessos"
            meta={METAS.reducao_acessos_emergencia}
            metaLabel={`Meta: redução ≥${METAS.reducao_acessos_emergencia}%`}
            progresso={(() => {
              const r = calcReducao(ciclos, 'acessos_emergencia')
              return r !== null ? Math.min(100, (r / METAS.reducao_acessos_emergencia) * 100) : 0
            })()}
            trend={sparkBase.map(c => c.acessos_emergencia)}
            reducao={calcReducao(ciclos, 'acessos_emergencia')}
          />

          {/* KPI 5 — Acessos picking total */}
          <KpiCard
            titulo="Acessos picking total (90d)"
            valor={String(atual.acessos_total)}
            unidade="acessos"
            meta={METAS.reducao_acessos_total}
            metaLabel={`Meta: redução ≥${METAS.reducao_acessos_total}%`}
            progresso={(() => {
              const r = calcReducao(ciclos, 'acessos_total')
              return r !== null ? Math.min(100, (r / METAS.reducao_acessos_total) * 100) : 0
            })()}
            trend={sparkBase.map(c => c.acessos_total)}
            reducao={calcReducao(ciclos, 'acessos_total')}
          />
        </div>
      )}
    </div>
  )
}

// ─── Gráfico histórico ────────────────────────────────────────────────────────

function HistoricoChart({ cdID, token }: { cdID: string; token: string }) {
  const [pontos, setPontos] = useState<HistoricoKPI[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/sp/resultados/historico?cd_id=${cdID}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setPontos(d.pontos ?? []))
      .catch(() => setPontos([]))
      .finally(() => setLoading(false))
  }, [cdID, token])

  if (loading) return <p className="text-xs text-muted-foreground py-4">Carregando histórico...</p>
  if (pontos.length < 2) return (
    <p className="text-xs text-muted-foreground py-4">
      Histórico indisponível — importe ao menos 2 arquivos para este CD.
    </p>
  )

  const chartData = pontos.map(p => ({
    data: p.criado_em.substring(0, 10),
    calibrados: p.calibrados_ok,
    falta:  p.ofensores_falta,
    espaco: p.ofensores_espaco,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="data" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 11 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="calibrados" stroke="#22c55e" name="SKUs Calibrados"     strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="falta"       stroke="#ef4444" name="Ofensores Falta"    strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="espaco"      stroke="#eab308" name="Ofensores Espaço"   strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function SpResultados() {
  const { token } = useAuth()
  const [data,    setData]    = useState<SpResultadosResponse | null>(null)
  const [cdID,    setCdID]    = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    const url = cdID ? `/api/sp/resultados?cd_id=${cdID}` : '/api/sp/resultados'
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error(`Erro ${r.status}`)
        return r.json() as Promise<SpResultadosResponse>
      })
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [token, cdID])

  const emp   = data?.empresa ?? null
  const cds   = data?.cds ?? []
  const cdOpts = data?.cds ?? []

  const selectedCd = cdID ? cds.find(c => String(c.cd_id) === cdID) : null

  return (
    <div className="flex flex-col gap-6">

      {/* ── Cabeçalho + filtro ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-semibold">Painel de Resultados</h1>
        </div>
        <select
          value={cdID}
          onChange={e => setCdID(e.target.value)}
          className="text-xs border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todos os CDs</option>
          {cdOpts.map(cd => (
            <option key={cd.cd_id} value={String(cd.cd_id)}>
              {cd.filial_nome} — {cd.cd_nome}
            </option>
          ))}
        </select>
      </div>

      {/* ── Estado de loading / erro ──────────────────────────────────── */}
      {loading && (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      )}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* ── Sem dados ─────────────────────────────────────────────────── */}
      {!loading && !error && (!data || (cds.length === 0 && !emp)) && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum dado disponível. Importe e processe um CSV para ver os resultados.
          </p>
        </div>
      )}

      {/* ── Empresa Consolidada (apenas quando "Todos os CDs") ────────── */}
      {!loading && !cdID && emp && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Empresa Consolidada
          </h2>
          {/* KPIs de % e absolutos — sem % de redução (bases distintas por CD, AC 12) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiCard
              titulo="SKUs calibrados (%)"
              valor={fmt(emp.pct_calibrados)}
              unidade="%"
              meta={METAS.pct_calibrados}
              metaLabel={`Meta: >${METAS.pct_calibrados}%`}
              progresso={(emp.pct_calibrados / METAS.pct_calibrados) * 100}
            />
            <KpiCard
              titulo="Ofensores falta (A/B)"
              valor={String(emp.ofensores_falta_ab)}
              unidade="produtos"
              meta={METAS.reducao_ofensores_ab}
              metaLabel={<span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded cursor-pointer hover:bg-indigo-100 transition-colors">Entender melhor</span>}
              progresso={0}
              detalhe={`de ${emp.total_enderecos} endereços no ciclo`}
            />
            <KpiCard
              titulo="Caixas ociosas realocadas (%)"
              valor={fmt(emp.pct_realocado)}
              unidade="%"
              meta={METAS.pct_realocado}
              metaLabel={`Meta: ≥${METAS.pct_realocado}%`}
              progresso={(emp.pct_realocado / METAS.pct_realocado) * 100}
              detalhe={emp.caixas_ociosas > 0 ? `${emp.caixas_aprovadas} de ${emp.caixas_ociosas} cx ociosas aprovadas` : undefined}
            />
            <KpiCard
              titulo="Acessos emergenciais (90d)"
              valor={String(emp.acessos_emergencia)}
              unidade="acessos"
              meta={METAS.reducao_acessos_emergencia}
              metaLabel={<span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded cursor-pointer hover:bg-indigo-100 transition-colors">Entender melhor</span>}
              progresso={0}
            />
            <KpiCard
              titulo="Acessos picking total (90d)"
              valor={String(emp.acessos_total)}
              unidade="acessos"
              meta={METAS.reducao_acessos_total}
              metaLabel={<span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded cursor-pointer hover:bg-indigo-100 transition-colors">Entender melhor</span>}
              progresso={0}
            />
          </div>
        </section>
      )}

      {/* ── Breakdown por CD ──────────────────────────────────────────── */}
      {!loading && (
        <section>
          {!cdID && (
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Por Centro de Distribuição
            </h2>
          )}

          {/* Filtro por CD selecionado: exibe só aquele */}
          {selectedCd ? (
            <div className="max-w-sm">
              <CdCard cd={selectedCd} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cds.map(cd => (
                <CdCard key={cd.cd_id} cd={cd} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Evolução histórica (apenas com CD selecionado) ────────────── */}
      {!loading && cdID && token && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Evolução Histórica
          </h2>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <HistoricoChart cdID={cdID} token={token} />
          </div>
        </section>
      )}
    </div>
  )
}
