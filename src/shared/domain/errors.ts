export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly itemPath?: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AppError };
