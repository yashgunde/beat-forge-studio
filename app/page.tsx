'use client';

import dynamic from 'next/dynamic';

const DAWShell = dynamic(() => import('@/components/daw/DAWShell'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-daw-bg relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute rounded-full"
        style={{
          width: '40%',
          height: '40%',
          top: '30%',
          left: '30%',
          background: 'radial-gradient(circle, var(--daw-glow-color-strong) 0%, transparent 70%)',
          animation: 'gentlePulse 3s ease-in-out infinite',
        }}
      />
      <div className="text-center relative z-10">
        <div className="text-daw-accent text-3xl font-bold mb-3 neon-accent tracking-widest">
          YGBeatz
        </div>
        <div className="text-daw-textMuted text-xs tracking-wider">
          Initializing Audio Engine...
        </div>
        <div className="mt-5 flex gap-1.5 justify-center">
          {[0,1,2,3,4].map(i => (
            <div
              key={i}
              className="w-1.5 h-8 rounded-full"
              style={{
                background: 'var(--daw-accent)',
                animation: `pulse 1s ease-in-out ${i * 0.15}s infinite alternate`,
                opacity: 0.3,
                boxShadow: '0 0 8px var(--daw-glow-color)',
              }}
            />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes gentlePulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50%      { opacity: 0.6; transform: scale(1.05); }
        }
      `}</style>
    </div>
  ),
});

export default function Home() {
  return <DAWShell />;
}
