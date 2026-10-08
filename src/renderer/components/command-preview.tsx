import { useEffect, useId, useRef } from 'react';

export function CommandPreview({ command }: { command: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hide = () => tooltip.current?.hidePopover();
  const show = () => {
    const target = trigger.current;
    const tip = tooltip.current;
    if (!target || !tip || !command.trim()) return;
    const rect = target.getBoundingClientRect();
    tip.style.width = `${Math.min(600, window.innerWidth - 24)}px`;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const useBelow = below >= Math.min(200, above);
    tip.style.maxHeight = `${Math.max(40, useBelow ? below : above)}px`;
    tip.showPopover();
    tip.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 12))}px`;
    tip.style.top = `${useBelow ? rect.bottom : Math.max(12, rect.top - tip.offsetHeight)}px`;
  };
  useEffect(() => {
    const onScroll = (event: Event) => {
      if (event.target !== tooltip.current) hide();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
    };
  }, []);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="command-line"
        aria-describedby={id}
        onMouseEnter={show}
        onFocus={show}
        onClick={show}
        onBlur={hide}
        onMouseLeave={(event) => {
          if (
            !(
              event.relatedTarget instanceof Node && tooltip.current?.contains(event.relatedTarget)
            ) &&
            document.activeElement !== trigger.current
          )
            hide();
        }}
      >
        <code>{command || 'No command configured'}</code>
      </button>
      <div
        ref={tooltip}
        id={id}
        role="tooltip"
        popover="auto"
        className="command-tooltip"
        onMouseLeave={(event) => {
          if (
            !(
              event.relatedTarget instanceof Node && trigger.current?.contains(event.relatedTarget)
            ) &&
            document.activeElement !== trigger.current
          )
            hide();
        }}
      >
        {command}
      </div>
    </>
  );
}
