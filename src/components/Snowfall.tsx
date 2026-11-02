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
    // Respect user's reduced motion preference
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!canvas) return;
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
      }, 150);
    };

    window.addEventListener("resize", handleResize, { passive: true });

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
      isVisible = !document.hidden;
      if (isVisible) {
        lastTime = performance.now();
        animationFrameId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animationFrameId);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    let lastTime = performance.now();

    const render = () => {
      if (!isVisible) return;

      const now = performance.now();
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
        flake.x += (Math.sin(time * flake.swaySpeed + flake.swayOffset) * flake.swayAmplitude + flake.speedX) * delta;

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
        flake.x += (Math.sin(time * flake.swaySpeed + flake.swayOffset) * flake.swayAmplitude + flake.speedX) * delta;

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
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelAnimationFrame(animationFrameId);
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
