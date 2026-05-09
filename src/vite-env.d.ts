/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY: string;
  readonly VITE_OPENROUTER_BASE_URL: string;
  readonly VITE_OPENROUTER_MODEL: string;
  readonly VITE_OPENROUTER_REASONING_EFFORT: string;
  readonly VITE_OPENROUTER_HTTP_REFERER: string;
  readonly VITE_OPENROUTER_APP_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
