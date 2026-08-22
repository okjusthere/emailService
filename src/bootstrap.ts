import "dotenv/config";
import { useAzureMonitor } from "@azure/monitor-opentelemetry";

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
if (connectionString) {
  useAzureMonitor({ azureMonitorExporterOptions: { connectionString } });
}

await import("./main.js");
