/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#ea580c",
          hover: "#c2410c",
        },
        coal: {
          DEFAULT: "#1c1917",
          light: "#292524",
        },
        ember: {
          DEFAULT: "#ea580c",
          hover: "#c2410c",
          glow: "#fdba74",
        },
        flame: "#f97316",
        spark: "#fef3c7",
        mist: "#faf6f2",
      },
      boxShadow: {
        ember: "0 4px 24px -4px rgb(234 88 12 / 0.25)",
      },
    },
  },
  plugins: [],
};
