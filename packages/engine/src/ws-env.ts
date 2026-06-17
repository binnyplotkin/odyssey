// Imported for its side effect BEFORE `ws` loads (see audio.ts). ESM evaluates
// imports in source order, so these run before ws's module body — telling ws to
// skip the optional `bufferutil` / `utf-8-validate` native bindings and use its
// pure-JS masking path (a broken bufferutil binding otherwise takes down the
// ElevenLabs/Cartesia streaming sends). Kept in its own module because ESM
// hoists imports above statements, so the env can't be set inline before the
// `import "ws"` within audio.ts itself.
process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";

export {};
