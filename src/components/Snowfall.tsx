"use client";

import React, { useEffect, useRef } from "react";

interface Flake {
  x: number;
  y: number;
  radius: number;
  speedY: number;
  speedX: number;
  swayAmplitude: number;
  swaySpeed: number;
  swayOffset: number;
  opacity: number;
  isForeground: boolean;
}

export const Snowfall: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Respect user's reduced motion preference safely
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)")?.matches
      ) {
        return;
      }
    } catch {
      // In-app browsers or older webviews might not support matchMedia
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d", { alpha: true });
    } catch {
      return;
    }
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;

    try {
      width = canvas.width = window.innerWidth || 800;
      height = canvas.height = window.innerHeight || 600;
    } catch {
      return;
    }

    let resizeTimeout: NodeJS.Timeout | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          if (!canvas) return;
          width = canvas.width = window.innerWidth || 800;
          height = canvas.height = window.innerHeight || 600;
        } catch {
          // ignore resize errors
        }
      }, 150);
    };

    try {
      window.addEventListener("resize", handleResize, { passive: true });
    } catch {
      // ignore
    }

    // High performance lightweight flake population
    const totalFlakes = Math.min(65, Math.max(25, Math.floor((width * height) / 16000)));
    const flakes: Flake[] = [];

    for (let i = 0; i < totalFlakes; i++) {
      const isForeground = i % 7 === 0;
      const radius = isForeground ? Math.random() * 1.8 + 1.8 : Math.random() * 1.4 + 0.6;

      flakes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius,
        opacity: isForeground ? Math.random() * 0.4 + 0.5 : Math.random() * 0.4 + 0.2,
        speedY: isForeground ? Math.random() * 1.2 + 0.7 : Math.random() * 0.7 + 0.35,
        speedX: Math.random() * 0.3 - 0.15,
        swayAmplitude: isForeground ? Math.random() * 1.4 + 0.6 : Math.random() * 0.8 + 0.2,
        swaySpeed: Math.random() * 0.015 + 0.008,
        swayOffset: Math.random() * Math.PI * 2,
        isForeground,
      });
    }

    let time = 0;
    let isVisible = true;

    const handleVisibilityChange = () => {
      try {
        isVisible = !document.hidden;
        if (isVisible) {
          lastTime = typeof performance !== "undefined" ? performance.now() : Date.now();
          animationFrameId = requestAnimationFrame(render);
        } else {
          cancelAnimationFrame(animationFrameId);
        }
      } catch {
        // ignore
      }
    };

    try {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    } catch {
      // ignore
    }

    let lastTime = typeof performance !== "undefined" ? performance.now() : Date.now();

    const render = () => {
      if (!isVisible || !ctx) return;

      try {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const delta = Math.min(1.5, (now - lastTime) / 16.67);
        lastTime = now;

        ctx.clearRect(0, 0, width, height);
        time += 0.02 * delta;

        // Batch 1: Background white flakes
        ctx.beginPath();
        ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
        for (let i = 0; i < flakes.length; i++) {
          const flake = flakes[i];
          if (flake.isForeground) continue;

          flake.y += flake.speedY * delta;
          flake.x +=
            (Math.sin(time * flake.swaySpeed + flake.swayOffset) * flake.swayAmplitude + flake.speedX) *
            delta;

          if (flake.y > height + 8) {
            flake.y = -8;
            flake.x = Math.random() * width;
          }
          if (flake.x > width + 8) flake.x = -8;
          else if (flake.x < -8) flake.x = width + 8;

          ctx.moveTo(flake.x + flake.radius, flake.y);
          ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        }
        ctx.fill();

        // Batch 2: Foreground warm champagne flakes
        ctx.beginPath();
        ctx.fillStyle = "rgba(254, 243, 199, 0.75)";
        for (let i = 0; i < flakes.length; i++) {
          const flake = flakes[i];
          if (!flake.isForeground) continue;

          flake.y += flake.speedY * delta;
          flake.x +=
            (Math.sin(time * flake.swaySpeed + flake.swayOffset) * flake.swayAmplitude + flake.speedX) *
            delta;

          if (flake.y > height + 8) {
            flake.y = -8;
            flake.x = Math.random() * width;
          }
          if (flake.x > width + 8) flake.x = -8;
          else if (flake.x < -8) flake.x = width + 8;

          ctx.moveTo(flake.x + flake.radius, flake.y);
          ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        }
        ctx.fill();

        animationFrameId = requestAnimationFrame(render);
      } catch {
        // If render crashes, stop the loop safely rather than crashing the browser tab
      }
    };

    try {
      animationFrameId = requestAnimationFrame(render);
    } catch {
      // ignore
    }

    return () => {
      try {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        cancelAnimationFrame(animationFrameId);
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-10 h-full w-full will-change-transform"
      aria-hidden="true"
    />
  );
};
