import { lazy, Suspense, type ComponentProps } from 'react';

// O leitor de PDF (e o PDF.js, o maior pedaço do app) só é baixado quando um PDF é aberto.
const Viewer = lazy(() => import('./PdfViewer.tsx').then((m) => ({ default: m.PdfViewer })));

export function PdfViewer(props: ComponentProps<typeof Viewer>) {
  return <Suspense fallback={<div className="spinner" />}><Viewer {...props} /></Suspense>;
}
