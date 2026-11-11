class SunHorizonCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized = false;
  }

  setConfig(config) {
    this._config = {
      title: 'Sun & Moon',
      entity: 'sun.sun',
      moon_entity: 'sensor.moon_phase',
      ...config,
    };
    if (this._initialized) {
      this._update();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._renderSkeleton();
      this._initialized = true;
    }
    this._update();
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return {
      columns: 12,
      min_columns: 6,
      rows: 'auto',
    };
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _getCompassShort(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
    return dirs[idx];
  }

  _formatTime(isoStr) {
    if (!isoStr) return '--:--';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '--:--';
    return d
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s*a\.?m\.?/i, ' AM')
      .replace(/\s*p\.?m\.?/i, ' PM');
  }

  _getMinutesOfDay(isoStr, fallbackMin) {
    if (!isoStr) return fallbackMin;
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return fallbackMin;
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }

  _formatCountdown(isoStr) {
    if (!isoStr) return '';
    const target = new Date(isoStr).getTime();
    const now = Date.now();
    const diffMin = Math.max(0, Math.round((target - now) / 60000));
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    if (h > 0) return `in ${h}h ${m}m`;
    return `in ${m}m`;
  }

  // Astronomical lunar calculations + Home Assistant sensor.moon_phase integration
  _getMoonData(haMoonState) {
    const SYNODIC_DAYS = 29.530588853;
    const refNewMoonMs = Date.UTC(2000, 0, 6, 18, 14, 0);
    const elapsedDays = (Date.now() - refNewMoonMs) / 86400000;
    let phase = ((elapsedDays % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS / SYNODIC_DAYS;
    const ageDays = phase * SYNODIC_DAYS;
    const illumPct = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100);

    const stateMap = {
      new_moon: { name: 'New Moon', icon: 'mdi:moon-new' },
      waxing_crescent: { name: 'Waxing Crescent', icon: 'mdi:moon-waxing-crescent' },
      first_quarter: { name: 'First Quarter', icon: 'mdi:moon-first-quarter' },
      waxing_gibbous: { name: 'Waxing Gibbous', icon: 'mdi:moon-waxing-gibbous' },
      full_moon: { name: 'Full Moon', icon: 'mdi:moon-full' },
      waning_gibbous: { name: 'Waning Gibbous', icon: 'mdi:moon-waning-gibbous' },
      last_quarter: { name: 'Last Quarter', icon: 'mdi:moon-last-quarter' },
      waning_crescent: { name: 'Waning Crescent', icon: 'mdi:moon-waning-crescent' },
    };

    let phaseKey = haMoonState && stateMap[haMoonState] ? haMoonState : null;
    if (!phaseKey) {
      if (phase < 0.03 || phase >= 0.97) phaseKey = 'new_moon';
      else if (phase < 0.22) phaseKey = 'waxing_crescent';
      else if (phase < 0.28) phaseKey = 'first_quarter';
      else if (phase < 0.47) phaseKey = 'waxing_gibbous';
      else if (phase < 0.53) phaseKey = 'full_moon';
      else if (phase < 0.72) phaseKey = 'waning_gibbous';
      else if (phase < 0.78) phaseKey = 'last_quarter';
      else phaseKey = 'waning_crescent';
    }

    const info = stateMap[phaseKey];
    return {
      phase,
      ageDays: ageDays.toFixed(1),
      illumPct,
      name: info.name,
      icon: info.icon,
      litPath16: this._buildMoonLitPath(8, 8, 6, phase),
      litPathOrb: this._buildMoonLitPath(0, 0, 4.8, phase),
    };
  }

  // Generate SVG path for the illuminated portion of a moon disc centered at (cx, cy) with radius r
  _buildMoonLitPath(cx, cy, r, phase) {
    const p = ((phase % 1) + 1) % 1;
    if (p < 0.015 || p > 0.985) {
      return '';
    }
    if (p > 0.485 && p < 0.515) {
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
    }

    const isWaxing = p < 0.5;
    const outerSweep = isWaxing ? 1 : 0;
    const rx = Math.max(0.2, r * Math.abs(Math.cos(2 * Math.PI * p)));
    const isGibbous = p > 0.25 && p < 0.75;
    const termSweep = isWaxing ? (isGibbous ? 1 : 0) : (isGibbous ? 0 : 1);

    return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${cx} ${cy - r} Z`;
  }

  // Smooth continuous C1 spline: daylight arc is 46px tall (peak at Y=18), night curve is 26px deep (trough at Y=90)
  // Shared slope at sunrise and sunset eliminates the slope kink and creates a natural, flowing celestial curve
  _evalSunY(minOfDay, riseMin, noonMin, setMin) {
    const horizonY = 64;
    const peakAmp = 46;
    const troughAmp = 26;

    const hermite = (x, x0, x1, y0, y1, m0, m1) => {
      const t = (x - x0) / Math.max(1, x1 - x0);
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const dx = x1 - x0;
      return h00 * y0 + h10 * dx * m0 + h01 * y1 + h11 * dx * m1;
    };

    const sDay = -peakAmp * 1.570796 / Math.max(1, noonMin - riseMin);
    const sNight = -troughAmp * 1.570796 / Math.max(1, riseMin);
    const sRise = (sDay + sNight) / 2;
    const sSet = -sRise;

    if (minOfDay <= riseMin) {
      return hermite(minOfDay, 0, riseMin, horizonY + troughAmp, horizonY, 0, sRise);
    } else if (minOfDay <= noonMin) {
      return hermite(minOfDay, riseMin, noonMin, horizonY, horizonY - peakAmp, sRise, 0);
    } else if (minOfDay <= setMin) {
      return hermite(minOfDay, noonMin, setMin, horizonY - peakAmp, horizonY, 0, sSet);
    } else {
      return hermite(minOfDay, setMin, 1440, horizonY, horizonY + troughAmp, sSet, 0);
    }
  }

  _buildSunGraph(nowMin, riseMin, noonMin, setMin, midnightMin, moonPhase) {
    const xStart = 14;
    const xEnd = 306;
    const spanW = xEnd - xStart;
    const horizonY = 64;

    const minToX = (m) => xStart + (m / 1440) * spanW;
    const xToMin = (x) => Math.max(0, Math.min(1440, ((x - xStart) / spanW) * 1440));

    const pts = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const m = (i / steps) * 1440;
      const x = minToX(m);
      const y = this._evalSunY(m, riseMin, noonMin, setMin);
      pts.push({ m, x, y });
    }

    const fullPath = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    const riseX = minToX(riseMin);
    const setX = minToX(setMin);
    const dayPts = pts.filter((p) => p.m >= riseMin && p.m <= setMin);
    let dayFill = `M ${riseX.toFixed(1)} ${horizonY}`;
    for (const p of dayPts) {
      dayFill += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
    dayFill += ` L ${setX.toFixed(1)} ${horizonY} Z`;

    const activePts = pts.filter((p) => p.m <= nowMin);
    const nowX = minToX(nowMin);
    const nowY = this._evalSunY(nowMin, riseMin, noonMin, setMin);
    let progPath = activePts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    progPath += ` L ${nowX.toFixed(1)} ${nowY.toFixed(1)}`;

    const noonX = minToX(noonMin);
    const noonY = this._evalSunY(noonMin, riseMin, noonMin, setMin);

    const midX = minToX(midnightMin);
    const midY = this._evalSunY(midnightMin, riseMin, noonMin, setMin);

    const moonMin = ((nowMin - moonPhase * 1440) % 1440 + 1440) % 1440;
    const rawMoonX = minToX(moonMin);
    const rawSunX = nowX;

    // Graceful separation when Sun & Moon are close
    let sunRenderX = rawSunX;
    let moonRenderX = rawMoonX;
    const minDist = 14;
    if (Math.abs(rawSunX - rawMoonX) < minDist) {
      if (rawSunX <= rawMoonX) {
        sunRenderX = Math.max(xStart + 4, rawSunX - (minDist / 2));
        moonRenderX = Math.min(xEnd - 4, rawMoonX + (minDist / 2));
      } else {
        sunRenderX = Math.min(xEnd - 4, rawSunX + (minDist / 2));
        moonRenderX = Math.max(xStart + 4, rawMoonX - (minDist / 2));
      }
    }

    const sunRenderY = this._evalSunY(xToMin(sunRenderX), riseMin, noonMin, setMin);
    const moonRenderY = this._evalSunY(xToMin(moonRenderX), riseMin, noonMin, setMin);

    return {
      fullPath,
      dayFill,
      progPath,
      riseX: riseX.toFixed(1),
      setX: setX.toFixed(1),
      noonX: noonX.toFixed(1),
      noonY: noonY.toFixed(1),
      midX: midX.toFixed(1),
      midY: midY.toFixed(1),
      sunX: sunRenderX.toFixed(1),
      sunY: sunRenderY.toFixed(1),
      moonX: moonRenderX.toFixed(1),
      moonY: moonRenderY.toFixed(1),
      horizonY,
    };
  }

  _renderSkeleton() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          --accent: #fbbf24;
          --text-primary: var(--primary-text-color, rgba(255, 255, 255, 0.9));
          --text-secondary: var(--secondary-text-color, rgba(255, 255, 255, 0.55));
          --card-bg: var(--ha-card-background, var(--card-background-color, #1c1c1e));
          --card-border: color-mix(in srgb, var(--accent) 24%, rgba(255, 255, 255, 0.08));
          --card-glow: radial-gradient(circle, color-mix(in srgb, var(--accent) 14%, transparent) 0%, transparent 72%);
          --box-bg: rgba(255, 255, 255, 0.035);
          --box-bg-hover: rgba(255, 255, 255, 0.07);
          --box-border: rgba(255, 255, 255, 0.07);
          --svg-track-stroke: rgba(255, 255, 255, 0.11);
          --svg-horizon-stroke: rgba(255, 255, 255, 0.32);
          --sun-chip-color: var(--accent);
          --sun-chip-bg: color-mix(in srgb, var(--accent) 14%, rgba(255, 255, 255, 0.04));
          --sun-chip-border: color-mix(in srgb, var(--accent) 30%, transparent);
          --moon-chip-color: #c084fc;
          --moon-chip-bg: rgba(192, 132, 252, 0.12);
          --moon-chip-border: rgba(192, 132, 252, 0.3);
          --sun-orb-fill: #18181b;
          --rise-accent: #fbbf24;
          --set-accent: #fb923c;
          --daylight-accent: #38bdf8;
          --moon-accent: #c084fc;
          --mini-moon-shadow: drop-shadow(0 0 3px rgba(192, 132, 252, 0.35));
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
        }

        :host([light-mode]),
        :host-context([data-theme="light"]),
        :host-context(html.light) {
          --text-primary: var(--primary-text-color, #0f172a);
          --text-secondary: var(--secondary-text-color, #64748b);
          --card-bg: var(--ha-card-background, var(--card-background-color, #ffffff));
          --card-border: var(--ha-card-border-color, color-mix(in srgb, var(--accent) 28%, rgba(0, 0, 0, 0.09)));
          --card-glow: radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 70%);
          --box-bg: rgba(0, 0, 0, 0.025);
          --box-bg-hover: rgba(0, 0, 0, 0.05);
          --box-border: rgba(0, 0, 0, 0.08);
          --svg-track-stroke: rgba(0, 0, 0, 0.13);
          --svg-horizon-stroke: rgba(0, 0, 0, 0.22);
          --sun-chip-color: #b45309;
          --sun-chip-bg: color-mix(in srgb, var(--accent) 14%, #ffffff);
          --sun-chip-border: color-mix(in srgb, var(--accent) 35%, rgba(0, 0, 0, 0.1));
          --moon-chip-color: #7e22ce;
          --moon-chip-bg: rgba(147, 51, 234, 0.08);
          --moon-chip-border: rgba(147, 51, 234, 0.22);
          --sun-orb-fill: #ffffff;
          --rise-accent: #d97706;
          --set-accent: #ea580c;
          --daylight-accent: #0284c7;
          --moon-accent: #9333ea;
          --mini-moon-shadow: drop-shadow(0 0 2px rgba(147, 51, 234, 0.3));
        }

        @media (prefers-color-scheme: light) {
          :host(:not([light-mode="false"])) {
            --text-primary: var(--primary-text-color, #0f172a);
            --text-secondary: var(--secondary-text-color, #64748b);
            --card-bg: var(--ha-card-background, var(--card-background-color, #ffffff));
            --card-border: var(--ha-card-border-color, color-mix(in srgb, var(--accent) 28%, rgba(0, 0, 0, 0.09)));
            --card-glow: radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 70%);
            --box-bg: rgba(0, 0, 0, 0.025);
            --box-bg-hover: rgba(0, 0, 0, 0.05);
            --box-border: rgba(0, 0, 0, 0.08);
            --svg-track-stroke: rgba(0, 0, 0, 0.13);
            --svg-horizon-stroke: rgba(0, 0, 0, 0.22);
            --sun-chip-color: #b45309;
            --sun-chip-bg: color-mix(in srgb, var(--accent) 14%, #ffffff);
            --sun-chip-border: color-mix(in srgb, var(--accent) 35%, rgba(0, 0, 0, 0.1));
            --moon-chip-color: #7e22ce;
            --moon-chip-bg: rgba(147, 51, 234, 0.08);
            --moon-chip-border: rgba(147, 51, 234, 0.22);
            --sun-orb-fill: #ffffff;
            --rise-accent: #d97706;
            --set-accent: #ea580c;
            --daylight-accent: #0284c7;
            --moon-accent: #9333ea;
            --mini-moon-shadow: drop-shadow(0 0 2px rgba(147, 51, 234, 0.3));
          }
        }

        ha-card {
          container-type: inline-size;
          container-name: card;
          position: relative;
          overflow: hidden;
          padding: 12px 13px;
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: var(--ha-card-border-radius, 16px);
          box-sizing: border-box;
          box-shadow: var(--ha-card-box-shadow, none);
        }
        ha-card::before {
          content: '';
          position: absolute;
          top: -45px;
          left: 25%;
          width: 220px;
          height: 160px;
          background: var(--card-glow);
          pointer-events: none;
          z-index: 0;
        }
        .header {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 2px;
          padding: 0 1px;
          cursor: pointer;
          flex-wrap: nowrap;
          min-width: 0;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .header-left ha-icon {
          --mdc-icon-size: 16px;
          color: var(--accent);
          flex-shrink: 0;
        }
        .title {
          font-size: 11.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-primary);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .header-badges {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: nowrap;
          margin-left: auto;
          justify-content: flex-end;
          flex-shrink: 0;
        }
        .subtitle-badge {
          font-size: 9.5px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 999px;
          white-space: nowrap;
          cursor: pointer;
          transition: transform 0.15s ease;
          flex-shrink: 0;
        }
        .subtitle-badge:hover {
          transform: translateY(-1px);
        }
        .sun-badge {
          color: var(--sun-chip-color);
          background: var(--sun-chip-bg);
          border: 1px solid var(--sun-chip-border);
        }
        .moon-badge {
          color: var(--moon-chip-color);
          background: var(--moon-chip-bg);
          border: 1px solid var(--moon-chip-border);
        }
        .sun-badge-full,
        .moon-badge-full {
          display: none;
        }
        .sun-badge-short,
        .moon-badge-short {
          display: inline;
        }
        @container card (min-width: 580px) {
          .sun-badge-full,
          .moon-badge-full {
            display: inline;
          }
          .sun-badge-short,
          .moon-badge-short {
            display: none;
          }
        }
        @container card (max-width: 420px) {
          .badge-prefix {
            display: none;
          }
        }
        @container card (max-width: 360px) {
          .subtitle-badge {
            font-size: 8.5px;
            padding: 2px 5px;
          }
        }
        .metric-box.next-event-active {
          border-color: color-mix(in srgb, var(--accent) 45%, var(--box-border));
          background: color-mix(in srgb, var(--accent) 9%, var(--box-bg));
        }
        .arc-wrap {
          position: relative;
          z-index: 1;
          width: 100%;
          margin: 0;
        }
        .arc-svg {
          width: 100%;
          height: auto;
          display: block;
          overflow: visible;
        }
        .celestial-group {
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
        }
        .celestial-group:hover circle:first-child {
          opacity: 0.45;
        }
        .status-strip {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-secondary);
          padding: 2px 2px 7px 2px;
        }
        .status-strip strong {
          color: var(--text-primary);
          font-weight: 700;
        }
        .metrics-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .metric-box {
          background: var(--box-bg);
          border: 1px solid var(--box-border);
          border-radius: 10px;
          padding: 6px 10px;
          min-width: 0;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease;
        }
        .metric-box:hover {
          background: var(--box-bg-hover);
          transform: translateY(-1px);
        }
        .metric-box.rise {
          border-left: 2.5px solid var(--rise-accent);
        }
        .metric-box.set {
          border-left: 2.5px solid var(--set-accent);
        }
        .metric-box.daylight {
          border-left: 2.5px solid var(--daylight-accent);
        }
        .metric-box.moon {
          border-left: 2.5px solid var(--moon-accent);
        }
        .metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 2px;
          min-width: 0;
        }
        .metric-label {
          font-size: 8.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .metric-box.rise .metric-label { color: var(--rise-accent); }
        .metric-box.set .metric-label { color: var(--set-accent); }
        .metric-box.daylight .metric-label { color: var(--daylight-accent); }
        .metric-box.moon .metric-label { color: var(--moon-accent); }
        .metric-sub {
          font-size: 9px;
          font-weight: 500;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
          text-align: right;
        }
        .metric-val {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.15;
          letter-spacing: -0.2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .moon-pill {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .mini-moon-svg {
          width: 13px;
          height: 13px;
          flex-shrink: 0;
          display: block;
          filter: var(--mini-moon-shadow);
        }
      </style>
      <ha-card>
        <div class="header" id="sun-header" title="Click for Sun details">
          <div class="header-left">
            <ha-icon id="card-icon" icon="mdi:weather-sunny"></ha-icon>
            <div class="title" id="card-title">SUN & MOON</div>
          </div>
          <div class="header-badges">
            <div class="subtitle-badge sun-badge" id="sun-badge" title="Click for Sun details">
              <span id="sun-badge-text">
                <span class="sun-badge-full">Sun: Above Horizon</span>
                <span class="sun-badge-short">Sun: Above Horizon</span>
              </span>
            </div>
            <div class="subtitle-badge moon-badge" id="moon-badge" title="Click for Moon details">
              <span id="moon-badge-text">
                <span class="moon-badge-full">Moon: Below Horizon</span>
                <span class="moon-badge-short">Moon: Below Horizon</span>
              </span>
            </div>
          </div>
        </div>

        <div class="arc-wrap">
          <svg class="arc-svg" viewBox="0 0 320 110">
            <defs>
              <linearGradient id="dayAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.32"/>
                <stop offset="100%" stop-color="#fb923c" stop-opacity="0.02"/>
              </linearGradient>
              <linearGradient id="curveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#a855f7"/>
                <stop offset="28%" stop-color="#fbbf24"/>
                <stop offset="50%" stop-color="#f97316"/>
                <stop offset="72%" stop-color="#fb923c"/>
                <stop offset="100%" stop-color="#38bdf8"/>
              </linearGradient>
              <filter id="sunGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="3.2" flood-color="#fbbf24"/>
              </filter>
              <filter id="moonGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="3.2" flood-color="#c084fc"/>
              </filter>
              <linearGradient id="horizonGlowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0"/>
                <stop offset="20%" stop-color="#fbbf24" stop-opacity="0.3"/>
                <stop offset="50%" stop-color="#f97316" stop-opacity="0.38"/>
                <stop offset="80%" stop-color="#fb923c" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="horizonTrackGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
                <stop offset="15%" stop-color="#ffffff" stop-opacity="0.12"/>
                <stop offset="50%" stop-color="#ffffff" stop-opacity="0.18"/>
                <stop offset="85%" stop-color="#ffffff" stop-opacity="0.12"/>
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="dayHorizonGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#fbbf24"/>
                <stop offset="50%" stop-color="#f97316"/>
                <stop offset="100%" stop-color="#fb923c"/>
              </linearGradient>
              <filter id="horizonBlur" x="-10%" y="-100%" width="120%" height="300%">
                <feGaussianBlur stdDeviation="1.8"/>
              </filter>
            </defs>

            <!-- Daylight Shaded Fill -->
            <path id="svg-day-fill" d="" fill="url(#dayAreaGrad)"/>

            <!-- Horizon Ground & Sky Boundary -->
            <g id="svg-horizon-group">
              <!-- Soft ambient glow behind horizon -->
              <line x1="12" y1="64" x2="308" y2="64" stroke="url(#horizonGlowGrad)" stroke-width="3" stroke-linecap="round" filter="url(#horizonBlur)" opacity="0.45"/>

              <!-- Crisp Thin Horizon Line across full width -->
              <line id="svg-horizon-line" x1="12" y1="64" x2="308" y2="64" stroke="var(--svg-horizon-stroke)" stroke-width="1" stroke-linecap="round"/>

              <!-- Daylight Horizon Highlight (Sunrise to Sunset) -->
              <line id="svg-daylight-horizon" x1="80" y1="64" x2="240" y2="64" stroke="url(#dayHorizonGrad)" stroke-width="1.6" stroke-linecap="round"/>

              <!-- Sunrise Reticle -->
              <g id="svg-rise-reticle" cursor="pointer">
                <title id="svg-rise-title">Sunrise</title>
                <line id="svg-rise-tick" x1="80" y1="59" x2="80" y2="69" stroke="#fbbf24" stroke-width="1.3" stroke-linecap="round"/>
                <circle id="svg-rise-ring" cx="80" cy="64" r="4.2" fill="none" stroke="#fbbf24" stroke-width="0.8" opacity="0.45"/>
                <circle id="svg-rise-dot" cx="80" cy="64" r="2.4" fill="#fbbf24"/>
              </g>

              <!-- Sunset Reticle -->
              <g id="svg-set-reticle" cursor="pointer">
                <title id="svg-set-title">Sunset</title>
                <line id="svg-set-tick" x1="240" y1="59" x2="240" y2="69" stroke="#fb923c" stroke-width="1.3" stroke-linecap="round"/>
                <circle id="svg-set-ring" cx="240" cy="64" r="4.2" fill="none" stroke="#fb923c" stroke-width="0.8" opacity="0.45"/>
                <circle id="svg-set-dot" cx="240" cy="64" r="2.4" fill="#fb923c"/>
              </g>
            </g>

            <!-- Trajectory Tracks -->
            <path id="svg-full-path" d="" fill="none" stroke="var(--svg-track-stroke)" stroke-width="1.8" stroke-linecap="round"/>
            <path id="svg-prog-path" d="" fill="none" stroke="url(#curveGrad)" stroke-width="2.5" stroke-linecap="round"/>

            <!-- Solar Peak & Midnight Dots -->
            <circle id="svg-noon-dot" cx="160" cy="18" r="2.5" fill="#f97316" opacity="0.85"/>
            <circle id="svg-mid-dot" cx="20" cy="90" r="2.3" fill="#c084fc" opacity="0.75"/>

            <!-- Sun Orb on Trajectory -->
            <g id="svg-sun-group" class="celestial-group" transform="translate(160, 64)">
              <title id="svg-sun-title">Sun</title>
              <circle id="svg-sun-halo" cx="0" cy="0" r="8.5" fill="var(--accent)" opacity="0.22"/>
              <circle id="svg-sun-orb" cx="0" cy="0" r="5" fill="var(--sun-orb-fill)" stroke="var(--accent)" stroke-width="2.2" filter="url(#sunGlow)"/>
              <circle cx="0" cy="0" r="1.8" fill="#fbbf24"/>
            </g>

            <!-- Moon Orb on Trajectory -->
            <g id="svg-moon-group" class="celestial-group" transform="translate(160, 64)">
              <title id="svg-moon-title">Moon</title>
              <circle id="svg-moon-halo" cx="0" cy="0" r="8.5" fill="#c084fc" opacity="0.24"/>
              <circle id="svg-moon-orb" cx="0" cy="0" r="5" fill="#1e1b2e" stroke="#c084fc" stroke-width="1.8" filter="url(#moonGlow)"/>
              <path id="svg-moon-line-lit" d="" fill="#e9d5ff"/>
              <circle cx="-1.2" cy="-1.2" r="0.6" fill="rgba(255,255,255,0.2)"/>
            </g>
          </svg>
        </div>

        <div class="status-strip">
          <span id="next-event-label">Next Sunset: <strong>--</strong></span>
          <span id="azimuth-label">Azimuth: <strong>--°</strong></span>
        </div>

        <div class="metrics-grid">
          <div class="metric-box rise" id="box-rise" title="Click for Sun details">
            <div class="metric-head">
              <span class="metric-label">Sunrise</span>
              <span class="metric-sub" id="dawn-sub">Dawn --:--</span>
            </div>
            <div class="metric-val" id="rise-val">--:--</div>
          </div>

          <div class="metric-box set" id="box-set" title="Click for Sun details">
            <div class="metric-head">
              <span class="metric-label">Sunset</span>
              <span class="metric-sub" id="dusk-sub">Dusk --:--</span>
            </div>
            <div class="metric-val" id="set-val">--:--</div>
          </div>

          <div class="metric-box daylight" id="box-daylight" title="Click for Sun details">
            <div class="metric-head">
              <span class="metric-label">Daylight</span>
              <span class="metric-sub" id="noon-sub">Peak --:--</span>
            </div>
            <div class="metric-val" id="daylight-val">--h --m</div>
          </div>

          <div class="metric-box moon" id="box-moon" title="Click for Moon details">
            <div class="metric-head">
              <span class="metric-label">Moon</span>
              <div class="moon-pill">
                <svg class="mini-moon-svg" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" fill="#1e1b2e" stroke="rgba(192, 132, 252, 0.6)" stroke-width="1"/>
                  <path id="moon-lit-path" d="" fill="#e9d5ff"/>
                </svg>
                <span class="metric-sub" id="moon-sub">--%</span>
              </div>
            </div>
            <div class="metric-val" id="moon-val">--</div>
          </div>
        </div>
      </ha-card>
    `;

    const openSun = () => this._openMoreInfo(this._config.entity);
    const openMoon = () => {
      const moonEntity = this._config.moon_entity || 'sensor.moon_phase';
      if (this._hass && this._hass.states[moonEntity]) {
        this._openMoreInfo(moonEntity);
      } else {
        openSun();
      }
    };

    this.shadowRoot.getElementById('sun-badge').addEventListener('click', (e) => {
      e.stopPropagation();
      openSun();
    });
    this.shadowRoot.getElementById('moon-badge').addEventListener('click', (e) => {
      e.stopPropagation();
      openMoon();
    });
    this.shadowRoot.getElementById('sun-header').addEventListener('click', openSun);
    this.shadowRoot.getElementById('box-rise').addEventListener('click', openSun);
    this.shadowRoot.getElementById('box-set').addEventListener('click', openSun);
    this.shadowRoot.getElementById('box-daylight').addEventListener('click', openSun);
    this.shadowRoot.getElementById('box-moon').addEventListener('click', openMoon);

    this.shadowRoot.getElementById('svg-rise-reticle').addEventListener('click', (e) => {
      e.stopPropagation();
      openSun();
    });
    this.shadowRoot.getElementById('svg-set-reticle').addEventListener('click', (e) => {
      e.stopPropagation();
      openSun();
    });
    this.shadowRoot.getElementById('svg-sun-group').addEventListener('click', (e) => {
      e.stopPropagation();
      openSun();
    });
    this.shadowRoot.getElementById('svg-moon-group').addEventListener('click', (e) => {
      e.stopPropagation();
      openMoon();
    });
  }

  _update() {
    if (!this._hass || !this.shadowRoot) return;

    const sunEntity = this._config.entity || 'sun.sun';
    const sunState = this._hass.states[sunEntity];
    if (!sunState) return;

    const isAbove = sunState.state === 'above_horizon';
    const attrs = sunState.attributes || {};
    const elevation = Number.isFinite(parseFloat(attrs.elevation)) ? parseFloat(attrs.elevation) : 0;
    const azimuth = Number.isFinite(parseFloat(attrs.azimuth)) ? parseFloat(attrs.azimuth) : 0;

    let isDark = true;
    if (this._config && this._config.theme_mode === 'light') {
      isDark = false;
    } else if (this._config && this._config.theme_mode === 'dark') {
      isDark = true;
    } else if (this._hass && this._hass.themes && typeof this._hass.themes.darkMode === 'boolean') {
      isDark = this._hass.themes.darkMode;
    } else if (typeof window !== 'undefined' && window.matchMedia) {
      isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
    }
    if (isDark) {
      this.removeAttribute('light-mode');
    } else {
      this.setAttribute('light-mode', '');
    }

    const accent = isDark
      ? (isAbove ? '#fbbf24' : '#38bdf8')
      : (isAbove ? '#d97706' : '#0284c7');
    this.style.setProperty('--accent', accent);

    const riseMin = this._getMinutesOfDay(attrs.next_rising, 7 * 60);
    const setMin = this._getMinutesOfDay(attrs.next_setting, 17 * 60);
    const noonMin = this._getMinutesOfDay(attrs.next_noon, 12 * 60);
    const midnightMin = this._getMinutesOfDay(attrs.next_midnight, 0);

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

    // Moon telemetry
    const moonEntityId = this._config.moon_entity || 'sensor.moon_phase';
    const moonStateObj = this._hass.states[moonEntityId];
    const moonData = this._getMoonData(moonStateObj ? moonStateObj.state : null);

    const g = this._buildSunGraph(nowMin, riseMin, noonMin, setMin, midnightMin, moonData.phase);

    const root = this.shadowRoot;
    root.getElementById('card-title').textContent = this._config.title || 'SUN & MOON';
    root.getElementById('card-icon').setAttribute('icon', isAbove ? 'mdi:weather-sunny' : 'mdi:weather-night-partly-cloudy');
    
    // Next event countdown (Sunset or Sunrise, whichever comes first)
    const nextRiseTime = attrs.next_rising ? new Date(attrs.next_rising).getTime() : Infinity;
    const nextSetTime = attrs.next_setting ? new Date(attrs.next_setting).getTime() : Infinity;
    const isRiseFirst = nextRiseTime <= nextSetTime;
    const nextEventName = isRiseFirst ? 'Sunrise' : 'Sunset';
    const nextEventIso = isRiseFirst ? attrs.next_rising : attrs.next_setting;
    const nextEventCountdown = this._formatCountdown(nextEventIso);
    const nextEventStr = `${nextEventName} ${nextEventCountdown}`;

    // Crisp, matching informative header badges for Sun and Moon
    const sunHorizonStr = isAbove ? 'Above Horizon' : 'Below Horizon';
    const sunSign = elevation >= 0 ? '+' : '';
    const sunElevStr = `${sunSign}${elevation.toFixed(1)}°`;
    const isRising = attrs.rising !== false;
    const sunMotionStr = isRising ? 'Rising' : 'Setting';

    const sunBadgeEl = root.getElementById('sun-badge-text');
    sunBadgeEl.innerHTML = `
      <span class="sun-badge-full">Sun: ${sunHorizonStr} · ${sunMotionStr} (${sunElevStr})</span>
      <span class="sun-badge-short"><span class="badge-prefix">Sun: </span>${sunHorizonStr} · ${sunElevStr}</span>
    `;
    root.getElementById('sun-badge').title = `Sun: ${sunElevStr} (${sunHorizonStr}, ${sunMotionStr}, Next ${nextEventName} ${nextEventCountdown}, Azimuth ${Math.round(azimuth)}°) · Click for details`;

    const moonAbove = parseFloat(g.moonY) < 64;
    const moonHorizonStr = moonAbove ? 'Above Horizon' : 'Below Horizon';
    const moonBadgeEl = root.getElementById('moon-badge-text');
    moonBadgeEl.innerHTML = `
      <span class="moon-badge-full">Moon: ${moonHorizonStr} · ${moonData.name} (${moonData.illumPct}%)</span>
      <span class="moon-badge-short"><span class="badge-prefix">Moon: </span>${moonHorizonStr} · ${moonData.illumPct}%</span>
    `;
    root.getElementById('moon-badge').title = `Moon: ${moonData.name} (${moonData.illumPct}% illuminated, Day ${moonData.ageDays}, ${moonHorizonStr}) · Click for details`;

    root.getElementById('svg-day-fill').setAttribute('d', g.dayFill);
    root.getElementById('svg-full-path').setAttribute('d', g.fullPath);
    root.getElementById('svg-prog-path').setAttribute('d', g.progPath);

    // Horizon line and crossing reticles
    root.getElementById('svg-daylight-horizon').setAttribute('x1', g.riseX);
    root.getElementById('svg-daylight-horizon').setAttribute('x2', g.setX);

    root.getElementById('svg-rise-tick').setAttribute('x1', g.riseX);
    root.getElementById('svg-rise-tick').setAttribute('x2', g.riseX);
    root.getElementById('svg-rise-ring').setAttribute('cx', g.riseX);
    root.getElementById('svg-rise-dot').setAttribute('cx', g.riseX);
    root.getElementById('svg-rise-title').textContent = `Sunrise: ${this._formatTime(attrs.next_rising)}`;

    root.getElementById('svg-set-tick').setAttribute('x1', g.setX);
    root.getElementById('svg-set-tick').setAttribute('x2', g.setX);
    root.getElementById('svg-set-ring').setAttribute('cx', g.setX);
    root.getElementById('svg-set-dot').setAttribute('cx', g.setX);
    root.getElementById('svg-set-title').textContent = `Sunset: ${this._formatTime(attrs.next_setting)}`;

    root.getElementById('svg-noon-dot').setAttribute('cx', g.noonX);
    root.getElementById('svg-noon-dot').setAttribute('cy', g.noonY);
    root.getElementById('svg-mid-dot').setAttribute('cx', g.midX);
    root.getElementById('svg-mid-dot').setAttribute('cy', g.midY);

    // Position Sun on the line
    const sunGroup = root.getElementById('svg-sun-group');
    sunGroup.setAttribute('transform', `translate(${g.sunX}, ${g.sunY})`);
    root.getElementById('svg-sun-title').textContent = `Sun: ${elevation >= 0 ? '+' : ''}${elevation.toFixed(1)}° (${isAbove ? 'Above' : 'Below'} Horizon)`;

    // Position Moon on the line
    const moonGroup = root.getElementById('svg-moon-group');
    moonGroup.setAttribute('transform', `translate(${g.moonX}, ${g.moonY})`);
    root.getElementById('svg-moon-line-lit').setAttribute('d', moonData.litPathOrb);
    root.getElementById('svg-moon-title').textContent = `Moon: ${moonData.name} (${moonData.illumPct}% lit, Day ${moonData.ageDays})`;

    // Countdown and azimuth
    root.getElementById('next-event-label').innerHTML = `Next ${nextEventName}: <strong>${nextEventCountdown}</strong>`;

    const compassDir = this._getCompassShort(azimuth);
    root.getElementById('azimuth-label').innerHTML = `Azimuth: <strong>${Math.round(azimuth)}° ${compassDir}</strong>`;

    root.getElementById('rise-val').textContent = this._formatTime(attrs.next_rising);
    root.getElementById('dawn-sub').textContent = `Dawn ${this._formatTime(attrs.next_dawn)}`;

    root.getElementById('set-val').textContent = this._formatTime(attrs.next_setting);
    root.getElementById('dusk-sub').textContent = `Dusk ${this._formatTime(attrs.next_dusk)}`;

    root.getElementById('box-rise').classList.toggle('next-event-active', isRiseFirst);
    root.getElementById('box-set').classList.toggle('next-event-active', !isRiseFirst);

    const daylightMin = Math.max(0, Math.round(setMin - riseMin));
    const dh = Math.floor(daylightMin / 60);
    const dm = daylightMin % 60;
    root.getElementById('daylight-val').textContent = `${dh}h ${dm}m`;
    root.getElementById('noon-sub').textContent = `Peak ${this._formatTime(attrs.next_noon)}`;

    root.getElementById('moon-val').textContent = moonData.name;
    root.getElementById('moon-sub').textContent = `${moonData.illumPct}% · Day ${moonData.ageDays}`;
    root.getElementById('moon-lit-path').setAttribute('d', moonData.litPath16);
  }
}

if (!customElements.get('sun-horizon-card')) {
  customElements.define('sun-horizon-card', SunHorizonCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'sun-horizon-card')) {
  window.customCards.push({
    type: 'sun-horizon-card',
    name: 'Sun & Moon Card',
    description: 'Minimalist horizon curve tracking the Sun and Moon with clean, spacious telemetry.',
    preview: true,
  });
}