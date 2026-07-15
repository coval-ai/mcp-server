module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    jest: true,
  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    // TypeScript owns unused-symbol analysis; the base rule mishandles constructor parameter properties.
    "no-unused-vars": "off",
  },
  ignorePatterns: ["dist/", "coverage/", "node_modules/"],
};
