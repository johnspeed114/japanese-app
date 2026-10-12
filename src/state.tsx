import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getProgress, recoverStorage, updateProgress } from "./storage";
import type { ProgressData } from "./types";
import { StudyContext } from "./study-context";
export function StudyProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);
  const reloadSequence = useRef(0);
  useEffect(() => {
    let alive = true;
    const reload = async () => {
      const seq = ++reloadSequence.current;
      try {
        const value = await getProgress();
        if (alive && seq === reloadSequence.current) setData(value);
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Storage could not be opened.",
          );
      }
    };
    void recoverStorage()
      .then(reload)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Storage could not be opened.",
        ),
      );
    window.addEventListener("study-change", reload);
    return () => {
      alive = false;
      window.removeEventListener("study-change", reload);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const change = async (update: (draft: ProgressData) => void) => {
    setPendingWrites((count) => count + 1);
    try {
      const value = await updateProgress(update);
      setData(value);
      return value;
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Your change could not be saved. Please export a backup and check device storage.";
      setNotice(message);
      throw e;
    } finally {
      setPendingWrites((count) => count - 1);
    }
  };
  if (!data)
    return (
      <main className="loading">
        <div className="brand-mark" lang="ja">
          帰
        </div>
        <h1>
          {error
            ? "Your study space could not open"
            : "Opening your study space…"}
        </h1>
        {error && (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <p>
              Check that browser storage is allowed. Private browsing may remove
              saved work when closed.
            </p>
            <button className="button" onClick={() => location.reload()}>
              Try again
            </button>
          </>
        )}
      </main>
    );
  return (
    <StudyContext.Provider
      value={{
        data,
        change,
        notify: setNotice,
        busy,
        saving: pendingWrites > 0,
        setBusy,
      }}
    >
      {children}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}
    </StudyContext.Provider>
  );
}
