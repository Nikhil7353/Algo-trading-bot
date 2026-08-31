import { useState, useMemo, useRef } from 'react';

/**
 * Interactive Quant TradingView-Grade Candlestick Chart
 * Supports EMA 9 / EMA 21, VWAP, Volume Bars, Crosshair, and Live Overlays
 */
export default function CandlestickChart({ data = [], height = 340, symbol = 'RELIANCE' }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [showEMA9, setShowEMA9] = useState(true);
  const [showEMA21, setShowEMA21] = useState(true);
  const [showVWAP, setShowVWAP] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const containerRef = useRef(null);

  // Compute EMAs and VWAP
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const calcEMA = (period, values) => {
      const k = 2 / (period + 1);
      const emaArr = [];
      let ema = values[0];
      for (let i = 0; i < values.length; i++) {
        if (i === 0) {
          ema = values[0];
        } else {
          ema = values[i] * k + ema * (1 - k);
        }
        emaArr.push(ema);
      }
      return emaArr;
    };

    const closes = data.map((d) => Number(d.close || d.price || 0));
    const ema9 = calcEMA(9, closes);
    const ema21 = calcEMA(21, closes);

    // Cumulative VWAP
    let cumVol = 0;
    let cumVolPrice = 0;
    const vwapArr = data.map((d) => {
      const typical = (Number(d.high || d.close) + Number(d.low || d.close) + Number(d.close || d.price || 0)) / 3;
      const vol = Math.max(1, Number(d.volume || 100));
      cumVol += vol;
      cumVolPrice += typical * vol;
      return cumVol > 0 ? cumVolPrice / cumVol : typical;
    });

    return data.map((d, i) => {
      const open = Number(d.open || d.close || 0);
      const close = Number(d.close || d.price || 0);
      const changePct = open > 0 ? ((close - open) / open) * 100 : 0;

      return {
        ...d,
        open,
        high: Number(d.high || Math.max(open, close)),
        low: Number(d.low || Math.min(open, close)),
        close,
        volume: Number(d.volume || 0),
        changePct,
        ema9: ema9[i],
        ema21: ema21[i],
        vwap: vwapArr[i],
        date: d.date || d.datetime || `Bar ${i + 1}`,
      };
    });
  }, [data]);

  // Calculate Price and Volume bounds
  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    if (chartData.length === 0) return { minPrice: 0, maxPrice: 100, maxVolume: 100 };
    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;

    chartData.forEach((d) => {
      if (d.low < min) min = d.low;
      if (d.high > max) max = d.high;
      if (d.volume > maxVol) maxVol = d.volume;
    });

    const padding = (max - min) * 0.08 || 5;
    return {
      minPrice: Math.max(0, min - padding),
      maxPrice: max + padding,
      maxVolume: maxVol || 1,
    };
  }, [chartData]);

  if (!chartData || chartData.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
        No candlestick data available for chart.
      </div>
    );
  }

  const svgWidth = 840;
  const paddingLeft = 40;
  const paddingRight = 65;
  const paddingTop = 20;
  const paddingBottom = showVolume ? 45 : 25;
  const mainHeight = height - paddingTop - paddingBottom;
  const volumeHeight = showVolume ? mainHeight * 0.22 : 0;
  const priceChartHeight = mainHeight - volumeHeight - (showVolume ? 10 : 0);

  const getX = (index) => {
    const usableWidth = svgWidth - paddingLeft - paddingRight;
    const step = usableWidth / Math.max(1, chartData.length - 1);
    return paddingLeft + index * step;
  };

  const getY = (price) => {
    const range = maxPrice - minPrice || 1;
    const normalized = (price - minPrice) / range;
    return paddingTop + priceChartHeight - normalized * priceChartHeight;
  };

  const getVolumeY = (vol) => {
    if (!showVolume) return 0;
    const normalized = vol / maxVolume;
    const volTop = paddingTop + priceChartHeight + 10;
    return volTop + volumeHeight - normalized * volumeHeight;
  };

  // Build SVG Paths for Indicators
  const ema9Path = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.ema9)}`).join(' ');
  const ema21Path = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.ema21)}`).join(' ');
  const vwapPath = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.vwap)}`).join(' ');

  const candleWidth = Math.max(3, Math.min(12, ((svgWidth - paddingLeft - paddingRight) / chartData.length) * 0.68));
  const activeCandle = hoverIndex !== null ? chartData[hoverIndex] : chartData[chartData.length - 1];

  return (
    <div className="quant-candlestick-container" ref={containerRef}>
      {/* Chart Control Toolbar */}
      <div className="chart-toolbar-row">
        {/* Left: Active Candle Quick Stats */}
        <div className="chart-quote-info">
          <strong className="quote-sym">{symbol}</strong>
          <span className={`quote-price ${activeCandle.close >= activeCandle.open ? 'pos' : 'neg'}`}>
            ₹{activeCandle.close.toFixed(2)}
          </span>
          <span className={`quote-chg ${activeCandle.changePct >= 0 ? 'pos' : 'neg'}`}>
            {activeCandle.changePct >= 0 ? '+' : ''}{activeCandle.changePct.toFixed(2)}%
          </span>
          <div className="quote-ohlc-chips">
            <span>O: <strong>{activeCandle.open.toFixed(2)}</strong></span>
            <span>H: <strong>{activeCandle.high.toFixed(2)}</strong></span>
            <span>L: <strong>{activeCandle.low.toFixed(2)}</strong></span>
            <span>Vol: <strong>{activeCandle.volume.toLocaleString()}</strong></span>
          </div>
        </div>

        {/* Right: Technical Indicator Toggles */}
        <div className="chart-indicator-toggles">
          <button
            type="button"
            className={`indicator-toggle-btn ${showEMA9 ? 'active ema9' : ''}`}
            onClick={() => setShowEMA9(!showEMA9)}
          >
            ● EMA 9
          </button>
          <button
            type="button"
            className={`indicator-toggle-btn ${showEMA21 ? 'active ema21' : ''}`}
            onClick={() => setShowEMA21(!showEMA21)}
          >
            ● EMA 21
          </button>
          <button
            type="button"
            className={`indicator-toggle-btn ${showVWAP ? 'active vwap' : ''}`}
            onClick={() => setShowVWAP(!showVWAP)}
          >
            ● VWAP
          </button>
          <button
            type="button"
            className={`indicator-toggle-btn ${showVolume ? 'active vol' : ''}`}
            onClick={() => setShowVolume(!showVolume)}
          >
            📊 Vol
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        viewBox={`0 0 ${svgWidth} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Horizontal Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const price = minPrice + (maxPrice - minPrice) * (1 - ratio);
          const y = paddingTop + ratio * priceChartHeight;
          return (
            <g key={ratio}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="rgba(255, 255, 255, 0.06)"
                strokeDasharray="3 3"
              />
              <text
                x={svgWidth - paddingRight + 8}
                y={y + 3}
                fill="#8b7db0"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                ₹{Math.round(price)}
              </text>
            </g>
          );
        })}

        {/* Volume Grid separator */}
        {showVolume && (
          <line
            x1={paddingLeft}
            y1={paddingTop + priceChartHeight + 10}
            x2={svgWidth - paddingRight}
            y2={paddingTop + priceChartHeight + 10}
            stroke="rgba(255, 255, 255, 0.08)"
          />
        )}

        {/* Volume Bars */}
        {showVolume &&
          chartData.map((d, i) => {
            const x = getX(i);
            const y = getVolumeY(d.volume);
            const isGreen = d.close >= d.open;
            const barHeight = Math.max(1, paddingTop + priceChartHeight + 10 + volumeHeight - y);
            return (
              <rect
                key={`vol-${i}`}
                x={x - candleWidth / 2}
                y={y}
                width={candleWidth}
                height={barHeight}
                fill={isGreen ? 'rgba(74, 222, 128, 0.28)' : 'rgba(251, 113, 133, 0.28)'}
                rx="1"
              />
            );
          })}

        {/* Indicator Lines */}
        {showEMA9 && <path d={ema9Path} fill="none" stroke="#22d3ee" strokeWidth="1.8" opacity="0.9" />}
        {showEMA21 && <path d={ema21Path} fill="none" stroke="#c084fc" strokeWidth="1.8" opacity="0.9" />}
        {showVWAP && <path d={vwapPath} fill="none" stroke="#fbbf24" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.85" />}

        {/* Candlesticks (Wick + Body) */}
        {chartData.map((d, i) => {
          const x = getX(i);
          const isGreen = d.close >= d.open;
          const color = isGreen ? '#4ade80' : '#fb7185';
          const topY = getY(Math.max(d.open, d.close));
          const botY = getY(Math.min(d.open, d.close));
          const bodyHeight = Math.max(1.8, botY - topY);

          return (
            <g
              key={`candle-${i}`}
              onMouseEnter={() => setHoverIndex(i)}
              style={{ cursor: 'crosshair' }}
            >
              {/* Wick */}
              <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke={color} strokeWidth="1.3" opacity="0.85" />
              {/* Body */}
              <rect
                x={x - candleWidth / 2}
                y={topY}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                rx="1"
              />
            </g>
          );
        })}

        {/* Hover Crosshair & Data Callout */}
        {hoverIndex !== null && (
          <g>
            <line
              x1={getX(hoverIndex)}
              y1={paddingTop}
              x2={getX(hoverIndex)}
              y2={paddingTop + priceChartHeight + (showVolume ? 10 + volumeHeight : 0)}
              stroke="rgba(196, 181, 253, 0.45)"
              strokeDasharray="2 2"
            />
            <line
              x1={paddingLeft}
              y1={getY(activeCandle.close)}
              x2={svgWidth - paddingRight}
              y2={getY(activeCandle.close)}
              stroke="rgba(196, 181, 253, 0.45)"
              strokeDasharray="2 2"
            />
            <circle cx={getX(hoverIndex)} cy={getY(activeCandle.close)} r="4" fill="#2dd4bf" stroke="#050414" strokeWidth="2" />
          </g>
        )}
      </svg>
    </div>
  );
}
