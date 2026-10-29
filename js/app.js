// WTI Crude Oil Interactive Dashboard Controller
(function() {
  const SERIES = window.WTI_SERIES || [];
  const SIGNALS = window.WTI_SIGNALS || [];

  const state = {
    period: 'ALL',        // 'ALL', '2014-2019', '2020-2022', '2023-2024', '2025-2026'
    layer: 'ALL',         // 'ALL', 'Q3', 'Q1', 'Q2', 'WHIPSAW'
    selectedSignalId: 'Q3-16', // Default flagship OOS signal: 2026-04-10 Q3 short
    showMA5: true,
    showTradePath: true,
    searchQuery: '',
    activeTab: 'ledger',
    hoverIndex: null,
    hoveredSignalId: null
  };

  // Cached screen coordinates of signals for click/hover detection on price canvas
  let renderedSignalCoords = [];

  function formatUSD(val, showPlus = true) {
    const num = Number(val) || 0;
    const sign = num > 0 ? (showPlus ? '+' : '') : (num < 0 ? '-' : '');
    return sign + '$' + Math.abs(num).toLocaleString('en-US');
  }

  function getFilteredSeries() {
    if (state.period === 'ALL') return SERIES;
    return SERIES.filter(d => d.period === state.period);
  }

  function getFilteredSignals() {
    return SIGNALS.filter(s => {
      const matchPeriod = (state.period === 'ALL') || (s.period === state.period);
      const matchLayer = (state.layer === 'ALL') || (s.type === state.layer);
      return matchPeriod && matchLayer;
    });
  }

  function getPeriodSignals(typeFilter) {
    return SIGNALS.filter(s => {
      const matchPeriod = (state.period === 'ALL') || (s.period === state.period);
      const matchType = !typeFilter || (Array.isArray(typeFilter) ? typeFilter.includes(s.type) : s.type === typeFilter);
      return matchPeriod && matchType;
    });
  }

  function showToast(msg) {
    const toast = document.getElementById('toastBanner');
    const toastText = document.getElementById('toastText');
    if (!toast || !toastText) return;
    toastText.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }

  // Update KPI Cards & Filter Button States
  function updateDashboardMetrics() {
    const visibleSignals = getFilteredSignals();

    // Calculate layer-aware stats matching the exact report specification
    const q3List = visibleSignals.filter(s => s.type === 'Q3');
    const q1q2List = visibleSignals.filter(s => s.type === 'Q1' || s.type === 'Q2');
    const wsList = visibleSignals.filter(s => s.type === 'WHIPSAW');

    const q3Pnl = q3List.reduce((acc, s) => acc + s.pnl, 0);
    const q3Wins = q3List.filter(s => s.win).length;
    const q3WinRate = q3List.length > 0 ? Math.round((q3Wins / q3List.length) * 100) : 0;

    const longPnl = q1q2List.reduce((acc, s) => acc + s.pnl, 0);
    const longWins = q1q2List.filter(s => s.win).length;
    const longWinRate = q1q2List.length > 0 ? Math.round((longWins / q1q2List.length) * 100) : 0;

    // Count true whipsaws vs total narrow stop samples
    const wsWhipsawCount = wsList.filter(s => s.exitType.indexOf('TRUE_STOP') === -1).length;

    const elTotalCount = document.getElementById('kpiTotalCount');
    const elTotalSub = document.getElementById('kpiTotalSub');
    if (elTotalCount) elTotalCount.textContent = visibleSignals.length + ' 笔';
    if (elTotalSub) {
      elTotalSub.textContent = `Q3做空 ${q3List.length} | Q1抄底 ${visibleSignals.filter(s=>s.type==='Q1').length} | Q2突破 ${visibleSignals.filter(s=>s.type==='Q2').length} | 窄止损诊断 ${wsList.length}`;
    }

    const elQ3Pnl = document.getElementById('kpiQ3Pnl');
    const elQ3Meta = document.getElementById('kpiQ3Meta');
    if (elQ3Pnl) {
      elQ3Pnl.textContent = formatUSD(q3Pnl, true);
      elQ3Pnl.className = 'text-xl sm:text-2xl font-bold font-mono-num ' + (q3Pnl >= 0 ? 'text-rose-400' : 'text-slate-400');
    }
    if (elQ3Meta) {
      elQ3Meta.textContent = `${q3List.length}笔 | 胜率 ${q3WinRate}% (右侧5MA门控)`;
    }

    const elLongPnl = document.getElementById('kpiLongPnl');
    const elLongMeta = document.getElementById('kpiLongMeta');
    if (elLongPnl) {
      elLongPnl.textContent = formatUSD(longPnl, true);
      elLongPnl.className = 'text-xl sm:text-2xl font-bold font-mono-num ' + (longPnl > 0 ? 'text-emerald-400' : 'text-slate-400');
    }
    if (elLongMeta) {
      elLongMeta.textContent = `${q1q2List.length}笔 | 胜率 ${longWinRate}% (2ATR+重置)`;
    }

    const elWsTitle = document.getElementById('kpiWsTitle');
    const elWsMeta = document.getElementById('kpiWsMeta');
    if (elWsTitle) {
      if (wsList.length === 0) {
        elWsTitle.textContent = '0 笔典型样本';
      } else if (state.period === 'ALL' && state.layer === 'ALL') {
        elWsTitle.textContent = `${wsWhipsawCount} 笔错杀样本 (共${wsList.length}笔解剖)`;
      } else {
        elWsTitle.textContent = `${wsList.length} 笔典型样本 (${wsWhipsawCount}笔重返+5%)`;
      }
    }
    if (elWsMeta) {
      elWsMeta.textContent = wsList.length > 0
        ? '中位 0.66x ATR20 | 75%集中在入场D1–D3被扫'
        : '切换到「全部信号」或「IV60窄止损」查看';
    }

    // Update Period filter button styles
    document.querySelectorAll('[data-period-btn]').forEach(btn => {
      const p = btn.getAttribute('data-period-btn');
      btn.classList.toggle('filter-btn-active', p === state.period);
    });

    // Update Layer filter button styles & live counts for active period
    const pAll = getPeriodSignals(null).length;
    const pQ3 = getPeriodSignals('Q3').length;
    const pQ1 = getPeriodSignals('Q1').length;
    const pQ2 = getPeriodSignals('Q2').length;
    const pWS = getPeriodSignals('WHIPSAW').length;

    const countMap = { ALL: pAll, Q3: pQ3, Q1: pQ1, Q2: pQ2, WHIPSAW: pWS };
    document.querySelectorAll('[data-layer-btn]').forEach(btn => {
      const l = btn.getAttribute('data-layer-btn');
      btn.classList.remove('layer-btn-active-ALL', 'layer-btn-active-Q3', 'layer-btn-active-Q1', 'layer-btn-active-Q2', 'layer-btn-active-WHIPSAW');
      if (l === state.layer) {
        btn.classList.add('layer-btn-active-' + l);
      }
      const badge = btn.querySelector('[data-layer-count]');
      if (badge && countMap[l] !== undefined) {
        badge.textContent = countMap[l] + '笔';
      }
    });

    // Ensure selectedSignalId is inside visibleSignals if possible
    if (visibleSignals.length > 0 && !visibleSignals.some(s => s.id === state.selectedSignalId)) {
      state.selectedSignalId = visibleSignals[visibleSignals.length - 1].id;
    }

    renderMicroscope();
    renderLedgerTable();
    drawCharts();
  }

  // Render Single-Trade Microscope Panel
  function renderMicroscope() {
    const visibleSignals = getFilteredSignals();
    let sig = SIGNALS.find(s => s.id === state.selectedSignalId) || visibleSignals[0] || SIGNALS[0];
    if (!sig) return;

    const idxInVisible = visibleSignals.findIndex(s => s.id === sig.id);
    const posText = idxInVisible >= 0
      ? `当前筛选第 ${idxInVisible + 1} / ${visibleSignals.length} 笔`
      : `全局信号 (${sig.id})`;

    const typeBadgeMap = {
      Q3: { text: '▼ Q3 顶部右侧做空 / 止盈', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
      Q1: { text: '▲ Q1 恐慌抄底 + 2ATR退出', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
      Q2: { text: '◆ Q2 突破续涨 + 止盈退出', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
      WHIPSAW: { text: '✖ IV60 固定3%窄止损诊断', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' }
    };
    const badgeInfo = typeBadgeMap[sig.type] || typeBadgeMap.Q3;

    const elBadge = document.getElementById('microBadge');
    if (elBadge) {
      elBadge.textContent = badgeInfo.text;
      elBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold border ' + badgeInfo.cls;
    }

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('microPosIndex', posText);
    setTxt('microName', `${sig.name}（${sig.exitType}）`);
    setTxt('microDates', `${sig.date}（入场） → ${sig.exitDate}（退出）`);
    setTxt('microPriceIndicator', `原油开仓价 $${sig.entryPrice.toFixed(2)} → 平仓价 $${sig.exitPrice.toFixed(2)} | ${sig.indicator}`);

    const elPnl = document.getElementById('microPnl');
    if (elPnl) {
      const retStr = (sig.retPct >= 0 ? '+' : '') + sig.retPct.toFixed(2) + '%';
      elPnl.textContent = `${formatUSD(sig.pnl, true)}（收益率 ${retStr}，已扣除 $90 成本）`;
      elPnl.className = 'text-base sm:text-lg font-bold font-mono-num ' + (sig.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400');
    }

    setTxt('microMfeMae', `最大有利变动 (MFE) +${sig.mfe.toFixed(1)}% / 最大不利变动 (MAE) ${sig.mae.toFixed(1)}%`);
    setTxt('microNote', sig.note);

    // Update MFE / MAE visual bar widths
    const mfeBar = document.getElementById('microMfeBar');
    const maeBar = document.getElementById('microMaeBar');
    if (mfeBar && maeBar) {
      const maxScale = 40; // 40% full scale
      const mfeW = Math.min(100, Math.round((Math.abs(sig.mfe) / maxScale) * 100));
      const maeW = Math.min(100, Math.round((Math.abs(sig.mae) / maxScale) * 100));
      mfeBar.style.width = Math.max(6, mfeW) + '%';
      maeBar.style.width = Math.max(6, maeW) + '%';
    }
  }

  // Draw Synchronized Dual Canvas (Price + Signals Panel & ATM IV + Dispersion Panel)
  function drawCharts() {
    const priceCanvas = document.getElementById('wtiPriceCanvas');
    const ivCanvas = document.getElementById('wtiIvCanvas');
    if (!priceCanvas || !ivCanvas) return;

    const series = getFilteredSeries();
    const signals = getFilteredSignals();
    if (series.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const pRect = priceCanvas.parentElement.getBoundingClientRect();
    const ivRect = ivCanvas.parentElement.getBoundingClientRect();

    const width = Math.max(320, Math.floor(pRect.width));
    const pHeight = Math.max(250, Math.floor(pRect.height));
    const ivHeight = Math.max(130, Math.floor(ivRect.height));

    priceCanvas.width = width * dpr;
    priceCanvas.height = pHeight * dpr;
    priceCanvas.style.width = width + 'px';
    priceCanvas.style.height = pHeight + 'px';

    ivCanvas.width = width * dpr;
    ivCanvas.height = ivHeight * dpr;
    ivCanvas.style.width = width + 'px';
    ivCanvas.style.height = ivHeight + 'px';

    const pCtx = priceCanvas.getContext('2d');
    const ivCtx = ivCanvas.getContext('2d');
    pCtx.scale(dpr, dpr);
    ivCtx.scale(dpr, dpr);

    const pad = { left: 54, right: 20, top: 22, bottom: 26 };
    const plotW = width - pad.left - pad.right;
    const pPlotH = pHeight - pad.top - pad.bottom;
    const ivPlotH = ivHeight - 16 - 24;

    // Price range
    let minP = Infinity, maxP = -Infinity;
    series.forEach(d => {
      if (d.price < minP) minP = d.price;
      if (d.price > maxP) maxP = d.price;
    });
    signals.forEach(s => {
      if (s.entryPrice < minP) minP = s.entryPrice;
      if (s.entryPrice > maxP) maxP = s.entryPrice;
    });
    minP = Math.floor(Math.max(10, minP - 6));
    maxP = Math.ceil(maxP + 8);

    const xOfIndex = (idx) => pad.left + (idx / Math.max(1, series.length - 1)) * plotW;
    const yOfPrice = (p) => pad.top + (1 - (p - minP) / Math.max(1, maxP - minP)) * pPlotH;

    // Map date to index
    const dateIdxMap = {};
    series.forEach((d, i) => { dateIdxMap[d.date] = i; });
    const findNearestIdx = (dtStr) => {
      if (dateIdxMap[dtStr] !== undefined) return dateIdxMap[dtStr];
      let bestIdx = 0, bestDiff = Infinity;
      for (let i = 0; i < series.length; i++) {
        const diff = Math.abs(new Date(series[i].date) - new Date(dtStr));
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      return bestIdx;
    };

    // --- 1. Draw Price Background & Grid ---
    pCtx.clearRect(0, 0, width, pHeight);
    pCtx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    pCtx.lineWidth = 1;
    pCtx.font = '11px "JetBrains Mono", monospace';
    pCtx.fillStyle = '#94a3b8';

    const pSteps = 5;
    for (let i = 0; i <= pSteps; i++) {
      const val = minP + ((maxP - minP) / pSteps) * (pSteps - i);
      const y = pad.top + (pPlotH / pSteps) * i;
      pCtx.beginPath();
      pCtx.moveTo(pad.left, y);
      pCtx.lineTo(width - pad.right, y);
      pCtx.stroke();
      pCtx.textAlign = 'right';
      pCtx.fillText('$' + val.toFixed(0), pad.left - 8, y + 4);
    }

    // Highlight 2025-2026 OOS zone if in ALL view
    if (state.period === 'ALL') {
      const oosStartIdx = series.findIndex(d => d.date >= '2025-01-01');
      if (oosStartIdx >= 0) {
        const xOos = xOfIndex(oosStartIdx);
        pCtx.fillStyle = 'rgba(56, 189, 248, 0.045)';
        pCtx.fillRect(xOos, pad.top, width - pad.right - xOos, pPlotH);
        pCtx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        pCtx.setLineDash([4, 4]);
        pCtx.beginPath();
        pCtx.moveTo(xOos, pad.top);
        pCtx.lineTo(xOos, pad.top + pPlotH);
        pCtx.stroke();
        pCtx.setLineDash([]);
        pCtx.fillStyle = '#38bdf8';
        pCtx.textAlign = 'left';
        pCtx.font = '10px "Inter", sans-serif';
        pCtx.fillText('2025–2026 样本外大考区', xOos + 6, pad.top + 13);
      }
    }

    // X-axis date ticks
    const tickCount = Math.min(8, series.length);
    pCtx.fillStyle = '#94a3b8';
    pCtx.font = '11px "JetBrains Mono", monospace';
    pCtx.textAlign = 'center';
    for (let i = 0; i < tickCount; i++) {
      const idx = Math.round((i / Math.max(1, tickCount - 1)) * (series.length - 1));
      const x = xOfIndex(idx);
      const label = series[idx].date.slice(0, 7);
      pCtx.fillText(label, x, pHeight - 7);
    }

    // --- 2. Draw WTI Price Area & Line ---
    const grad = pCtx.createLinearGradient(0, pad.top, 0, pad.top + pPlotH);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    pCtx.beginPath();
    series.forEach((d, i) => {
      const x = xOfIndex(i);
      const y = yOfPrice(d.price);
      if (i === 0) pCtx.moveTo(x, y);
      else pCtx.lineTo(x, y);
    });
    pCtx.lineTo(xOfIndex(series.length - 1), pad.top + pPlotH);
    pCtx.lineTo(xOfIndex(0), pad.top + pPlotH);
    pCtx.closePath();
    pCtx.fillStyle = grad;
    pCtx.fill();

    // Main Price Line
    pCtx.beginPath();
    series.forEach((d, i) => {
      const x = xOfIndex(i);
      const y = yOfPrice(d.price);
      if (i === 0) pCtx.moveTo(x, y);
      else pCtx.lineTo(x, y);
    });
    pCtx.strokeStyle = '#e2e8f0';
    pCtx.lineWidth = 1.8;
    pCtx.stroke();

    // Optional 5MA Line
    if (state.showMA5) {
      pCtx.beginPath();
      series.forEach((d, i) => {
        const x = xOfIndex(i);
        const y = yOfPrice(d.ma5);
        if (i === 0) pCtx.moveTo(x, y);
        else pCtx.lineTo(x, y);
      });
      pCtx.strokeStyle = 'rgba(168, 85, 247, 0.75)';
      pCtx.lineWidth = 1.2;
      pCtx.setLineDash([3, 3]);
      pCtx.stroke();
      pCtx.setLineDash([]);
    }

    // --- 3. Draw Entry-to-Exit Connector for Active Selected Signal ---
    const activeSig = signals.find(s => s.id === state.selectedSignalId);
    if (state.showTradePath && activeSig) {
      const enIdx = findNearestIdx(activeSig.date);
      const exIdx = findNearestIdx(activeSig.exitDate);
      const x1 = xOfIndex(enIdx), y1 = yOfPrice(activeSig.entryPrice);
      const x2 = xOfIndex(exIdx), y2 = yOfPrice(activeSig.exitPrice);

      pCtx.save();
      pCtx.strokeStyle = activeSig.pnl >= 0 ? '#34d399' : '#fbbf24';
      pCtx.lineWidth = 2.2;
      pCtx.setLineDash([5, 3]);
      pCtx.beginPath();
      pCtx.moveTo(x1, y1);
      pCtx.lineTo(x2, y2);
      pCtx.stroke();
      pCtx.setLineDash([]);

      // Exit circle marker
      pCtx.beginPath();
      pCtx.arc(x2, y2, 4.5, 0, Math.PI * 2);
      pCtx.fillStyle = activeSig.pnl >= 0 ? '#10b981' : '#f59e0b';
      pCtx.fill();
      pCtx.strokeStyle = '#0f172a';
      pCtx.lineWidth = 1.5;
      pCtx.stroke();
      pCtx.restore();
    }

    // --- 4. Draw Signal Markers ---
    renderedSignalCoords = [];
    signals.forEach(sig => {
      const idx = findNearestIdx(sig.date);
      const x = xOfIndex(idx);
      const y = yOfPrice(sig.entryPrice);
      const isSelected = sig.id === state.selectedSignalId;
      const isHovered = sig.id === state.hoveredSignalId;
      const radius = isSelected ? 8.5 : (isHovered ? 7.5 : 6.0);

      renderedSignalCoords.push({ id: sig.id, x, y, sig });

      pCtx.save();
      if (isSelected) {
        pCtx.beginPath();
        pCtx.arc(x, y, radius + 5, 0, Math.PI * 2);
        pCtx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        pCtx.fill();
        pCtx.strokeStyle = '#ffffff';
        pCtx.lineWidth = 1.5;
        pCtx.stroke();
      }

      if (sig.type === 'Q3') {
        // Red downward triangle ▼
        pCtx.fillStyle = '#fb7185';
        pCtx.strokeStyle = '#0f172a';
        pCtx.lineWidth = 1.2;
        pCtx.beginPath();
        pCtx.moveTo(x, y + radius);
        pCtx.lineTo(x - radius * 0.9, y - radius * 0.75);
        pCtx.lineTo(x + radius * 0.9, y - radius * 0.75);
        pCtx.closePath();
        pCtx.fill();
        pCtx.stroke();
      } else if (sig.type === 'Q1') {
        // Emerald upward triangle ▲
        pCtx.fillStyle = '#34d399';
        pCtx.strokeStyle = '#0f172a';
        pCtx.lineWidth = 1.2;
        pCtx.beginPath();
        pCtx.moveTo(x, y - radius);
        pCtx.lineTo(x - radius * 0.9, y + radius * 0.75);
        pCtx.lineTo(x + radius * 0.9, y + radius * 0.75);
        pCtx.closePath();
        pCtx.fill();
        pCtx.stroke();
      } else if (sig.type === 'Q2') {
        // Sky blue diamond ◆
        pCtx.fillStyle = '#38bdf8';
        pCtx.strokeStyle = '#0f172a';
        pCtx.lineWidth = 1.2;
        pCtx.beginPath();
        pCtx.moveTo(x, y - radius);
        pCtx.lineTo(x + radius * 0.85, y);
        pCtx.lineTo(x, y + radius);
        pCtx.lineTo(x - radius * 0.85, y);
        pCtx.closePath();
        pCtx.fill();
        pCtx.stroke();
      } else if (sig.type === 'WHIPSAW') {
        // Orange X ✖
        const r = radius * 0.75;
        pCtx.strokeStyle = '#fbbf24';
        pCtx.lineWidth = 2.4;
        pCtx.beginPath();
        pCtx.moveTo(x - r, y - r);
        pCtx.lineTo(x + r, y + r);
        pCtx.moveTo(x + r, y - r);
        pCtx.lineTo(x - r, y + r);
        pCtx.stroke();
      }
      pCtx.restore();
    });

    // --- 5. Draw Synchronized Secondary Panel (ATM IV & Dispersion) ---
    ivCtx.clearRect(0, 0, width, ivHeight);
    let minIv = 10, maxIv = 0;
    series.forEach(d => {
      if (d.iv > maxIv) maxIv = d.iv;
    });
    maxIv = Math.ceil(Math.max(50, maxIv + 6));
    const yOfIv = (v) => 14 + (1 - (v - minIv) / Math.max(1, maxIv - minIv)) * ivPlotH;

    ivCtx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ivCtx.lineWidth = 1;
    ivCtx.font = '10px "JetBrains Mono", monospace';
    ivCtx.fillStyle = '#94a3b8';

    const ivSteps = 3;
    for (let i = 0; i <= ivSteps; i++) {
      const val = minIv + ((maxIv - minIv) / ivSteps) * (ivSteps - i);
      const y = 14 + (ivPlotH / ivSteps) * i;
      ivCtx.beginPath();
      ivCtx.moveTo(pad.left, y);
      ivCtx.lineTo(width - pad.right, y);
      ivCtx.stroke();
      ivCtx.textAlign = 'right';
      ivCtx.fillText(val.toFixed(0) + '%', pad.left - 8, y + 3);
    }

    // IV Gradient Area
    const ivGrad = ivCtx.createLinearGradient(0, 14, 0, 14 + ivPlotH);
    ivGrad.addColorStop(0, 'rgba(244, 63, 94, 0.28)');
    ivGrad.addColorStop(1, 'rgba(244, 63, 94, 0.0)');

    ivCtx.beginPath();
    series.forEach((d, i) => {
      const x = xOfIndex(i);
      const y = yOfIv(d.iv);
      if (i === 0) ivCtx.moveTo(x, y);
      else ivCtx.lineTo(x, y);
    });
    ivCtx.lineTo(xOfIndex(series.length - 1), 14 + ivPlotH);
    ivCtx.lineTo(xOfIndex(0), 14 + ivPlotH);
    ivCtx.closePath();
    ivCtx.fillStyle = ivGrad;
    ivCtx.fill();

    // ATM IV Line
    ivCtx.beginPath();
    series.forEach((d, i) => {
      const x = xOfIndex(i);
      const y = yOfIv(d.iv);
      if (i === 0) ivCtx.moveTo(x, y);
      else ivCtx.lineTo(x, y);
    });
    ivCtx.strokeStyle = '#fb7185';
    ivCtx.lineWidth = 1.5;
    ivCtx.stroke();

    // IV Dispersion (iv_std_60 scaled) Line
    ivCtx.beginPath();
    series.forEach((d, i) => {
      const x = xOfIndex(i);
      const y = yOfIv(minIv + d.ivStd * 3.2);
      if (i === 0) ivCtx.moveTo(x, y);
      else ivCtx.lineTo(x, y);
    });
    ivCtx.strokeStyle = '#fbbf24';
    ivCtx.lineWidth = 1.2;
    ivCtx.stroke();

    // --- 6. Draw Synchronized Hover Crosshair on Both Canvases ---
    if (state.hoverIndex !== null && series[state.hoverIndex]) {
      const hx = xOfIndex(state.hoverIndex);
      [ [pCtx, pad.top, pPlotH], [ivCtx, 14, ivPlotH] ].forEach(([ctx, topY, h]) => {
        ctx.save();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, topY);
        ctx.lineTo(hx, topY + h);
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  // Render Interactive Signal Ledger Table
  function renderLedgerTable() {
    const tbody = document.getElementById('signalLedgerBody');
    const countSpan = document.getElementById('ledgerMatchCount');
    if (!tbody) return;

    const q = state.searchQuery.trim().toLowerCase();
    const filtered = getFilteredSignals().filter(s => {
      if (!q) return true;
      return (
        s.id.toLowerCase().includes(q) ||
        s.date.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.indicator.toLowerCase().includes(q) ||
        s.note.toLowerCase().includes(q)
      );
    });

    if (countSpan) countSpan.textContent = `共 ${filtered.length} 笔匹配记录`;

    const badgeCls = {
      Q3: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      Q1: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      Q2: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      WHIPSAW: 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    };
    const badgeLabel = {
      Q3: '▼ Q3做空',
      Q1: '▲ Q1抄底',
      Q2: '◆ Q2突破',
      WHIPSAW: '✖ 窄止损'
    };

    tbody.innerHTML = filtered.map(s => {
      const isSel = s.id === state.selectedSignalId;
      const rowBg = isSel ? 'bg-blue-950/60 border-l-2 border-l-sky-400' : 'hover:bg-slate-800/60';
      const pnlColor = s.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
      const retStr = (s.retPct >= 0 ? '+' : '') + s.retPct.toFixed(2) + '%';
      return `<tr data-signal-row="${s.id}" class="cursor-pointer transition-colors border-b border-slate-800/80 ${rowBg}">
        <td class="py-2.5 px-3 font-mono-num text-xs text-slate-300 whitespace-nowrap">${s.date}</td>
        <td class="py-2.5 px-3 whitespace-nowrap">
          <span class="px-2 py-0.5 text-xs rounded border ${badgeCls[s.type] || ''}">${badgeLabel[s.type] || s.type}</span>
        </td>
        <td class="py-2.5 px-3 text-xs sm:text-sm font-medium text-slate-100">${s.name}</td>
        <td class="py-2.5 px-3 font-mono-num text-xs text-right text-slate-300">$${s.entryPrice.toFixed(2)} → $${s.exitPrice.toFixed(2)}</td>
        <td class="py-2.5 px-3 font-mono-num text-xs text-right font-semibold ${pnlColor}">${formatUSD(s.pnl, true)} (${retStr})</td>
        <td class="py-2.5 px-3 font-mono-num text-xs text-right text-slate-400">+${s.mfe.toFixed(1)}% / ${s.mae.toFixed(1)}%</td>
        <td class="py-2.5 px-3 text-xs text-slate-400 hidden md:table-cell">${s.indicator}</td>
      </tr>`;
    }).join('');
  }

  // Export filtered signals as CSV
  function exportCurrentCSV() {
    const rows = getFilteredSignals();
    const headers = ['信号ID', '入场日期', '退出日期', '样本分段', '信号类型', '信号名称', '退出方式', '开仓价($)', '平仓价($)', '单手净损益($)', '收益率(%)', 'MFE(%)', 'MAE(%)', '触发指标与分位', '微观归因说明'];
    const csvLines = [headers.join(',')];
    rows.forEach(s => {
      const vals = [
        s.id, s.date, s.exitDate, s.period, s.type,
        `"${s.name.replace(/"/g, '""')}"`,
        `"${s.exitType.replace(/"/g, '""')}"`,
        s.entryPrice, s.exitPrice, s.pnl, s.retPct, s.mfe, s.mae,
        `"${s.indicator.replace(/"/g, '""')}"`,
        `"${s.note.replace(/"/g, '""')}"`
      ];
      csvLines.push(vals.join(','));
    });
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wti_crude_signals_${state.period}_${state.layer}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${rows.length} 笔原油实证信号 CSV 文件`);
  }

  function setupInteractions() {
    // Period filter buttons
    document.querySelectorAll('[data-period-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.period = btn.getAttribute('data-period-btn');
        updateDashboardMetrics();
      });
    });

    // Signal layer filter buttons
    document.querySelectorAll('[data-layer-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.layer = btn.getAttribute('data-layer-btn');
        updateDashboardMetrics();
      });
    });

    // Chart toggles
    const btnToggleMA5 = document.getElementById('btnToggleMA5');
    if (btnToggleMA5) {
      btnToggleMA5.addEventListener('click', () => {
        state.showMA5 = !state.showMA5;
        btnToggleMA5.classList.toggle('bg-purple-500/25', state.showMA5);
        btnToggleMA5.classList.toggle('border-purple-400', state.showMA5);
        drawCharts();
      });
    }

    const btnTogglePath = document.getElementById('btnTogglePath');
    if (btnTogglePath) {
      btnTogglePath.addEventListener('click', () => {
        state.showTradePath = !state.showTradePath;
        btnTogglePath.classList.toggle('bg-emerald-500/25', state.showTradePath);
        btnTogglePath.classList.toggle('border-emerald-400', state.showTradePath);
        drawCharts();
      });
    }

    const btnResetFilters = document.getElementById('btnResetFilters');
    if (btnResetFilters) {
      btnResetFilters.addEventListener('click', () => {
        state.period = 'ALL';
        state.layer = 'ALL';
        state.selectedSignalId = 'Q3-16';
        state.searchQuery = '';
        const searchInput = document.getElementById('ledgerSearchInput');
        if (searchInput) searchInput.value = '';
        updateDashboardMetrics();
        showToast('已重置为全周期 (2014–2026) 全部 71 笔信号视图');
      });
    }

    // Microscope Prev / Next buttons
    const btnPrevSig = document.getElementById('btnPrevSig');
    const btnNextSig = document.getElementById('btnNextSig');
    if (btnPrevSig) {
      btnPrevSig.addEventListener('click', () => {
        const list = getFilteredSignals();
        if (!list.length) return;
        const idx = list.findIndex(s => s.id === state.selectedSignalId);
        const prevIdx = idx > 0 ? idx - 1 : list.length - 1;
        state.selectedSignalId = list[prevIdx].id;
        renderMicroscope();
        renderLedgerTable();
        drawCharts();
      });
    }
    if (btnNextSig) {
      btnNextSig.addEventListener('click', () => {
        const list = getFilteredSignals();
        if (!list.length) return;
        const idx = list.findIndex(s => s.id === state.selectedSignalId);
        const nextIdx = (idx >= 0 && idx < list.length - 1) ? idx + 1 : 0;
        state.selectedSignalId = list[nextIdx].id;
        renderMicroscope();
        renderLedgerTable();
        drawCharts();
      });
    }

    // Search input & CSV export
    const searchInput = document.getElementById('ledgerSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value || '';
        renderLedgerTable();
      });
    }

    const btnExportCsv = document.getElementById('btnExportCsv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportCurrentCSV);
    }

    // Delegated click on Ledger Table rows
    const tbody = document.getElementById('signalLedgerBody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('[data-signal-row]');
        if (!tr) return;
        state.selectedSignalId = tr.getAttribute('data-signal-row');
        renderMicroscope();
        renderLedgerTable();
        drawCharts();
      });
    }

    // Delegated click on 2026 Whipsaw Diagnostic Table rows
    document.querySelectorAll('[data-jump-signal]').forEach(el => {
      el.addEventListener('click', () => {
        const sigId = el.getAttribute('data-jump-signal');
        if (!sigId) return;
        state.period = '2025-2026';
        state.layer = 'ALL';
        state.selectedSignalId = sigId;
        updateDashboardMetrics();
        const chartEl = document.getElementById('wtiPriceCanvas');
        if (chartEl) chartEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast(`已在看板与显微镜中定位信号 ${sigId}`);
      });
    });

    // Bottom research tabs
    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab-target');
        state.activeTab = target;
        document.querySelectorAll('[data-tab-target]').forEach(b => {
          b.classList.toggle('tab-btn-active', b.getAttribute('data-tab-target') === target);
        });
        document.querySelectorAll('[data-tab-panel]').forEach(panel => {
          panel.classList.toggle('hidden', panel.getAttribute('data-tab-panel') !== target);
        });
      });
    });

    // Canvas hover & click interactions
    const priceCanvas = document.getElementById('wtiPriceCanvas');
    const tooltip = document.getElementById('chartTooltip');
    if (priceCanvas) {
      priceCanvas.addEventListener('mousemove', (e) => {
        const rect = priceCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const series = getFilteredSeries();
        if (!series.length) return;

        const padLeft = 54, padRight = 20;
        const plotW = rect.width - padLeft - padRight;
        const relX = Math.max(0, Math.min(plotW, mx - padLeft));
        const idx = Math.round((relX / Math.max(1, plotW)) * (series.length - 1));
        state.hoverIndex = idx;

        // Check if mouse is near a signal marker
        let nearestSig = null;
        let minDist = 14;
        renderedSignalCoords.forEach(item => {
          const dist = Math.hypot(item.x - mx, item.y - my);
          if (dist < minDist) {
            minDist = dist;
            nearestSig = item;
          }
        });

        state.hoveredSignalId = nearestSig ? nearestSig.id : null;
        priceCanvas.style.cursor = nearestSig ? 'pointer' : 'crosshair';

        if (tooltip && series[idx]) {
          const pt = series[idx];
          tooltip.classList.remove('hidden');
          if (nearestSig) {
            const s = nearestSig.sig;
            const retStr = (s.retPct >= 0 ? '+' : '') + s.retPct.toFixed(2) + '%';
            tooltip.innerHTML = `<div class="font-semibold text-sky-300">${s.date} • ${s.name}</div>
              <div class="text-slate-200 mt-0.5">开仓 <b>$${s.entryPrice.toFixed(2)}</b> → 平仓 <b>$${s.exitPrice.toFixed(2)}</b> | 净损益 <b class="${s.pnl>=0?'text-emerald-400':'text-rose-400'}">${formatUSD(s.pnl, true)} (${retStr})</b></div>
              <div class="text-slate-400 text-[11px]">点击将此交易载入下方「交易显微镜」</div>`;
          } else {
            tooltip.innerHTML = `<div class="font-mono-num text-slate-300"><b>${pt.date}</b> | WTI主力: <b class="text-white">$${pt.price.toFixed(2)}</b> | 5MA: <span class="text-purple-300">$${pt.ma5.toFixed(2)}</span></div>
              <div class="font-mono-num text-[11px] text-slate-400">30D ATM IV: <span class="text-rose-300">${pt.iv.toFixed(1)}%</span> | IV离散度(iv_std_60): <span class="text-amber-300">${pt.ivStd.toFixed(2)}</span></div>`;
          }
        }
        drawCharts();
      });

      priceCanvas.addEventListener('mouseleave', () => {
        state.hoverIndex = null;
        state.hoveredSignalId = null;
        if (tooltip) tooltip.classList.add('hidden');
        drawCharts();
      });

      priceCanvas.addEventListener('click', () => {
        if (state.hoveredSignalId) {
          state.selectedSignalId = state.hoveredSignalId;
          renderMicroscope();
          renderLedgerTable();
          drawCharts();
          showToast(`已选中信号 ${state.selectedSignalId}，详情已同步至交易显微镜`);
        }
      });
    }

    window.addEventListener('resize', () => {
      drawCharts();
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    setupInteractions();
    updateDashboardMetrics();
  });
})();
