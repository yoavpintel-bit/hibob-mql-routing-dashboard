/* global React, Chart */
const { useState, useEffect, useMemo, useRef } = React;

const DATA_URL = 'data/mql_drilldown/report.json';
const CSV_URL = 'data/mql_drilldown/report.csv';
const PAGE_SIZE = 50;

const EE_SEGMENT_LABELS = {
  under_20: 'Under 20',
  '20_49': '20 – 49',
  '50_99': '50 – 99',
  '100_199': '100 – 199',
  '200_499': '200 – 499',
  '500_8000': '500 – 8,000',
  over_8000: 'Over 8,000',
  missing: 'Missing',
};

const STATUS_STYLES = {
  'Meeting Scheduled': 'bg-emerald-100 text-emerald-900 border-emerald-200',
  'Meeting Not Scheduled': 'bg-amber-100 text-amber-900 border-amber-200',
  Disqualified: 'bg-slate-100 text-slate-800 border-slate-200',
  Cancelled: 'bg-rose-100 text-rose-900 border-rose-200',
  'Scheduling Meeting': 'bg-sky-100 text-sky-900 border-sky-200',
  'No CP log (not Concierge and not Distro)': 'bg-stone-100 text-stone-600 border-stone-200',
  'No Concierge log in exports': 'bg-stone-100 text-stone-600 border-stone-200',
};

const TAG_STYLES = {
  Concierge: 'bg-sky-100 text-sky-900 border-sky-200',
  Distro: 'bg-violet-100 text-violet-900 border-violet-200',
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
}

function statusLabel(row) {
  if (row.inConciergeLogs) return row.latestStatus || 'Unknown';
  if (row.inDistroLogs) {
    return row.latestStatus?.startsWith('Distro')
      ? row.latestStatus
      : `Distro · ${row.distroStatus || 'Assigned'}`;
  }
  return 'No CP log (not Concierge and not Distro)';
}

function TagBadges({ tags }) {
  if (!tags?.length) return <span className="text-xs text-[#5A5755]">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            TAG_STYLES[t] || 'bg-stone-100 text-stone-700 border-stone-200'
          }`}
        >
          {t}
        </span>
      ))}
    </span>
  );
}

function sfYesNo(v) {
  return v === '1' || v === 1 ? 'Yes' : 'No';
}

function eeLabel(segment) {
  return EE_SEGMENT_LABELS[segment] || segment || 'Missing';
}

function formatEmployees(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString() : '—';
}

function geoDisplay(value) {
  const v = String(value || '').trim();
  return v && v !== 'null' ? v : '—';
}

function SortableHeader({ label, column, sortKey, sortDir, onSort, className }) {
  const active = sortKey === column;
  return (
    <th
      className={`px-3 py-3 cursor-pointer select-none hover:text-[#E2004F] ${className || ''}`}
      onClick={() => onSort(column)}
      title="Click to sort"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="font-normal text-[#E2004F]">
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  );
}

function compareRows(a, b, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  if (key === 'numberOfEmployees') {
    const na = a.numberOfEmployees;
    const nb = b.numberOfEmployees;
    const aMissing = na == null || na === '';
    const bMissing = nb == null || nb === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return (Number(na) - Number(nb)) * mul;
  }
  if (key === 'employeeMicroSegment') {
    const la = eeLabel(a.employeeMicroSegment);
    const lb = eeLabel(b.employeeMicroSegment);
    return la.localeCompare(lb) * mul;
  }
  if (key === 'latestDate') {
    const ta = a.latestDate ? new Date(a.latestDate).getTime() : 0;
    const tb = b.latestDate ? new Date(b.latestDate).getTime() : 0;
    return (ta - tb) * mul;
  }
  if (key === 'cpStatus') {
    return statusLabel(a).localeCompare(statusLabel(b)) * mul;
  }
  let va = a[key];
  let vb = b[key];
  if (key === 'contactName') {
    va = a.contactName || a.email;
    vb = b.contactName || b.email;
  }
  const sa = String(va ?? '').toLowerCase();
  const sb = String(vb ?? '').toLowerCase();
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  return sa.localeCompare(sb) * mul;
}

const KPI_DEFS = {
  cohort: {
    calculation:
      'Count of unique contact emails in the Salesforce MQL drilldown export (one row per MQL in the cohort).',
    business:
      'The full population Marketing & Sales asked to review — every MQL in scope for this analysis, regardless of Chili Piper activity.',
  },
  in_concierge: {
    calculation:
      'Contacts with at least one Concierge routing log in the exported window (MQL Inbound main router), matched by guest email.',
    business:
      'Leads that actually entered the inbound Chili Piper routing flow. Use this to see who was touched by Concierge vs. who never appeared in logs.',
  },
  meeting_scheduled: {
    calculation:
      'Contacts whose latest Concierge log status is "Meeting Scheduled" (most recent routing event per email).',
    business:
      'Prospects who completed scheduling in Chili Piper. Sales should expect a booked meeting; compare to SF "Meetings" for sync gaps.',
  },
  not_scheduled: {
    calculation:
      'Contacts whose latest Concierge status is "Meeting Not Scheduled" — routed and eligible but did not book on last touch.',
    business:
      'Qualified inbound interest that did not convert to a calendar booking (abandon, timeout, or left scheduling flow). Prime follow-up queue.',
  },
  catch_all: {
    calculation:
      'Contacts whose latest matched routing rule is "Catch All" (no active segment rule matched on last evaluation).',
    business:
      'Scenario F routing gap: employee count, region, or other attributes did not match a live rule. Needs MOPS / routing rule review.',
  },
  no_trace: {
    calculation:
      'Cohort emails with no Concierge routing log and no Distro log match on account name (Search Fields in Distro export).',
    business:
      'True blind spots: no evidence in Concierge exports or Distro account-assignment logs. Investigate routing path, timing, or data gaps before outreach.',
  },
  distro_only: {
    calculation:
      'No Concierge log, but the lead\'s SF account name matches a Distro log entry (account-level Round Robin assignment from CP support export).',
    business:
      'Silent Distro path: account was assigned via backend Distro without an inbound Concierge form event. Rep may have received the account via ownership change, not a booked meeting.',
  },
};

function InfoTip({ calculation, business }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span className="relative inline-flex shrink-0" ref={ref}>
      <button
        type="button"
        aria-label="Metric definition"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[#EBE5D9] bg-[#FFFDF9] text-[10px] font-bold leading-none text-[#5A5755] hover:border-[#E2004F] hover:text-[#E2004F]"
      >
        i
      </button>
      {open ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-[#EBE5D9] bg-white p-3 text-left shadow-lg normal-case"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-bold text-[#222121]">How it&apos;s calculated</p>
          <p className="mt-1 text-xs leading-relaxed text-[#5A5755]">{calculation}</p>
          <p className="mt-2 text-xs font-bold text-[#222121]">Business meaning</p>
          <p className="mt-1 text-xs leading-relaxed text-[#5A5755]">{business}</p>
        </div>
      ) : null}
    </span>
  );
}

function KpiCard({ kpiId, label, value, sub, accent, active, onToggle, info }) {
  const clickable = Boolean(onToggle);
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onToggle(kpiId) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle(kpiId);
              }
            }
          : undefined
      }
      className={`rounded-xl border bg-white p-4 text-left transition-colors print:pointer-events-none ${
        active
          ? 'border-[#E2004F] ring-2 ring-[#E2004F]/25'
          : accent
            ? 'border-[#E2004F]/30'
            : 'border-[#EBE5D9]'
      } ${clickable ? 'cursor-pointer hover:border-[#E2004F]/50 hover:bg-[#FFFDF9]' : ''}`}
      title={clickable ? 'Click to filter the table · click again to clear' : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#5A5755]">{label}</p>
        {info ? <InfoTip calculation={info.calculation} business={info.business} /> : null}
      </div>
      <p
        className={`mt-1 text-3xl font-extrabold tabular-nums ${
          accent || active ? 'text-[#E2004F]' : 'text-[#222121]'
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-[#5A5755]">{sub}</p> : null}
      {active ? (
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[#E2004F]">
          Filtering table
        </p>
      ) : clickable ? (
        <p className="mt-2 text-[10px] text-[#5A5755] opacity-0 transition-opacity group-hover:opacity-100 print:hidden">
          Click to filter
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || 'bg-stone-100 text-stone-700 border-stone-200';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {status}
    </span>
  );
}

function chartSegmentClick(elements, onPick) {
  if (!elements?.length || !onPick) return;
  onPick(elements[0].index);
}

function DonutChart({ labels, values, colors, activeLabel, onPick }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!ref.current || typeof Chart === 'undefined') return;
    if (chartRef.current) chartRef.current.destroy();

    const bg = labels.map((label, i) => {
      const base = colors[i] || '#E2004F';
      if (!activeLabel || activeLabel === 'all') return base;
      return label === activeLabel ? base : base + '55';
    });

    chartRef.current = new Chart(ref.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: bg,
          borderWidth: labels.map((label) => (label === activeLabel ? 3 : 0)),
          borderColor: labels.map((label) =>
            label === activeLabel ? '#222121' : 'transparent'
          ),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
          chartSegmentClick(elements, (idx) => onPickRef.current?.(labels[idx]));
        },
        onHover: (evt, elements) => {
          const target = evt.native?.target;
          if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, font: { size: 11 } },
            onClick: (_evt, item) => {
              onPickRef.current?.(labels[item.index]);
            },
          },
          tooltip: {
            callbacks: {
              afterLabel: () => 'Click to filter table',
            },
          },
        },
      },
    });
    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [labels.join('|'), values.join('|'), colors.join('|'), activeLabel]);

  return (
    <div className="h-52">
      <canvas ref={ref} />
    </div>
  );
}

function BarChart({ labels, displayLabels, values, activeRule, onPick }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!ref.current || typeof Chart === 'undefined') return;
    if (chartRef.current) chartRef.current.destroy();

    const bg = labels.map((rule) =>
      !activeRule || activeRule === 'all'
        ? '#E2004F'
        : rule === activeRule
          ? '#E2004F'
          : '#E2004F44'
    );

    chartRef.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: displayLabels,
        datasets: [{
          data: values,
          backgroundColor: bg,
          borderRadius: 4,
          borderWidth: labels.map((rule) => (rule === activeRule ? 2 : 0)),
          borderColor: labels.map((rule) =>
            rule === activeRule ? '#222121' : 'transparent'
          ),
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
          chartSegmentClick(elements, (idx) => onPickRef.current?.(labels[idx]));
        },
        onHover: (evt, elements) => {
          const target = evt.native?.target;
          if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => labels[items[0]?.dataIndex] || '',
              afterLabel: () => 'Click to filter table',
            },
          },
        },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { font: { size: 10 } } },
        },
      },
    });
    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [labels.join('|'), displayLabels.join('|'), values.join('|'), activeRule]);

  return (
    <div className="h-64">
      <canvas ref={ref} />
    </div>
  );
}

function JourneyTimeline({ journey }) {
  if (!journey?.length) return <p className="text-sm text-[#5A5755]">No routing events in export.</p>;
  return (
    <ol className="space-y-2 border-l-2 border-[#E2004F]/30 pl-4">
      {journey.map((j, i) => (
        <li key={i} className="text-sm">
          <span className="font-mono text-xs text-[#5A5755]">{formatDate(j.date)}</span>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={j.status || 'Unknown'} />
            <span className="text-[#222121]">{j.rule || '—'}</span>
            {j.assignedTo ? (
              <span className="text-xs text-[#5A5755]">→ {j.assignedTo}</span>
            ) : null}
          </div>
          {j.source ? (
            <p className="mt-0.5 truncate text-xs text-[#5A5755]" title={j.source}>
              {j.source}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function MqlDrilldownDashboard() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ruleFilter, setRuleFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [onlyCatchAll, setOnlyCatchAll] = useState(false);
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [countryFilter, setCountryFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [eeFilter, setEeFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [sortKey, setSortKey] = useState('latestDate');
  const [sortDir, setSortDir] = useState('desc');
  const [activeKpi, setActiveKpi] = useState(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetch(DATA_URL, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('Could not load report (' + r.status + ')');
        return r.json();
      })
      .then(setPayload)
      .catch((e) => setError(e.message));
  }, []);

  const report = payload?.report || [];
  const summary = payload?.summary;

  const statuses = useMemo(() => {
    const s = new Set(report.map((r) => statusLabel(r)));
    return ['all', ...[...s].sort()];
  }, [report]);

  const rules = useMemo(() => {
    const s = new Set(
      report.map((r) => r.latestRule).filter(Boolean)
    );
    return ['all', ...[...s].sort((a, b) => a.localeCompare(b))];
  }, [report]);

  const owners = useMemo(() => {
    const s = new Set(report.map((r) => r.owner).filter(Boolean));
    return ['all', ...[...s].sort()];
  }, [report]);

  const countries = useMemo(() => {
    const counts = new Map();
    for (const r of report) {
      const c = geoDisplay(r.country);
      const k = c === '—' ? '(empty)' : c;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [
      'all',
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name),
    ];
  }, [report]);

  const states = useMemo(() => {
    const counts = new Map();
    for (const r of report) {
      const s = geoDisplay(r.state);
      const k = s === '—' ? '(empty)' : s;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [
      'all',
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name),
    ];
  }, [report]);

  const eeSegments = useMemo(() => {
    const counts = new Map();
    for (const r of report) {
      const seg = r.employeeMicroSegment || 'missing';
      counts.set(seg, (counts.get(seg) || 0) + 1);
    }
    return [
      'all',
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([seg]) => seg),
    ];
  }, [report]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return report.filter((r) => {
      const st = statusLabel(r);
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (ruleFilter !== 'all' && (r.latestRule || '') !== ruleFilter) return false;
      if (ownerFilter !== 'all' && (r.owner || '') !== ownerFilter) return false;
      if (countryFilter !== 'all') {
        const c = geoDisplay(r.country);
        const key = c === '—' ? '(empty)' : c;
        if (key !== countryFilter) return false;
      }
      if (stateFilter !== 'all') {
        const s = geoDisplay(r.state);
        const key = s === '—' ? '(empty)' : s;
        if (key !== stateFilter) return false;
      }
      if (eeFilter !== 'all' && (r.employeeMicroSegment || 'missing') !== eeFilter) {
        return false;
      }
      if (tagFilter !== 'all') {
        const tags = r.tags || [];
        if (tagFilter === 'Neither') {
          if (tags.length) return false;
        } else if (!tags.includes(tagFilter)) {
          return false;
        }
      }
      if (activeKpi === 'in_concierge' && !r.inConciergeLogs) return false;
      if (activeKpi === 'distro_only' && !(r.inDistroLogs && !r.inConciergeLogs)) return false;
      if (activeKpi === 'no_trace' && (r.inConciergeLogs || r.inDistroLogs)) return false;
      if (onlyCatchAll && r.latestRule !== 'Catch All') return false;
      if (onlyMismatch && !(r.latestStatus === 'Meeting Scheduled' && r.meetingsCol !== '1')) {
        return false;
      }
      if (!needle) return true;
      const blob = [
        r.email,
        r.contactName,
        r.accountName,
        r.owner,
        r.country,
        r.state,
        r.numberOfEmployees,
        eeLabel(r.employeeMicroSegment),
        r.latestRule,
        r.latestAssignedTo,
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [
    report,
    q,
    statusFilter,
    ruleFilter,
    ownerFilter,
    countryFilter,
    stateFilter,
    eeFilter,
    tagFilter,
    onlyCatchAll,
    onlyMismatch,
    activeKpi,
  ]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return rows;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (column) => {
    if (sortKey === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column);
      setSortDir(
        column === 'numberOfEmployees' || column === 'latestDate' ? 'desc' : 'asc'
      );
    }
  };

  useEffect(() => {
    setPage(0);
    setExpanded(null);
  }, [
    q,
    statusFilter,
    ruleFilter,
    ownerFilter,
    countryFilter,
    stateFilter,
    eeFilter,
    tagFilter,
    onlyCatchAll,
    onlyMismatch,
    activeKpi,
    sortKey,
    sortDir,
  ]);

  const clearChartFilters = () => {
    setStatusFilter('all');
    setRuleFilter('all');
    setActiveKpi(null);
  };

  const clearAllFilters = () => {
    clearChartFilters();
    setOwnerFilter('all');
    setCountryFilter('all');
    setStateFilter('all');
    setEeFilter('all');
    setTagFilter('all');
    setOnlyCatchAll(false);
    setOnlyMismatch(false);
    setQ('');
  };

  const toggleKpi = (id) => {
    if (id === 'cohort') {
      clearAllFilters();
      return;
    }
    if (activeKpi === id) {
      clearChartFilters();
      return;
    }
    setActiveKpi(id);
    setOnlyCatchAll(false);
    setOnlyMismatch(false);
    setStatusFilter('all');
    setRuleFilter('all');
    switch (id) {
      case 'meeting_scheduled':
        setStatusFilter('Meeting Scheduled');
        break;
      case 'not_scheduled':
        setStatusFilter('Meeting Not Scheduled');
        break;
      case 'catch_all':
        setRuleFilter('Catch All');
        break;
      case 'no_trace':
        setStatusFilter('No CP log (not Concierge and not Distro)');
        break;
      case 'distro_only':
        setStatusFilter('all');
        break;
      default:
        break;
    }
  };

  const kpiActive = (id) => {
    if (activeKpi === id) return true;
    if (id === 'meeting_scheduled' && statusFilter === 'Meeting Scheduled') return true;
    if (id === 'not_scheduled' && statusFilter === 'Meeting Not Scheduled') return true;
    if (id === 'catch_all' && ruleFilter === 'Catch All') return true;
    if (id === 'no_trace' && statusFilter === 'No CP log (not Concierge and not Distro)') return true;
    if (id === 'distro_only' && activeKpi === 'distro_only') return true;
    if (id === 'in_concierge' && activeKpi === 'in_concierge') return true;
    return false;
  };

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const chartStatus = useMemo(() => {
    if (!summary?.statusBreakdown) return { labels: [], values: [], colors: [] };
    const colors = {
      'Meeting Scheduled': '#10b981',
      'Meeting Not Scheduled': '#f59e0b',
      Disqualified: '#94a3b8',
      'No CP log (not Concierge and not Distro)': '#78716c',
      'Distro · Finished': '#8b5cf6',
      'No Concierge log in exports': '#d6d3d1',
      Cancelled: '#f43f5e',
      'Scheduling Meeting': '#0ea5e9',
    };
    const entries = Object.entries(summary.statusBreakdown).sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([k]) => k),
      values: entries.map(([, v]) => v),
      colors: entries.map(([k]) => colors[k] || '#E2004F'),
    };
  }, [summary]);

  const chartRules = useMemo(() => {
    if (!summary?.ruleBreakdown) return { labels: [], displayLabels: [], values: [] };
    const entries = Object.entries(summary.ruleBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return {
      labels: entries.map(([k]) => k),
      displayLabels: entries.map(([k]) => (k.length > 36 ? k.slice(0, 34) + '…' : k)),
      values: entries.map(([, v]) => v),
    };
  }, [summary]);

  const toggleStatusFromChart = (status) => {
    setActiveKpi(null);
    setStatusFilter((prev) => (prev === status ? 'all' : status));
  };

  const toggleRuleFromChart = (rule) => {
    setActiveKpi(null);
    setRuleFilter((prev) => (prev === rule ? 'all' : rule));
    if (rule === 'Catch All') setOnlyCatchAll(false);
  };

  const hasChartFilter =
    statusFilter !== 'all' || ruleFilter !== 'all' || activeKpi != null;

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-12 text-center">
        <h2 className="text-xl font-bold text-[#E2004F]">Dashboard failed to load</h2>
        <p className="mt-2 text-[#5A5755]">{error}</p>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[#5A5755]">
        Loading MQL cohort…
      </div>
    );
  }

  const catchAllCount = report.filter((r) => r.latestRule === 'Catch All').length;
  const mismatchCount = report.filter(
    (r) => r.latestStatus === 'Meeting Scheduled' && r.meetingsCol !== '1'
  ).length;

  return (
    <div className="min-h-screen bg-[#FFFDF9] print:bg-white">
      <header className="border-b border-[#EBE5D9] bg-white print:border-stone-300">
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#E2004F]">
                HiBob RevOps · Chili Piper
              </p>
              <h1 className="mt-1 text-2xl font-extrabold text-[#222121] sm:text-3xl">
                MQL Cohort — Routing &amp; Meeting Intelligence
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-[#5A5755]">
                {summary.targetEmails} MQL contacts matched to Concierge exports and Distro logs
                (account name). Click KPI cards or charts to filter; expand rows for journey.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <a
                href={CSV_URL}
                download
                className="rounded-lg border border-[#EBE5D9] bg-white px-4 py-2 text-sm font-semibold text-[#222121] hover:bg-[#FFFDF9]"
              >
                Download CSV
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-[#E2004F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c40044]"
              >
                Print / PDF
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 print:hidden">
          <KpiCard
            kpiId="cohort"
            label="MQL contacts"
            value={summary.targetEmails}
            sub="Cohort size · click to show all"
            active={!hasChartFilter && !q.trim()}
            onToggle={toggleKpi}
            info={KPI_DEFS.cohort}
          />
          <KpiCard
            kpiId="in_concierge"
            label="In Concierge logs"
            value={summary.foundInConciergeExports}
            sub={`${Math.round((summary.foundInConciergeExports / summary.targetEmails) * 100)}% of cohort`}
            active={kpiActive('in_concierge')}
            onToggle={toggleKpi}
            info={KPI_DEFS.in_concierge}
          />
          <KpiCard
            kpiId="meeting_scheduled"
            label="Meeting scheduled (CP)"
            value={summary.statusBreakdown['Meeting Scheduled'] || 0}
            sub="Latest Concierge status"
            accent
            active={kpiActive('meeting_scheduled')}
            onToggle={toggleKpi}
            info={KPI_DEFS.meeting_scheduled}
          />
          <KpiCard
            kpiId="not_scheduled"
            label="Not scheduled (CP)"
            value={summary.statusBreakdown['Meeting Not Scheduled'] || 0}
            active={kpiActive('not_scheduled')}
            onToggle={toggleKpi}
            info={KPI_DEFS.not_scheduled}
          />
          <KpiCard
            kpiId="catch_all"
            label="Catch All"
            value={catchAllCount}
            sub="No segment rule matched"
            accent
            active={kpiActive('catch_all')}
            onToggle={toggleKpi}
            info={KPI_DEFS.catch_all}
          />
          <KpiCard
            kpiId="distro_only"
            label="Distro only"
            value={summary.distroOnly ?? 0}
            sub="Account assigned via Distro"
            accent
            active={kpiActive('distro_only')}
            onToggle={toggleKpi}
            info={KPI_DEFS.distro_only}
          />
          <KpiCard
            kpiId="no_trace"
            label="No trace"
            value={summary.noTrace ?? 0}
            sub="Not Concierge & not Distro"
            active={kpiActive('no_trace')}
            onToggle={toggleKpi}
            info={KPI_DEFS.no_trace}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2 print:hidden">
          <div
            className={`rounded-xl border bg-white p-4 ${
              statusFilter !== 'all' ? 'border-[#E2004F] ring-1 ring-[#E2004F]/20' : 'border-[#EBE5D9]'
            }`}
          >
            <h2 className="text-sm font-bold text-[#222121]">Concierge status (latest touch)</h2>
            <p className="text-xs text-[#5A5755]">
              Click a slice or legend item to filter the table
              {statusFilter !== 'all' ? (
                <span className="ml-1 font-semibold text-[#E2004F]">· {statusFilter}</span>
              ) : null}
            </p>
            <DonutChart
              {...chartStatus}
              activeLabel={statusFilter}
              onPick={toggleStatusFromChart}
            />
          </div>
          <div
            className={`rounded-xl border bg-white p-4 ${
              ruleFilter !== 'all' ? 'border-[#E2004F] ring-1 ring-[#E2004F]/20' : 'border-[#EBE5D9]'
            }`}
          >
            <h2 className="text-sm font-bold text-[#222121]">Top routing rules matched</h2>
            <p className="text-xs text-[#5A5755]">
              Click a bar to filter the table
              {ruleFilter !== 'all' ? (
                <span className="ml-1 font-semibold text-[#E2004F]">· {ruleFilter}</span>
              ) : null}
            </p>
            <BarChart
              {...chartRules}
              activeRule={ruleFilter}
              onPick={toggleRuleFromChart}
            />
          </div>
        </section>

        {hasChartFilter ? (
          <section className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-xs font-semibold uppercase text-[#5A5755]">Active filters:</span>
            {activeKpi === 'in_concierge' ? (
              <button
                type="button"
                onClick={() => toggleKpi('in_concierge')}
                className="rounded-full border border-[#E2004F]/40 bg-[#E2004F]/10 px-3 py-1 text-xs font-semibold text-[#E2004F]"
              >
                KPI: In Concierge logs ×
              </button>
            ) : null}
            {activeKpi === 'distro_only' ? (
              <button
                type="button"
                onClick={() => toggleKpi('distro_only')}
                className="rounded-full border border-[#E2004F]/40 bg-[#E2004F]/10 px-3 py-1 text-xs font-semibold text-[#E2004F]"
              >
                KPI: Distro only ×
              </button>
            ) : null}
            {activeKpi === 'no_trace' ? (
              <button
                type="button"
                onClick={() => toggleKpi('no_trace')}
                className="rounded-full border border-[#E2004F]/40 bg-[#E2004F]/10 px-3 py-1 text-xs font-semibold text-[#E2004F]"
              >
                KPI: No trace ×
              </button>
            ) : null}
            {statusFilter !== 'all' ? (
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="rounded-full border border-[#E2004F]/40 bg-[#E2004F]/10 px-3 py-1 text-xs font-semibold text-[#E2004F]"
              >
                Status: {statusFilter} ×
              </button>
            ) : null}
            {ruleFilter !== 'all' ? (
              <button
                type="button"
                onClick={() => setRuleFilter('all')}
                className="rounded-full border border-[#E2004F]/40 bg-[#E2004F]/10 px-3 py-1 text-xs font-semibold text-[#E2004F]"
              >
                Rule: {ruleFilter.length > 40 ? ruleFilter.slice(0, 38) + '…' : ruleFilter} ×
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs font-semibold text-[#5A5755] underline hover:text-[#222121]"
            >
              Clear all filters
            </button>
          </section>
        ) : null}

        <section className="rounded-xl border border-[#EBE5D9] bg-amber-50/80 p-4 print:border-stone-300 print:bg-white">
          <p className="text-sm text-[#222121]">
            <strong className="text-[#E2004F]">{mismatchCount}</strong> contacts show{' '}
            <strong>Meeting Scheduled</strong> in Chili Piper but <strong>Meetings = 0</strong> in
            the SF drilldown — review sync timing or definition gaps.
          </p>
        </section>

        <section className="rounded-xl border border-[#EBE5D9] bg-white p-4 print:hidden">
          <div className="flex flex-wrap gap-3">
            <input
              type="search"
              placeholder="Search email, name, country, state, employees…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-w-[220px] flex-1 rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm focus:border-[#E2004F] focus:outline-none focus:ring-1 focus:ring-[#E2004F]"
            />
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="max-w-[180px] rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'All countries' : c}
                </option>
              ))}
            </select>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="max-w-[180px] rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              {states.slice(0, 120).map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All states' : s}
                </option>
              ))}
            </select>
            <select
              value={eeFilter}
              onChange={(e) => setEeFilter(e.target.value)}
              className="max-w-[180px] rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              {eeSegments.map((seg) => (
                <option key={seg} value={seg}>
                  {seg === 'all' ? 'All employee bands' : eeLabel(seg)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setActiveKpi(null);
              }}
              className="rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s}
                </option>
              ))}
            </select>
            <select
              value={ruleFilter}
              onChange={(e) => {
                setRuleFilter(e.target.value);
                setActiveKpi(null);
              }}
              className="max-w-xs rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              {rules.slice(0, 80).map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All rules' : s}
                </option>
              ))}
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="max-w-[160px] rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              <option value="all">All tags</option>
              <option value="Concierge">Concierge</option>
              <option value="Distro">Distro</option>
              <option value="Neither">No tag</option>
            </select>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="max-w-xs rounded-lg border border-[#EBE5D9] px-3 py-2 text-sm"
            >
              {owners.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All owners' : s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyCatchAll}
                onChange={(e) => {
                  setOnlyCatchAll(e.target.checked);
                  setActiveKpi(null);
                }}
              />
              Catch All only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyMismatch}
                onChange={(e) => {
                  setOnlyMismatch(e.target.checked);
                  setActiveKpi(null);
                }}
              />
              CP scheduled · SF meeting = 0
            </label>
          </div>
          <p className="mt-3 text-xs text-[#5A5755]">
            Showing {sorted.length} of {report.length} contacts
            {sorted.length !== report.length ? ' (filtered)' : ''}
            {' · '}Sorted by {sortKey} ({sortDir})
          </p>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#EBE5D9] bg-white">
          <div className="custom-scroll overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-[#EBE5D9] bg-[#FFFDF9] text-xs font-bold uppercase tracking-wide text-[#5A5755]">
                <tr>
                  <th className="px-3 py-3 w-8" />
                  <SortableHeader label="Contact" column="contactName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Account" column="accountName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Country" column="country" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="State" column="state" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="EEs" column="numberOfEmployees" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="EE band" column="employeeMicroSegment" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="SF owner" column="owner" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-3">SF qual.</th>
                  <th className="px-3 py-3">SF mtg</th>
                  <SortableHeader label="CP status" column="cpStatus" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-3">Tags</th>
                  <SortableHeader label="Routing rule" column="latestRule" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Assignee" column="latestAssignedTo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Last activity" column="latestDate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBE5D9]">
                {pageRows.map((row) => {
                  const st = statusLabel(row);
                  const open = expanded === row.email;
                  return (
                    <React.Fragment key={row.email}>
                      <tr className="hover:bg-[#FFFDF9]/80">
                        <td className="px-3 py-2 print:hidden">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : row.email)}
                            className="text-[#E2004F] font-bold"
                          >
                            {open ? '−' : '+'}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-[#222121]">
                            {row.contactName || '—'}
                          </div>
                          <a
                            href={row.sfLink || `mailto:${row.email}`}
                            className="text-xs text-[#E2004F] hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.email}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-[#5A5755] max-w-[160px] truncate" title={row.accountName}>
                          {row.accountName || '—'}
                        </td>
                        <td className="px-3 py-2 text-[#5A5755] whitespace-nowrap">
                          {geoDisplay(row.country)}
                        </td>
                        <td className="px-3 py-2 text-[#5A5755] whitespace-nowrap max-w-[120px] truncate" title={row.state}>
                          {geoDisplay(row.state)}
                        </td>
                        <td
                          className="px-3 py-2 tabular-nums text-right"
                          title={eeLabel(row.employeeMicroSegment)}
                        >
                          {formatEmployees(row.numberOfEmployees)}
                        </td>
                        <td className="px-3 py-2 text-xs text-[#5A5755] whitespace-nowrap">
                          {eeLabel(row.employeeMicroSegment)}
                        </td>
                        <td className="px-3 py-2 text-[#5A5755]">{row.owner || '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{sfYesNo(row.qualification)}</td>
                        <td className="px-3 py-2 tabular-nums">{sfYesNo(row.meetingsCol)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={st} />
                        </td>
                        <td className="px-3 py-2">
                          <TagBadges tags={row.tags} />
                        </td>
                        <td className="px-3 py-2 max-w-[200px] truncate text-xs" title={row.latestRule}>
                          {row.latestRule || (row.inConciergeLogs ? '—' : 'No log')}
                        </td>
                        <td className="px-3 py-2 text-xs">{row.latestAssignedTo || '—'}</td>
                        <td className="px-3 py-2 text-xs text-[#5A5755] whitespace-nowrap">
                          {formatDate(row.latestDate)}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="bg-[#FFFDF9] print:table-row">
                          <td colSpan={15} className="px-6 py-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <h3 className="text-xs font-bold uppercase text-[#5A5755]">
                                  Routing journey ({row.logCount} events)
                                </h3>
                                <div className="mt-2">
                                  <JourneyTimeline journey={row.journey} />
                                </div>
                              </div>
                              <div className="text-sm text-[#5A5755] space-y-1">
                                <p>
                                  <strong>Trigger:</strong> {row.latestTrigger || '—'}
                                </p>
                                <p className="break-all">
                                  <strong>Source:</strong>{' '}
                                  {row.latestSource ? (
                                    <a
                                      href={row.latestSource}
                                      className="text-[#E2004F]"
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {row.latestSource}
                                    </a>
                                  ) : (
                                    '—'
                                  )}
                                </p>
                                <p>
                                  <strong>MQA (SF):</strong> {sfYesNo(row.mqas)}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EBE5D9] px-4 py-3 print:hidden">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-[#EBE5D9] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-[#5A5755]">
              Page {page + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-lg border border-[#EBE5D9] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </section>

        <footer className="pb-8 text-center text-xs text-[#5A5755] print:pb-4">
          Data: Concierge routing exports + SF MQL drilldown · Generated for Marketing &amp; Sales
          leadership review
        </footer>
      </main>
    </div>
  );
}

window.MqlDrilldownDashboard = MqlDrilldownDashboard;
