import { useState, useMemo, useRef } from 'react';

/**
 * Interactive Cyber-FinTech Candlestick Chart with EMA overlays and Volume bars
 */
export default function CandlestickChart({ data = [], height = 320, symbol = 'RELIANCE' }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const containerRef = useRef(null);

  // Compute EMAs
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // Calculate EMA helper
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

    return data.map((d, i) => ({
      ...d,
      open: Number(d.open || d.close || 0),
      high: Number(d.high || d.close || 0),
      low: Number(d.low || d.close || 0),
      close: Number(d.close || d.price || 0),
      volume: Number(d.volume || 0),
      ema9: ema9[i],
      ema21: ema21[i],
      date: d.date || d.datetime || `D${i + 1}`,
    }));
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

  const svgWidth = 800;
  const paddingLeft = 40;
  const paddingRight = 60;
  const paddingTop = 20;
  const paddingBottom = 40;
  const mainHeight = height - paddingTop - paddingBottom;
  const volumeHeight = mainHeight * 0.22;
  const priceChartHeight = mainHeight - volumeHeight - 10;

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
    const normalized = vol / maxVolume;
    const volTop = paddingTop + priceChartHeight + 10;
    return volTop + volumeHeight - normalized * volumeHeight;
  };

  // Build SVG Path for EMAs
  const ema9Path = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.ema9)}`).join(' ');
  const ema21Path = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.ema21)}`).join(' ');

  const candleWidth = Math.max(2, Math.min(10, (svgWidth - paddingLeft - paddingRight) / chartData.length * 0.65));

  const activeCandle = hoverIndex !== null ? chartData[hoverIndex] : chartData[chartData.length - 1];

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }} ref={containerRef}>
      {/* Chart Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.5rem 0.75rem', fontSize: '0.82rem' }}>
        <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
          <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{symbol}</strong>
          <span style={{ color: activeCandle.close >= activeCandle.open ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            ₹{activeCandle.close.toFixed(2)}
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            O: <span style={{ color: 'var(--text)' }}>₹{activeCandle.open.toFixed(2)}</span>
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            H: <span style={{ color: 'var(--text)' }}>₹{activeCandle.high.toFixed(2)}</span>
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            L: <span style={{ color: 'var(--text)' }}>₹{activeCandle.low.toFixed(2)}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.72rem' }}>
          <span style={{ color: '#c4b5fd', fontWeight: 600 }}>● EMA 9</span>
          <span style={{ color: '#2dd4bf', fontWeight: 600 }}>● EMA 21</span>
          <span style={{ color: 'var(--text-dim)' }}>Vol: {activeCandle.volume.toLocaleString()}</span>
        </div>
      </div>

      {/* SVG Candlestick Canvas */}
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
              <line x1={paddingLeft} y1={y} x2={svgWidth - paddingRight} y2={y} stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="3 3" />
              <text x={svgWidth - paddingRight + 8} y={y + 3} fill="var(--text-dim)" fontSize="10" fontFamily="var(--font-mono)">
                ₹{Math.round(price)}
              </text>
            </g>
          );
        })}

        {/* Volume Grid separator */}
        <line
          x1={paddingLeft}
          y1={paddingTop + priceChartHeight + 10}
          x2={svgWidth - paddingRight}
          y2={paddingTop + priceChartHeight + 10}
          stroke="rgba(255, 255, 255, 0.08)"
        />

        {/* Volume Bars */}
        {chartData.map((d, i) => {
          const x = getX(i);
          const y = getVolumeY(d.volume);
          const isGreen = d.close >= d.open;
          const barHeight = Math.max(1, (paddingTop + priceChartHeight + 10 + volumeHeight) - y);
          return (
            <rect
              key={`vol-${i}`}
              x={x - candleWidth / 2}
              y={y}
              width={candleWidth}
              height={barHeight}
              fill={isGreen ? 'rgba(0, 230, 118, 0.22)' : 'rgba(255, 51, 102, 0.22)'}
            />
          );
        })}

        {/* EMA Lines */}
        <path d={ema9Path} fill="none" stroke="#c4b5fd" strokeWidth="1.8" opacity="0.9" />
        <path d={ema21Path} fill="none" stroke="#2dd4bf" strokeWidth="1.8" opacity="0.9" />

        {/* Candlesticks (Wick + Body) */}
        {chartData.map((d, i) => {
          const x = getX(i);
          const isGreen = d.close >= d.open;
          const color = isGreen ? '#4ade80' : '#fb7185';
          const topY = getY(Math.max(d.open, d.close));
          const botY = getY(Math.min(d.open, d.close));
          const bodyHeight = Math.max(1.5, botY - topY);

          return (
            <g
              key={`candle-${i}`}
              onMouseEnter={() => setHoverIndex(i)}
              style={{ cursor: 'crosshair' }}
            >
              {/* Wick */}
              <line x1={x} y1={getY(d.high)} x2={x} y2={getY(d.low)} stroke={color} strokeWidth="1.2" opacity="0.85" />
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

        {/* Hover Crosshair */}
        {hoverIndex !== null && (
          <g>
            <line
              x1={getX(hoverIndex)}
              y1={paddingTop}
              x2={getX(hoverIndex)}
              y2={paddingTop + priceChartHeight + 10 + volumeHeight}
              stroke="rgba(0, 212, 255, 0.5)"
              strokeDasharray="2 2"
            />
            <line
              x1={paddingLeft}
              y1={getY(activeCandle.close)}
              x2={svgWidth - paddingRight}
              y2={getY(activeCandle.close)}
              stroke="rgba(0, 212, 255, 0.5)"
              strokeDasharray="2 2"
            />
            <circle cx={getX(hoverIndex)} cy={getY(activeCandle.close)} r="3.5" fill="#c4b5fd" />
          </g>
        )}
      </svg>
    </div>
  );
}
