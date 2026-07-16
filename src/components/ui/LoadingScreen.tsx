export default function LoadingScreen() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--sand)',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img
            src="/logo.png"
            alt="iDogs"
            style={{ height: 60, width: 200, objectFit: 'contain', display: 'inline-block' }}
          />
        </div>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    </div>
  )
}
