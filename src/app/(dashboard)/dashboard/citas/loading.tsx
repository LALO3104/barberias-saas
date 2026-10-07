/** Esqueleto mientras se carga la agenda (al entrar o al cambiar de día/filtro). */
export default function CitasLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando agenda">
      <div className="space-y-2">
        <div className="h-9 w-40 animate-pulse rounded-button bg-border/60" />
        <div className="h-5 w-72 max-w-full animate-pulse rounded-button bg-border/40" />
      </div>
      <div className="h-28 animate-pulse rounded-card border border-border bg-background-secondary" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-card border border-border bg-background-secondary"
        />
      ))}
    </div>
  );
}
