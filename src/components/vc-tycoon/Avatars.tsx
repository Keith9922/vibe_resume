/**
 * 玩家 / AI 头像图标 — 替代之前的小绿点小红点
 */

interface AvatarProps {
  size?: number;
  className?: string;
}

/** 玩家头像：戴礼帽的小人 */
export function HumanAvatar({ size = 28, className = "" }: AvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`vt-avatar vt-avatar-human ${className}`}
      aria-label="你"
    >
      <defs>
        <radialGradient id="vt-human-glow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#00ff9d" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#00ff9d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#vt-human-glow)" />
      {/* 头 */}
      <circle cx="16" cy="13" r="5" fill="#0a0e0d" stroke="#00ff9d" strokeWidth="1.6" />
      {/* 眼 */}
      <circle cx="14.2" cy="13" r="0.9" fill="#00ff9d" />
      <circle cx="17.8" cy="13" r="0.9" fill="#00ff9d" />
      {/* 嘴 */}
      <path d="M 14 15.2 Q 16 16.4 18 15.2" stroke="#00ff9d" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      {/* 身体 */}
      <path
        d="M 8 28 L 8 23 Q 8 18.5 11 18 L 21 18 Q 24 18.5 24 23 L 24 28 Z"
        fill="#0a0e0d"
        stroke="#00ff9d"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* 领结 */}
      <path d="M 13.5 19.5 L 16 21 L 18.5 19.5 L 18.5 22 L 16 21 L 13.5 22 Z" fill="#ffb627" />
    </svg>
  );
}

/** AI 头像：方形机器人 */
export function AIAvatar({ size = 28, className = "" }: AvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`vt-avatar vt-avatar-ai ${className}`}
      aria-label="AI"
    >
      <defs>
        <radialGradient id="vt-ai-glow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#ff4757" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ff4757" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#vt-ai-glow)" />
      {/* 天线 */}
      <line x1="16" y1="6" x2="16" y2="9" stroke="#ff4757" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="5.5" r="1.4" fill="#ff4757" />
      {/* 头部（方形） */}
      <rect x="9" y="9" width="14" height="11" rx="2" fill="#0a0e0d" stroke="#ff4757" strokeWidth="1.6" />
      {/* 眼睛（LED） */}
      <rect x="11.5" y="13" width="2.5" height="2" rx="0.5" fill="#ff4757" />
      <rect x="18" y="13" width="2.5" height="2" rx="0.5" fill="#ff4757" />
      {/* 嘴（数据接口条） */}
      <line x1="12.5" y1="17.4" x2="19.5" y2="17.4" stroke="#ff4757" strokeWidth="0.9" />
      <line x1="13.5" y1="16.4" x2="13.5" y2="18.4" stroke="#ff4757" strokeWidth="0.7" />
      <line x1="16" y1="16.4" x2="16" y2="18.4" stroke="#ff4757" strokeWidth="0.7" />
      <line x1="18.5" y1="16.4" x2="18.5" y2="18.4" stroke="#ff4757" strokeWidth="0.7" />
      {/* 身体 */}
      <rect x="11" y="20" width="10" height="7" rx="1.5" fill="#0a0e0d" stroke="#ff4757" strokeWidth="1.5" />
      {/* 胸口 LED */}
      <circle cx="16" cy="23.5" r="1.2" fill="#ff4757" />
    </svg>
  );
}

/** 通用：根据 playerId 返回对应头像 */
export function PlayerAvatar({
  playerId,
  size,
  className,
}: {
  playerId: "human" | "ai";
  size?: number;
  className?: string;
}) {
  if (playerId === "human") return <HumanAvatar size={size} className={className} />;
  return <AIAvatar size={size} className={className} />;
}
