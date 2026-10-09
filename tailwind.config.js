/** @type {import('tailwindcss').Config} */
module.exports = {
  // Path to scan for Tailwind CSS utility classes
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2D6A4F",
          dark: "#1B4332",
          light: "#E8F5E9",
        },
        secondary: {
          DEFAULT: "#D47A3A",
          light: "#FFF3E0",
        },
        accent: {
          gold: "#E9C46A",
          indigo: "#1D3557",
        },
        surface: {
          light: "#FDFBF7",
          dark: "#121212",
        },
      },
    },
  },
  plugins: [],
};
