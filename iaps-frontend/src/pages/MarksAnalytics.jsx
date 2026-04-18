import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  RadialLinearScale, Filler, Tooltip, Legend,
} from 'chart.js';
import { Bar, Line, Radar } from 'react-chartjs-2';
import { marksAPI, semesterAPI } from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import SemesterSubnav from '../components/SemesterSubnav';
import '../styles/Classroom.css';
import { BarChart2, TrendingUp, Activity } from 'lucide-react';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  RadialLinearScale, Filler, Tooltip, Legend,
);

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  '#667eea', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
];

const COL_STACK = { display: 'flex', flexDirection: 'column', gap: '24px' };

// ── Pure helpers ──────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score == null) return '#9ca3af';
  if (score >= 80)   return '#10b981';
  if (score >= 60)   return '#f59e0b';
  return '#ef4444';
}

/** Chart.js options shared by Bar and Line charts. */
function xyOptions(isDark, { legendVisible = true } = {}) {
  const text = isDark ? '#9ca3af' : '#6b7280';
  const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legendVisible, labels: { color: text, font: { size: 12 } } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { ticks: { color: text }, grid: { color: grid } },
      y: {
        min: 0, max: 100,
        ticks: { color: text },
        grid: { color: grid },
        title: { display: true, text: 'Score (%)', color: text, font: { size: 11 } },
      },
    },
  };
}

function radarOptions(isDark) {
  const text = isDark ? '#9ca3af' : '#6b7280';
  const grid = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: {} },
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { stepSize: 20, color: text, backdropColor: 'transparent', font: { size: 10 } },
        grid: { color: grid },
        pointLabels: { color: text, font: { size: 11 } },
        angleLines: { color: grid },
      },
    },
  };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MarksAnalytics({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [semester, setSemester]   = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [semData, setSemData]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [activeTab, setActiveTab] = useState('semester');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [semRes, trendRes, analyticsRes] = await Promise.allSettled([
        semesterAPI.getDetail(semesterId),
        marksAPI.getTrend(classroomId),
        marksAPI.getSemesterAnalytics(semesterId),
      ]);

      if (semRes.status      === 'fulfilled') setSemester(semRes.value.data.semester);
      if (trendRes.status    === 'fulfilled') setTrendData(trendRes.value.data);
      if (analyticsRes.status === 'fulfilled') setSemData(analyticsRes.value.data);

      const label = (r, name) =>
        r.status === 'rejected'
          ? `${name} (${r.reason?.response?.status ?? r.reason?.message})`
          : null;

      const failures = [
        label(semRes, 'semester'),
        label(trendRes, 'trend'),
        label(analyticsRes, 'analytics'),
      ].filter(Boolean);

      if (failures.length) {
        console.error('Analytics load failures:', failures);
        setError(`Failed to load: ${failures.join(', ')}`);
      }
      setLoading(false);
    };
    load();
  }, [classroomId, semesterId]);

  // ── Memoised chart data ───────────────────────────────────────────────────

  // Bar chart: subjects with a score, coloured by original index
  const barData = useMemo(() => {
    if (!semData?.subjects.length) return null;
    const withScores = semData.subjects
      .map((s, i) => ({ ...s, origIdx: i }))
      .filter(s => s.score != null);
    if (!withScores.length) return null;
    return {
      labels: withScores.map(s => s.name),
      datasets: [{
        label: 'Weighted Score (%)',
        data: withScores.map(s => s.score),
        backgroundColor: withScores.map(s => PALETTE[s.origIdx % PALETTE.length] + 'cc'),
        borderColor:      withScores.map(s => PALETTE[s.origIdx % PALETTE.length]),
        borderWidth: 2,
        borderRadius: 6,
      }],
    };
  }, [semData]);

  // Radar chart: needs ≥ 3 subjects with scores
  const radarData = useMemo(() => {
    if (!semData?.subjects.length) return null;
    const withScores = semData.subjects.filter(s => s.score != null);
    if (withScores.length < 3) return null;
    return {
      labels: withScores.map(s => s.name),
      datasets: [{
        label: 'Score (%)',
        data: withScores.map(s => s.score),
        backgroundColor: '#667eea33',
        borderColor: '#667eea',
        borderWidth: 2,
        pointBackgroundColor: withScores.map(s => scoreColor(s.score)),
        pointRadius: 5,
      }],
    };
  }, [semData]);

  // Line chart: one point per semester (overall average)
  const lineData = useMemo(() => {
    if (!trendData?.semesters.length) return null;
    return {
      labels: trendData.semesters.map(s => s.semester_name),
      datasets: [{
        label: 'Overall Score (%)',
        data: trendData.semesters.map(s => s.overall_score),
        borderColor: '#667eea',
        backgroundColor: '#667eea22',
        pointBackgroundColor: trendData.semesters.map(s => scoreColor(s.overall_score)),
        pointRadius: 6,
        borderWidth: 2.5,
        tension: 0.35,
        spanGaps: true,
      }],
    };
  }, [trendData]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="classroom-container">
        <p style={{ color: 'var(--text-secondary)' }}>Loading analytics…</p>
      </div>
    );
  }

  const subjects = semData?.subjects ?? [];
  const hasScores = subjects.some(s => s.score != null);
  const scoredCount = subjects.filter(s => s.score != null).length;
  const hasTrend = trendData?.semesters.some(s => s.overall_score != null);

  return (
    <div className="classroom-container">
      {/* Header */}
      <div style={{ marginBottom: '4px' }}>
        <button
          onClick={() => navigate(`/classroom/${classroomId}`)}
          style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0 }}
        >
          &larr; Back to Classroom
        </button>
        <h1 style={{ margin: 0 }}>{semester?.name ?? 'Analytics'}</h1>
        {semester && (
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: '14px' }}>
            {semester.type} · {semester.year}{semester.session && ` · ${semester.session}`}
          </p>
        )}
      </div>

      <SemesterSubnav active="analytics" classroomId={classroomId} semesterId={semesterId} />

      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px',
          padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626',
        }}>
          {error} — check browser console for details.
        </div>
      )}

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', marginTop: '8px' }}>
        {[
          { key: 'semester', label: 'This Semester', Icon: BarChart2 },
          { key: 'trend',    label: 'Trend Over Semesters', Icon: TrendingUp },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', border: 'none', transition: 'all 0.15s',
              background: activeTab === key ? '#667eea' : 'var(--card-bg)',
              color:      activeTab === key ? 'white'   : 'var(--text-secondary)',
              boxShadow:  activeTab === key ? '0 2px 8px #667eea44' : 'none',
            }}
          >
            <Icon size={15} strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {/* ── This Semester tab ── */}
      {activeTab === 'semester' && (
        !hasScores
          ? <EmptyState message="No marks entered for this semester yet." />
          : (
            <div style={COL_STACK}>
              {/* Score cards — one per subject, colour by original index */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {subjects.map((s, i) => (
                  <ScoreCard key={s.subject_id} subject={s} color={PALETTE[i % PALETTE.length]} />
                ))}
              </div>

              {/* Bar chart */}
              {barData && (
                <ChartCard title="Score per Subject (Weighted %)" Icon={BarChart2}>
                  <div style={{ height: '280px' }}>
                    <Bar data={barData} options={xyOptions(isDark, { legendVisible: false })} />
                  </div>
                </ChartCard>
              )}

              {/* Radar — only when ≥ 3 subjects have scores */}
              {radarData
                ? (
                  <ChartCard title="Subject Radar — Semester Overview" Icon={Activity}>
                    <div style={{ height: '320px', maxWidth: '480px', margin: '0 auto' }}>
                      <Radar data={radarData} options={radarOptions(isDark)} />
                    </div>
                  </ChartCard>
                )
                : scoredCount > 0 && scoredCount < 3 && (
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Radar chart requires at least 3 subjects with marks entered.
                  </p>
                )
              }

              {/* Per-subject exam breakdown — preserves original palette index */}
              {subjects.map((s, i) =>
                s.entries?.length > 0 && (
                  <ChartCard key={s.subject_id} title={`${s.name} — Exam Breakdown`}>
                    <ExamBreakdown entries={s.entries} color={PALETTE[i % PALETTE.length]} isDark={isDark} />
                  </ChartCard>
                )
              )}
            </div>
          )
      )}

      {/* ── Trend tab ── */}
      {activeTab === 'trend' && (
        !hasTrend
          ? <EmptyState message="Enter marks in at least one semester to see your performance trend." />
          : (
            <div style={COL_STACK}>
              {/* Overall trend line */}
              <ChartCard title="Overall Score Trend Across Semesters" Icon={TrendingUp}>
                <div style={{ height: '300px' }}>
                  <Line data={lineData} options={xyOptions(isDark)} />
                </div>
              </ChartCard>

              {/* Per-semester subject breakdown */}
              <ChartCard title="Per-Semester Subject Breakdown">
                <div style={COL_STACK}>
                  {trendData.semesters.map(sem => (
                    <SemesterBreakdown key={sem.semester_id} sem={sem} />
                  ))}
                </div>
              </ChartCard>
            </div>
          )
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartCard({ title, Icon, children }) {
  return (
    <div style={{
      background: 'var(--card-bg)', borderRadius: '14px',
      border: '1px solid var(--border-color)', padding: '20px 24px',
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        {Icon && <Icon size={16} strokeWidth={2} style={{ color: '#667eea' }} />}
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function ScoreCard({ subject, color }) {
  const { name, score, grade } = subject;
  return (
    <div style={{
      background: 'var(--card-bg)', borderRadius: '12px',
      border: `2px solid ${color}33`, padding: '14px 18px',
      minWidth: '130px', flex: '1 1 130px', maxWidth: '180px',
    }}>
      <div style={{
        fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {name}
      </div>
      <div style={{ fontSize: '26px', fontWeight: 800, color: scoreColor(score) }}>
        {score != null ? `${score}%` : '—'}
      </div>
      {grade && (
        <div style={{ marginTop: '4px', fontSize: '12px', fontWeight: 600, color }}>
          Grade: {grade}
        </div>
      )}
    </div>
  );
}

/** Bar chart for one subject's exam entries. Receives entries + colour. */
function ExamBreakdown({ entries, color, isDark }) {
  const opts = xyOptions(isDark, { legendVisible: false });
  // Merge custom tooltip into base options — spread preserves mode/intersect
  const options = {
    ...opts,
    plugins: {
      ...opts.plugins,
      tooltip: {
        ...opts.plugins.tooltip,           // keeps mode:'index', intersect:false
        callbacks: {
          label: (ctx) => {
            const e = entries[ctx.dataIndex];
            return ` ${e.marks_obtained} / ${e.max_marks}  (${ctx.raw}%)`;
          },
        },
      },
    },
  };

  const data = {
    labels: entries.map(e => e.name),
    datasets: [{
      label: 'Score (%)',
      data: entries.map(e =>
        e.max_marks > 0 ? Math.round((e.marks_obtained / e.max_marks) * 100) : 0
      ),
      backgroundColor: color + 'bb',
      borderColor: color,
      borderWidth: 2,
      borderRadius: 5,
    }],
  };

  return (
    <div style={{ height: '200px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

// Table cell styles — defined once at module level, not recreated per render
const SEM_H_STYLE = {
  padding: '7px 12px', fontSize: '11px', fontWeight: 700,
  color: 'var(--text-secondary)', textTransform: 'uppercase',
  letterSpacing: '0.04em', borderBottom: '2px solid var(--border-color)',
  textAlign: 'left',
};
const SEM_C_STYLE = {
  padding: '7px 12px', fontSize: '13px',
  borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)',
};

/** One section per semester inside the trend tab. */
function SemesterBreakdown({ sem }) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '8px',
      }}>
        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
          {sem.semester_name}
        </span>
        {/* overall_score is null iff no subject has a valid score */}
        <span style={{ fontSize: '13px', fontWeight: 700, color: scoreColor(sem.overall_score) }}>
          {sem.overall_score != null ? `Avg: ${sem.overall_score}%` : 'No marks yet'}
        </span>
      </div>

      {sem.subjects.length === 0
        ? <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 12px' }}>No subjects added.</p>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '16px' }}>
            <thead>
              <tr>
                <th style={SEM_H_STYLE}>Subject</th>
                <th style={{ ...SEM_H_STYLE, textAlign: 'center' }}>Score</th>
                <th style={{ ...SEM_H_STYLE, textAlign: 'center' }}>Grade</th>
              </tr>
            </thead>
            <tbody>
              {sem.subjects.map((s, idx) => (
                <tr key={idx}>
                  <td style={{ ...SEM_C_STYLE, fontWeight: 600 }}>{s.name}</td>
                  <td style={{ ...SEM_C_STYLE, textAlign: 'center', fontWeight: 700, color: scoreColor(s.score) }}>
                    {s.score != null ? `${s.score}%` : '—'}
                  </td>
                  <td style={{ ...SEM_C_STYLE, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {s.grade || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
      <BarChart2 size={40} strokeWidth={1.25} style={{ opacity: 0.25, marginBottom: '12px' }} />
      <p style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>No data yet</p>
      <p style={{ margin: '6px 0 0', fontSize: '13px', opacity: 0.7 }}>{message}</p>
    </div>
  );
}
