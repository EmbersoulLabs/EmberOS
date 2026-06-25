/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0A2540",
          light: "#0F3460",
        },
        brand: {
          blue: "#2563EB",
          teal: "#14B8A6",
          amber: "#F59E0B",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F8FAFC",
        },
        border: {
          DEFAULT: "#E5E7EB",
        },
        ink: {
          DEFAULT: "#111827",
          secondary: "#6B7280",
        },
        /* Legacy aliases — map to new brand */
        primary: {
          DEFAULT: "#0A2540",
          hover: "#0F3460",
        },
        coal: {
          DEFAULT: "#0A2540",
          light: "#0F3460",
        },
        ember: {
          DEFAULT: "#2563EB",
          hover: "#1D4ED8",
        },
        flame: "#14B8A6",
        spark: "#F59E0B",
        mist: "#F8FAFC",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        elevated: "0 4px 24px -4px rgb(10 37 64 / 0.12)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
