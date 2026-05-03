"use client";

/**
 * Pre-flight modal — shown before opening the full-screen voice mode.
 * Explains what's about to happen and asks for mic permission upfront.
 *
 * Why a separate step: the browser's native mic permission prompt is jarring
 * if it pops mid-conversation. Asking explicitly first sets expectations.
 */

type Props = {
  open: boolean;
  onCancel: () => void;
  onProceed: () => void;
};

export function PreflightModal({ open, onCancel, onProceed }: Props) {
  if (!open) return null;
  return (
    <div className="preflight-backdrop" onClick={onCancel} role="presentation">
      <div className="preflight-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="preflight-icon" aria-hidden>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <h2 className="preflight-title">准备开始语音聊天</h2>
        <p className="preflight-body">
          接下来浏览器会请求**麦克风权限**——允许之后，就像和朋友打电话一样自然聊就好。
          你说什么 AI 都听得到，**说完会自动收尾**，不用按按钮。
        </p>
        <ul className="preflight-tips">
          <li>找个安静的地方</li>
          <li>聊到差不多 AI 会主动建议整理简历</li>
          <li>随时可以点右上角的「挂断」</li>
        </ul>
        <div className="preflight-actions">
          <button className="btn btn-text" type="button" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" type="button" onClick={onProceed}>
            允许并开始 <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
