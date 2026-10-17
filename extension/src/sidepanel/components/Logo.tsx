// Tunes logomark: three white arcs on a blue gradient tile (the user's chosen mark, 15 Oct 2026).
const ARCS = 'M6.73729 316.937C20.201 294.159 49.6986 286.649 72.4033 300.174H72.4277C237.603 398.282 510.121 407.302 667.823 359.439C693.147 351.759 719.927 366.055 727.602 391.378C735.276 416.715 720.992 443.477 695.649 451.176C514.618 506.132 213.674 495.514 23.5058 382.622C0.678772 369.103 -6.78757 339.685 6.73729 316.937ZM77.8135 154.865C89.38 136.046 113.982 130.11 132.77 141.676C270.528 226.369 480.519 250.891 643.46 201.43C664.592 195.047 686.911 206.957 693.324 228.052C699.689 249.184 687.774 271.46 666.679 277.886C480.555 334.36 249.169 307.004 90.9707 209.79C72.1827 198.224 66.247 173.628 77.8135 154.865ZM140.542 15.3012C149.722 0.246392 169.428 -4.52761 184.482 4.71335C304.811 78.2128 456.29 94.8593 634.684 54.101C651.874 50.1843 669.01 60.9551 672.927 78.1518C676.862 95.3486 666.134 112.484 648.9 116.401C453.677 161.021 286.219 141.799 151.129 59.2417C136.074 50.0006 131.301 30.3561 140.542 15.3012Z';

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" className="logomark">
      <defs>
        <linearGradient id="tn-grad" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1388FF" />
          <stop offset="1" stopColor="#0652FF" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="230" fill="url(#tn-grad)" />
      <g transform="translate(136 270.5)">
        <path fill="#fff" d={ARCS} />
      </g>
    </svg>
  );
}

/** The app's header mark: white arcs, no tile (as in Tunes's top bar). */
export function Arcs({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size * 484 / 730} viewBox="0 0 730 484" aria-hidden="true" className="arcs">
      <path fill="currentColor" d={ARCS} />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text">Bit<b>Chord</b></span>
    </span>
  );
}
