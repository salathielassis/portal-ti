const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
const TOKEN_KEY = 'itam:token';

/** Erro tipado lançado pelo apiFetch — carrega o status HTTP junto com a mensagem. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Wrapper único para todas as chamadas ao backend NestJS. Sempre injeta o
 * Bearer token (se houver), sempre assume/retorna JSON, e normaliza os erros
 * da API (`{ message: string | string[] }`, formato padrão do Nest) numa
 * única classe `ApiError` — assim cada página só precisa de um `catch`.
 */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;

  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      // Upload de arquivo (FormData) não pode levar Content-Type manual — o
      // navegador precisa definir o boundary do multipart sozinho.
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(message ?? `Erro ${res.status} ao chamar ${path}`, res.status);
  }

  return body as T;
}

/**
 * Como `apiFetch`, mas para endpoints que devolvem um arquivo binário
 * (ex.: exportação de relatório em XLSX/PDF). Mantém o Bearer token no
 * header (por isso não dá para usar um `<a href>` simples) e, em caso de
 * erro, tenta ler o corpo JSON de erro padrão do Nest.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(message ?? `Erro ${res.status} ao gerar o arquivo`, res.status);
  }

  return res.blob();
}
