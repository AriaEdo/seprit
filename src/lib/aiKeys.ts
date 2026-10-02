import { invoke } from "@tauri-apps/api/core";

export type Provider = "anthropic" | "openai" | "gemini";
export type SpriteProvider = "openai" | "gemini";
export type KeyStatus = Record<Provider, boolean>;

// Keys go to the OS keychain via Rust; the WebView only ever learns whether one is stored.
export const keyStatus = () => invoke<KeyStatus>("ai_key_status");
export const setKey = (provider: Provider, key: string) => invoke<void>("ai_key_set", { provider, key });
export const deleteKey = (provider: Provider) => invoke<void>("ai_key_delete", { provider });

// Not a secret, so a plain preference in localStorage.
const SPRITE_PROVIDER = "seprit.spriteProvider";
export const getSpriteProvider = (): SpriteProvider =>
  localStorage.getItem(SPRITE_PROVIDER) === "gemini" ? "gemini" : "openai";
export const setSpriteProvider = (p: SpriteProvider) => localStorage.setItem(SPRITE_PROVIDER, p);

// Base64 image from the sprite provider; the request runs in Rust like every AI call.
export const generateSprite = (provider: SpriteProvider, prompt: string, width: number, height: number) =>
  invoke<string>("ai_generate_sprite", { provider, prompt, width, height });
