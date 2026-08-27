import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The pre-existing shim deliberately uses dynamic API payloads and has
      // legacy unused compatibility helpers; keep this restoration focused on
      // executable linting rather than a broad G5 cleanup.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
