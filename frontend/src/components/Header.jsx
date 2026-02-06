function Header({ title, subtitle, onLogout }) {
  return (
    <header className="header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="muted">{subtitle}</div> : null}
      </div>
      <div className="header-actions">
        <button className="btn-secondary" onClick={onLogout}>
          Salir
        </button>
      </div>
    </header>
  );
}

export default Header;
