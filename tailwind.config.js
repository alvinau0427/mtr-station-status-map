/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b2545',
        panel: 'rgba(255, 255, 255, 0.95)',
      },
    },
  },
  plugins: [],
};
