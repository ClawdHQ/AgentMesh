/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        orchestrator: '#a855f7',
        specialist: '#14b8a6',
        vendor: '#f97316',
        human: '#f59e0b',
        danger: '#ef4444',
        success: '#22c55e',
        mesh: {
          50: '#f0f9ff',
          900: '#0c1a2e',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
