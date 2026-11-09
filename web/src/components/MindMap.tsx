import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export const MAP_COLORS = ['var(--cyan)', 'var(--violet)', 'var(--lime)', 'var(--orange)', 'var(--magenta)'];
// Abaixo desta largura o mapa vira árvore (tema em cima, ramos embaixo): lado a lado os ramos ficariam estreitos demais.
const RADIAL_MIN = 720;

type Branch = { topico: string; itens: string[] };

// Mapa mental do tema, desenhado só a partir do `esquema` da apostila (sem imagem gerada nem chamada à API).
// Com espaço: tema no centro, ramos dos dois lados (leitura em sentido horário, começando pela direita) ligados por curvas
// coloridas. Sem espaço: árvore vertical.
export function MindMap({ title, branches }: { title: string; branches: Branch[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [links, setLinks] = useState<{ d: string; color: string }[]>([]);
  const half = Math.ceil(branches.length / 2);
  const color = (i: number) => MAP_COLORS[i % MAP_COLORS.length]!;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const isWide = el.clientWidth >= RADIAL_MIN;
      setWide(isWide);
      const center = el.querySelector('.mm-center')?.getBoundingClientRect();
      if (!isWide || !center || !el.classList.contains('radial')) { setLinks([]); return; }
      const root = el.getBoundingClientRect(), cy = center.top + center.height / 2 - root.top;
      setLinks([...el.querySelectorAll<HTMLElement>('.mm-branch')].map((b) => {
        const r = b.getBoundingClientRect(), left = r.right <= center.left;
        const x1 = (left ? center.left : center.right) - root.left, x2 = (left ? r.right : r.left) - root.left;
        const y2 = r.top + r.height / 2 - root.top, mx = (x1 + x2) / 2;
        return { d: `M${x1},${cy} C${mx},${cy} ${mx},${y2} ${x2},${y2}`, color: color(Number(b.dataset.i)) };
      }));
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title, branches, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const node = (b: Branch, i: number) => (
    <div key={i} data-i={i} className="mm-branch" style={{ '--c': color(i) } as CSSProperties}>
      <b>{b.topico}</b><ul>{b.itens.map((x, j) => <li key={j}>{x}</li>)}</ul>
    </div>
  );
  if (!wide) return (
    <div ref={box} className="mindmap">
      <div className="mm-center">{title}</div>
      <div className="mm-trunk" />
      <div className="mm-branches">{branches.map(node)}</div>
    </div>
  );
  return (
    <div ref={box} className="mindmap radial">
      <svg className="mm-links" aria-hidden="true">{links.map((l, i) => <path key={i} d={l.d} style={{ stroke: l.color }} />)}</svg>
      <div className="mm-center">{title}</div>
      <div className="mm-side right">{branches.slice(0, half).map((b, i) => node(b, i))}</div>
      <div className="mm-side left">{branches.slice(half).map((b, i) => node(b, half + i))}</div>
    </div>
  );
}
