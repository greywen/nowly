import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#009ef7',
        ink: '#181c32',
        muted: '#7e8299'
      },
      boxShadow: {
        soft: '0 12px 32px rgba(76, 87, 125, 0.10)',
        modal: '0 28px 80px rgba(24, 28, 50, 0.26)'
      },
      borderRadius: {
        panel: '20px'
      }
    }
  },
  plugins: []
} satisfies Config;
