export default function Spinner({ size = 8 }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ height: '100vh', background: '#0f0f13' }}
    >
      <div
        className="spinner rounded-full border-2"
        style={{
          width: `${size * 4}px`,
          height: `${size * 4}px`,
          borderColor: '#6366f1',
          borderTopColor: 'transparent',
        }}
      />
    </div>
  );
}
