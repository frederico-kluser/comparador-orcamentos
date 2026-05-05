/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEEPSEEK_API_KEY: string;
  readonly VITE_DEEPSEEK_BASE_URL: string;
  readonly VITE_DEEPSEEK_MODEL_CLASSIFY: string;
  readonly VITE_DEEPSEEK_MODEL_MATCH: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
