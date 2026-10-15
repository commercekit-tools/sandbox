declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Cloudflare's test runtime requires declaration merging with generated bindings.
  interface ProvidedEnv extends CloudflareBindings {}
}
