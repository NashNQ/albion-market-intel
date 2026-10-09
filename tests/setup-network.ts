// Les tests ne doivent jamais joindre l'API AODP réelle : tout appel non simulé échoue tout de suite.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('albion-online-data.com')) return Promise.reject(new TypeError('réseau désactivé dans les tests'));
  return realFetch ? realFetch(input as RequestInfo, init) : Promise.reject(new TypeError('fetch indisponible'));
}) as typeof fetch;
