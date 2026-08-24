import { CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";

type ToastDetail = { message: string };

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent<ToastDetail>("homix:toast", { detail: { message } }));
}

export function ToastProvider({ children }: React.PropsWithChildren) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timeout: number | undefined;
    const receive = (event: Event) => {
      setMessage((event as CustomEvent<ToastDetail>).detail.message);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setMessage(null), 4_000);
    };
    window.addEventListener("homix:toast", receive);
    return () => {
      window.removeEventListener("homix:toast", receive);
      window.clearTimeout(timeout);
    };
  }, []);
  return (
    <>
      {children}
      {message ? (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 />
          <span>{message}</span>
          <button aria-label="Dismiss notification" onClick={() => setMessage(null)}>
            <X />
          </button>
        </div>
      ) : null}
    </>
  );
}
