import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O app fica em web/; shared/ (schemas e domínio) é importado por caminho relativo.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
