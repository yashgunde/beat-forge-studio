import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        daw: {
          bg: 'var(--daw-bg)',
          panel: 'var(--daw-panel)',
          card: 'var(--daw-card)',
          border: 'var(--daw-border)',
          accent: 'var(--daw-accent)',
          accentDark: 'var(--daw-accent-dark)',
          accentLight: 'var(--daw-accent-light)',
          green: 'var(--daw-green)',
          red: 'var(--daw-red)',
          blue: 'var(--daw-blue)',
          purple: 'var(--daw-purple)',
          text: 'var(--daw-text)',
          textMuted: 'var(--daw-text-muted)',
          stepOn: 'var(--daw-step-on)',
          stepOff: 'var(--daw-step-off)',
          stepHover: 'var(--daw-step-hover)',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
