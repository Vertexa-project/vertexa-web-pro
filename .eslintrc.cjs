module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs", "vite.config.ts", "tailwind.config.ts", "postcss.config.js"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    // Dados de saúde: não logar informações sensíveis em produção.
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  },
  overrides: [
    {
      // Primitivos shadcn co-localizam componente + variantes (cva) por design.
      files: ["src/components/ui/**/*.tsx"],
      rules: { "react-refresh/only-export-components": "off" },
    },
  ],
};
