export interface AppEnvironment {
  Bindings: CloudflareBindings;
  Variables: {
    runId: string;
  };
}
