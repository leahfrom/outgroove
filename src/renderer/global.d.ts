import type { OutgrooveApi } from "../shared/contracts/api";

declare module "*.css";

declare global {
  interface Window {
    readonly outgroove: OutgrooveApi;
  }
}

export {};
