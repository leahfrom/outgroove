export function contentSecurityPolicy(development: boolean): string {
  const scriptSource = development ? "'self' 'unsafe-inline'" : "'self'";
  const styleSource = development ? "'self' 'unsafe-inline'" : "'self'";
  const connectSource = development ? "'self' ws://localhost:*" : "'self'";
  return `default-src 'self'; script-src ${scriptSource}; style-src ${styleSource}; img-src 'self' data:; connect-src ${connectSource}`;
}
