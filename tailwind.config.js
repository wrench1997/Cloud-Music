module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1db954',
        dark: '#1a1a1a',
        darker: '#121212',
        light: '#b3b3b3'
      }
    },
  },
  plugins: [],
}