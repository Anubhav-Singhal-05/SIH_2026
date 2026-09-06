/** @type {import('tailwindcss').Config} */
export default {
  content: [
'./index.html',
'./src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        base: { 950:'#0b0c0e', 900:'#0d0e10', 850:'#111316', 800:'#16181c', 750:'#191c20' },
        steel: { 950:'#1c1f24', 900:'#23262c', 800:'#2b2f36', 700:'#3a3f47', 600:'#4a505a', 500:'#6b717c', 400:'#8b8f96', 300:'#b8bcc2', 200:'#d4d7db', 100:'#e8eaed' },
        accent: { DEFAULT:'#5b7fa6', dim:'#46617e', deep:'#35485c', bright:'#7ba3c9' },
        ok: '#5f8f6a',
        warn: '#b08d4f',
        bad: '#a35d52',
        idle: '#565b64',
      },
      fontFamily: {
        sans: ['Inter','IBM Plex Sans','system-ui','sans-serif'],
        mono: ['JetBrains Mono','IBM Plex Mono','ui-monospace','Consolas','monospace'],
      },
      borderRadius: { DEFAULT:'3px' },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.45)',
        pop: '0 6px 18px rgba(0,0,0,0.55)',
      },
    },
  },
  plugins: [],
}