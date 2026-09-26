// 共通部品：アイコン、ボタン、ヘッダー、ダイアログ、トースト、空状態。
import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';

type IconName =
  | 'arrow'
  | 'back'
  | 'sound'
  | 'mute'
  | 'pause'
  | 'trophy'
  | 'drop'
  | 'download'
  | 'share'
  | 'lid'
  | 'check'
  | 'gear'
  | 'copy'
  | 'image'
  | 'close'
  | 'external';

const PATHS: Record<IconName, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'm14 6-6 6 6 6',
  sound: 'M4 10h4l5-4v12l-5-4H4zM17 8q6 4 0 8',
  mute: 'M4 10h4l5-4v12l-5-4H4zM17 9l5 6m0-6-5 6',
  pause: 'M9 6v12M15 6v12',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v3q0 4 5 4M16 6h4v3q0 4-5 4M12 14v6M8 20h8',
  drop: 'M12 3c-4 0-8 8-8 12a8 8 0 0 0 16 0c0-4-4-12-8-12z',
  download: 'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  lid: 'M3 17h18M5 15a7 7 0 0 1 14 0M10 6h4',
  check: 'm5 12 4 4L19 6',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  close: 'M6 6l12 12M18 6 6 18',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

type Variant = 'primary' | 'yolk' | 'dark' | 'outline' | 'ghost';

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant} ${className ?? ''}`} aria-busy={loading || undefined} disabled={rest.disabled || loading}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, onClick, pressed, className }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean; className?: string }) {
  return (
    <button type="button" className={`icon-btn ${className ?? ''}`} aria-label={label} aria-pressed={pressed} onClick={onClick} title={label}>
      <span className="icon-btn-circle">
        <Icon name={icon} />
      </span>
    </button>
  );
}

export function EggMark({ small }: { small?: boolean }) {
  return (
    <span className={`eggmark ${small ? 'eggmark-small' : ''}`} aria-hidden="true">
      <i />
    </span>
  );
}

export function AppHeader({ left, title, right, id }: { left?: ReactNode; title: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <header className="apphead">
      <div className="apphead-side">{left}</div>
      <h1 className="apphead-title" id={id} tabIndex={-1}>
        {title}
      </h1>
      <div className="apphead-side apphead-right">{right}</div>
    </header>
  );
}

/** ネイティブ<dialog>によるモーダル（Escキーとフォーカス管理はブラウザに任せる） */
export function Dialog({
  open,
  onClose,
  labelledBy,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

export interface ToastItem {
  id: number;
  text: string;
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        <Icon name="drop" size={26} />
      </span>
      <p className="empty-title">{title}</p>
      {text && <p className="muted">{text}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
