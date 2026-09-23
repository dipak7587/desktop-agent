import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { attempt, useUI } from '../stores';
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ children, href }) => (
            <span title={href}>
              {children}
              <ArrowUpRight size={12} className="inline-icon" />
            </span>
          ),
          img: ({ alt }) => <span>[Image: {alt}]</span>,
          pre: ({ children }) => (
            <div className="code-wrap">
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  detail,
  onConfirm,
  onClose,
}: {
  title: string;
  detail: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      {error && <p className="error-text">{error}</p>}
      <p className="muted">{detail}</p>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              setError('');
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
    </header>
  );
}
export function CopyButton({ text }: { text: string }) {
  return (
    <button
      className="text-button"
      onClick={() =>
        void attempt(async () => {
          await navigator.clipboard.writeText(text);
          useUI.setState({ notice: 'Copied to clipboard' });
        })
      }
    >
      Copy
    </button>
  );
}
