import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthGate } from "./AuthGate.js";
import { ToastProvider } from "../components/ui/Toast.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

export function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthGate />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
