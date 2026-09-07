// Shared utilities — import from here instead of re-defining per file

export function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatStrategy(value) {
  if (!value) return 'Strategy';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export const QUICK_STOCKS = [
  { sym: 'RELIANCE',   sector: 'Energy & Retail'  },
  { sym: 'SBIN',       sector: 'Public Banking'    },
  { sym: 'TCS',        sector: 'IT Services'       },
  { sym: 'INFY',       sector: 'Tech & Cloud'      },
  { sym: 'ITC',        sector: 'FMCG & Hotels'     },
  { sym: 'TATAMOTORS', sector: 'Automotive & EV'   },
];
