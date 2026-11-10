"use client";

/**
 * High-Entropy Deterministic Hardware Fingerprinting Engine
 * Operates purely client-side without external dependencies.
 * Extracts physical hardware characteristics (GPU, Canvas rasterizer, Audio DSP, Screen)
 * that remain 100% identical between Standard Mode and Private / Incognito Mode.
 */

let cachedHwFingerprint: string | null = null;

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";

    // Subpixel font hinting and text rendering
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial', sans-serif";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);

    ctx.fillStyle = "#069";
    ctx.fillText("🎅 Secret Santa 2024! 🎁✨", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("🔒 Hardware Lock Signature", 4, 35);

    // Geometry, alpha composite, and shadow blur
    ctx.shadowColor = "rgba(255, 0, 0, 0.5)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(50, 50, 8, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    return canvas.toDataURL();
  } catch {
    return "canvas-err";
  }
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "no-webgl";

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);

    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0;
    const maxViewportDims = (gl.getParameter(gl.MAX_VIEWPORT_DIMS) || []).join("x");
    const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 0;
    const extensions = (gl.getSupportedExtensions() || []).sort().join(";");

    return `${vendor}~${renderer}~${maxTextureSize}~${maxRenderbufferSize}~${maxViewportDims}~${maxVertexAttribs}~${extensions}`;
  } catch {
    return "webgl-err";
  }
}

async function getAudioFingerprint(): Promise<string> {
  try {
    const AudioCtx =
      window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!AudioCtx) return "no-audio";

    const context = new AudioCtx(1, 44100, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(10000, context.currentTime);

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, context.currentTime);
    compressor.knee.setValueAtTime(40, context.currentTime);
    compressor.ratio.setValueAtTime(12, context.currentTime);
    compressor.attack.setValueAtTime(0, context.currentTime);
    compressor.release.setValueAtTime(0.25, context.currentTime);

    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);

    const renderedBuffer = await context.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    let sum = 0;
    for (let i = 4500; i < 5000; i++) {
      sum += Math.abs(channelData[i]);
    }
    return sum.toFixed(6);
  } catch {
    return "audio-err";
  }
}

function getHardwareMetrics(): string {
  if (typeof window === "undefined") return "";
  const screen = window.screen;
  const dpr = window.devicePixelRatio || 1;
  const realWidth = Math.round((screen?.width || 0) * dpr);
  const realHeight = Math.round((screen?.height || 0) * dpr);
  const colorDepth = screen?.colorDepth || 0;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const lang = (navigator.language || "").split("-")[0].toLowerCase();

  return [
    realWidth,
    realHeight,
    colorDepth,
    navigator.hardwareConcurrency || 0,
    navigator.maxTouchPoints || 0,
    navigator.platform || "",
    timezone,
    lang,
  ].join(":");
}

/**
 * Returns a cryptographically hashed, hardware-anchored device signature.
 * Strictly stable across Private / Incognito browsing tabs on the same physical hardware,
 * immune to Safari / Chrome private browsing canvas & audio noise injection.
 */
export async function getHardwareFingerprint(): Promise<string> {
  if (cachedHwFingerprint) return cachedHwFingerprint;

  if (typeof window === "undefined") {
    return "server-env";
  }

  try {
    // 1. Stable WebGL hardware limits (immune to private mode masking)
    let webglStable = "no-webgl";
    try {
      const canvas = document.createElement("canvas");
      const gl = (canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
      if (gl) {
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
        const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0;
        const maxViewportDims = (gl.getParameter(gl.MAX_VIEWPORT_DIMS) || []).join("x");
        const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 0;
        webglStable = `${maxTextureSize}~${maxRenderbufferSize}~${maxViewportDims}~${maxVertexAttribs}`;
      }
    } catch {
      webglStable = "webgl-err";
    }

    // 2. Physical hardware display & processor metrics
    const hwMetrics = getHardwareMetrics();

    // The signature combines physical silicon, GPU capabilities, display resolution, and hardware architecture.
    // It purposefully avoids volatile Canvas/Audio pixel buffers which Safari private browsing randomizes.
    const rawSignature = `silicon_anchor###${webglStable}###${hwMetrics}`;

    if (window.crypto?.subtle) {
      const msgUint8 = new TextEncoder().encode(rawSignature);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      cachedHwFingerprint = `hw_v2_${hashHex}`;
    } else {
      let hash = 0;
      for (let i = 0; i < rawSignature.length; i++) {
        const char = rawSignature.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
      }
      cachedHwFingerprint = `hw_v2_fallback_${Math.abs(hash).toString(16)}`;
    }

    // Set cookie for automatic transmission on subsequent server requests
    try {
      document.cookie = `santa_hw_fp=${cachedHwFingerprint}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // ignore
    }

    return cachedHwFingerprint;
  } catch {
    return "hw_unknown";
  }
}

/**
 * Synchronous getter for cached fingerprint, or returns empty string if not computed yet.
 */
export function getCachedHardwareFingerprint(): string {
  return cachedHwFingerprint || "";
}
