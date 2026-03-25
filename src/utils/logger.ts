const timestamp = () => new Date().toISOString();

export const logger = {
  info: (message: string, data?: unknown) => {
    console.log(`[${timestamp()}] INFO: ${message}`, data ?? "");
  },
  warn: (message: string, data?: unknown) => {
    console.warn(`[${timestamp()}] WARN: ${message}`, data ?? "");
  },
  error: (message: string, data?: unknown) => {
    console.error(`[${timestamp()}] ERROR: ${message}`, data ?? "");
  },
  success: (message: string, data?: unknown) => {
    console.log(`[${timestamp()}] ✅ ${message}`, data ?? "");
  },
};
