import { createContext, useContext } from "react";
import type { ProgressData } from "./types";
type StudyContextType = {
  data: ProgressData;
  change: (update: (draft: ProgressData) => void) => Promise<ProgressData>;
  notify: (message: string) => void;
  busy: boolean;
  saving: boolean;
  setBusy: (busy: boolean) => void;
};
export const StudyContext = createContext<StudyContextType | null>(null);
export function useStudy() {
  const context = useContext(StudyContext);
  if (!context) throw new Error("Study context is missing.");
  return context;
}
